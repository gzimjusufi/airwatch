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
     *    - "recent": last 10 raw readings (for live/current values)
     *    - "last24h": full 24h window, downsampled to hourly
     *      averages so the payload stays small
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

    const recentUrl =
      `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
      `?api_key=${encodeURIComponent(readApiKey)}` +
      `&results=10`;

    // Last 24 hours, averaged into 60-minute buckets so we get at
    // most ~24 data points instead of potentially thousands of
    // raw readings.
    const last24hUrl =
      `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
      `?api_key=${encodeURIComponent(readApiKey)}` +
      `&days=1` +
      `&average=60`;

    const [recentResponse, last24hResponse] = await Promise.all([
      fetch(recentUrl),
      fetch(last24hUrl),
    ]);

    if (!recentResponse.ok) {
      const errorText = await recentResponse.text();

      console.error('ThingSpeak API error (recent):', errorText);

      return res.status(502).json({
        error: 'ThingSpeak service error',
      });
    }

    if (!last24hResponse.ok) {
      const errorText = await last24hResponse.text();

      console.error('ThingSpeak API error (last24h):', errorText);

      return res.status(502).json({
        error: 'ThingSpeak service error',
      });
    }

    const recentData = await recentResponse.json();
    const last24hData = await last24hResponse.json();

    /*
     * ---------------------------------------------------------
     * 2. PREPARE SENSOR DATA FOR THE AI
     * ---------------------------------------------------------
     */

    const channel = recentData.channel || {};
    const feeds = recentData.feeds || [];
    const feeds24h = last24hData.feeds || [];

    // Map field1..field8 -> their human-readable names from the
    // channel metadata (e.g. field1 -> "Temperature").
    const fieldNameMap = {};
    for (let i = 1; i <= 8; i++) {
      const key = `field${i}`;
      if (channel[key]) fieldNameMap[key] = channel[key];
    }

    // Compute min / max / avg for each field over the last 24h so
    // the AI gets real trend info without needing every raw point.
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

    const sensorData = {
      channel_id: channel.id,
      channel_name: channel.name,
      description: channel.description,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
      field_names: fieldNameMap,
      // Most recent raw readings (for "current"/"live" questions)
      recent_feeds: feeds,
      // Last 24 hours, hourly-averaged (for "last 24 hours" /
      // "today" / trend questions)
      last_24h_hourly: feeds24h,
      // Precomputed min/max/avg per field over the last 24h
      last_24h_summary: summary24h,
    };

    /*
     * ---------------------------------------------------------
     * 3. SEND THE THINGSPEAK DATA TO GROQ
     * ---------------------------------------------------------
     */

    const aiSystemPrompt = `${systemPrompt}

You have access to live and historical sensor/device data from ThingSpeak.

THINGSpeak DATA:
${JSON.stringify(sensorData, null, 2)}

How to use this data:
- "recent_feeds" = the last 10 raw readings. Use these for "current",
  "live", or "right now" questions.
- "last_24h_hourly" = readings from the last 24 hours, averaged into
  hourly buckets. Use these when the user asks about trends over the
  last 24 hours / today.
- "last_24h_summary" = precomputed min/max/avg per sensor field over
  the last 24 hours. Use these when the user asks for a 24h average,
  min, max, or a general "how has the air quality been today" style
  summary.

Important:
- Do not invent sensor values.
- If a requested value is not present in the ThingSpeak data, say that it is unavailable.
- Treat the most recent entry in "recent_feeds" as the latest available reading.
- If "last_24h_hourly" or "last_24h_summary" is empty, say that 24-hour history is not available rather than guessing.
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
          model: 'openai/gpt-oss-120b',
          max_tokens: 2000,
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
        feeds,          // last 10 raw readings (kept for backward compatibility)
        recent_feeds: feeds,
        last_24h_hourly: feeds24h,
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