// api/chat.js — Vercel Serverless Function

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { messages, systemPrompt } = req.body;

  if (!messages || !systemPrompt) {
    return res.status(400).json({
      error: 'Missing messages or systemPrompt',
    });
  }

  // Basic abuse prevention
  if (!Array.isArray(messages) || messages.length > 20) {
    return res.status(429).json({
      error: 'Too many messages in context',
    });
  }

  try {
    /*
     * ---------------------------------------------------------
     * 1. GET DATA FROM THINGSPEAK
     * ---------------------------------------------------------
     */

    const channelId = process.env.THINGSPEAK_CHANNEL_ID;
    const readApiKey = process.env.THINGSPEAK_READ_API_KEY;

    if (!channelId || !readApiKey) {
      console.error('ThingSpeak environment variables are missing');

      return res.status(500).json({
        error: 'ThingSpeak configuration is missing',
      });
    }

    // --- 1a. Recent raw readings (this is the call that always
    // worked before — kept exactly as-is, this is required). ---
    const recentUrl =
      `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
      `?api_key=${encodeURIComponent(readApiKey)}` +
      `&results=10`;

    const recentResponse = await fetch(recentUrl);

    if (!recentResponse.ok) {
      const errorText = await recentResponse.text();

      console.error('ThingSpeak API error (recent):', errorText);

      return res.status(502).json({
        error: 'ThingSpeak service error',
      });
    }

    const recentData = await recentResponse.json();

    // --- 1b. Last 24 hours, OPTIONAL / non-fatal. If this fails
    // for any reason (bad params, rate limit, timeout), we log it
    // and just continue without 24h data instead of breaking the
    // whole chat response. ---
    let feeds24h = [];

    try {
      const last24hUrl =
        `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
        `?api_key=${encodeURIComponent(readApiKey)}` +
        `&results=200` +
        `&days=1`;

      const last24hResponse = await fetch(last24hUrl);

      if (last24hResponse.ok) {
        const last24hData = await last24hResponse.json();
        feeds24h = Array.isArray(last24hData.feeds)
          ? last24hData.feeds
          : [];
      } else {
        const errorText = await last24hResponse.text();
        console.error(
          'ThingSpeak API error (last24h, non-fatal):',
          errorText
        );
      }
    } catch (e) {
      console.error('ThingSpeak 24h fetch failed (non-fatal):', e);
    }

    /*
     * ---------------------------------------------------------
     * 2. PREPARE SENSOR DATA FOR THE AI
     * ---------------------------------------------------------
     */

    const channel = recentData.channel || {};
    const feeds = recentData.feeds || [];

    // Map field1..field8 -> their human-readable names from the
    // channel metadata (e.g. field1 -> "Temperature").
    const fieldNameMap = {};
    for (let i = 1; i <= 8; i++) {
      const key = `field${i}`;
      if (channel[key]) fieldNameMap[key] = channel[key];
    }

    // Compute min / max / avg for each field over the last 24h,
    // if we have any 24h data at all.
    const summary24h = {};
    for (const fieldKey of Object.keys(fieldNameMap)) {
      const values = feeds24h
        .map((f) => parseFloat(f[fieldKey]))
        .filter((v) => !Number.isNaN(v));

      if (values.length === 0) continue;

      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg =
        values.reduce((sum, v) => sum + v, 0) / values.length;

      summary24h[fieldNameMap[fieldKey]] = {
        min: Number(min.toFixed(2)),
        max: Number(max.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        samples: values.length,
      };
    }

    // Downsample the 24h feeds to ~1 point per hour (max 24 points)
    // before sending to the AI. Sending all 200 raw rows blew past
    // Groq's per-minute token limit (8000 TPM), so we only keep a
    // sparse set of points for a rough trend line, plus the full
    // min/max/avg summary computed above (from ALL the raw data).
    let last24hHourly = [];
    if (feeds24h.length > 0) {
      const bucketSize = Math.max(1, Math.ceil(feeds24h.length / 24));
      last24hHourly = feeds24h.filter((_, i) => i % bucketSize === 0);
    }

    const sensorData = {
      channel_id: channel.id,
      channel_name: channel.name,
      description: channel.description,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
      field_names: fieldNameMap,
      // Most recent raw readings (for "current"/"live" questions)
      recent_feeds: feeds,
      // Sparse ~hourly sample of the last 24h (for a rough trend
      // shape — NOT the full raw data, to keep token usage low)
      last_24h_hourly_sample: last24hHourly,
      // Precomputed min/max/avg per field over the FULL last 24h
      // (computed from all raw data, not just the sample above)
      last_24h_summary: summary24h,
    };

    /*
     * ---------------------------------------------------------
     * 3. SEND THE THINGSPEAK DATA TO GROQ
     * ---------------------------------------------------------
     */

    const aiSystemPrompt = `${systemPrompt}

You have access to live and, when available, historical sensor/device
data from ThingSpeak.

THINGSpeak DATA:
${JSON.stringify(sensorData, null, 2)}

How to use this data:
- "recent_feeds" = the last 10 raw readings. Use these for "current",
  "live", or "right now" questions.
- "last_24h_hourly_sample" = a sparse sample (roughly one point per
  hour) from the last 24 hours, showing the general trend shape. May
  be empty if unavailable.
- "last_24h_summary" = precomputed min/max/avg per sensor field over
  the FULL last 24 hours (computed from all data, not just the
  sample). Use these numbers for "how has it been today", "24h
  average", min, or max style questions — they are more accurate
  than eyeballing the sample.

Important:
- Do not invent sensor values.
- If a requested value is not present in the ThingSpeak data, say that it is unavailable.
- Treat the most recent entry in "recent_feeds" as the latest available reading.
- If "last_24h_summary" is empty, say that 24-hour history is not available right now rather than guessing.
`;

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-prompt-guard-2-86m',
          max_tokens: 800,
          messages: [
            {
              role: 'system',
              content: aiSystemPrompt,
            },
            ...messages,
          ],
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json();

      console.error('Groq API error:', err);

      return res.status(502).json({
        error: 'AI service error',
        detail: err,
      });
    }

    const data = await response.json();

    const reply =
      data.choices?.[0]?.message?.content ||
      'No response from AI.';

    /*
     * ---------------------------------------------------------
     * 4. RETURN AI RESPONSE + SENSOR DATA
     * ---------------------------------------------------------
     */

    return res.status(200).json({
      reply,
      thingSpeak: {
        channel,
        feeds, // last 10 raw readings (kept for backward compatibility)
        recent_feeds: feeds,
        last_24h_hourly_sample: last24hHourly,
        last_24h_summary: summary24h,
      },
    });
  } catch (err) {
    console.error('Handler error:', err);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}