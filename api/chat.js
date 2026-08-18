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

    // --- 1b. Last 6 hours and last 24 hours, OPTIONAL / non-fatal.
    // If either fails for any reason (bad params, rate limit,
    // timeout), we log it and just continue without that window
    // instead of breaking the whole chat response. ---
    let feedsRecentWindow = [];
    let feeds24h = [];

    try {
      const recentWindowUrl =
        `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
        `?api_key=${encodeURIComponent(readApiKey)}` +
        `&results=800` +
        `&minutes=720`;

      const recentWindowResponse = await fetch(recentWindowUrl);

      if (recentWindowResponse.ok) {
        const recentWindowData = await recentWindowResponse.json();
        feedsRecentWindow = Array.isArray(recentWindowData.feeds)
          ? recentWindowData.feeds
          : [];
      } else {
        const errorText = await recentWindowResponse.text();
        console.error(
          'ThingSpeak API error (recentWindow, non-fatal):',
          errorText
        );
      }
    } catch (e) {
      console.error('ThingSpeak recent-window fetch failed (non-fatal):', e);
    }

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

    // Helper: compute min/max/avg per field for a set of feeds
    function computeSummary(feedList) {
      const summary = {};
      for (const fieldKey of Object.keys(fieldNameMap)) {
        const values = feedList
          .map((f) => parseFloat(f[fieldKey]))
          .filter((v) => !Number.isNaN(v));

        if (values.length === 0) continue;

        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg =
          values.reduce((sum, v) => sum + v, 0) / values.length;

        summary[fieldNameMap[fieldKey]] = {
          min: Number(min.toFixed(2)),
          max: Number(max.toFixed(2)),
          avg: Number(avg.toFixed(2)),
          samples: values.length,
        };
      }
      return summary;
    }

    const summaryRecentWindow = computeSummary(feedsRecentWindow);
    const summary24h = computeSummary(feeds24h);

    // Downsample both windows to at most ~24 points each before
    // sending to the AI, to stay well under Groq's token limit.
    // Full min/max/avg (computed above from ALL raw points) covers
    // accuracy; these samples just show the trend shape.
    function downsample(feedList, maxPoints = 24) {
      if (feedList.length === 0) return [];
      const bucketSize = Math.max(1, Math.ceil(feedList.length / maxPoints));
      return feedList.filter((_, i) => i % bucketSize === 0);
    }

    const recentWindowSample = downsample(feedsRecentWindow, 36);
    const last24hSample = downsample(feeds24h, 24);

    const sensorData = {
      channel_id: channel.id,
      channel_name: channel.name,
      description: channel.description,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
      field_names: fieldNameMap,
      // Most recent raw readings (for "current"/"live" questions)
      recent_feeds: feeds,
      // Sparse samples showing trend shape (NOT full raw data, to
      // keep token usage low)
      recent_window_sample: recentWindowSample,
      last_24h_hourly_sample: last24hSample,
      // Precomputed min/max/avg per field, from ALL raw data in
      // each window (more accurate than the samples above)
      recent_window_summary: summaryRecentWindow,
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
- "recent_window_sample" = a sample of readings (with timestamps)
  covering roughly the last 12 hours, showing the trend shape.
- "recent_window_summary" = precomputed min/max/avg per field over
  the FULL last 12 hours (all raw data, not just the sample).
- For questions about a specific span within that window (e.g. "last
  6 hours", "last 8 hours"), filter "recent_window_sample" by its
  "created_at" timestamps relative to the most recent timestamp
  (i.e. only keep entries within that many hours of the latest one),
  then summarize from the filtered points. Only fall back to
  "recent_window_summary" (the full 12h figures) if the requested
  span is close to or larger than 12 hours.
- "last_24h_hourly_sample" = a sparse sample (roughly one point per
  hour) from the last 24 hours, showing the general trend shape.
- "last_24h_summary" = precomputed min/max/avg per field over the
  FULL last 24 hours. Use these numbers for "how has it been today"
  or "24h average" style questions.
- Any of the above may be empty if that window of data isn't
  available. If empty, say so rather than guessing.

Classification tiers - use these EXACT tiers and labels, matching
the dashboard UI exactly. Do not use generic/EPA/WHO bands instead:

Temperature (C):
- < 16: "Cold"
- 16 - 26: "Comfortable"
- 26 - 35: "Warm"
- 35+: "Hot"

Humidity (%):
- < 30: "Too dry"
- 30 - 60: "Comfortable"
- 60 - 80: "Humid"
- 80+: "Too humid"

Pressure (hPa):
- 960+: "Normal (altitude)"
- 940 - 960: "Low"
- < 940: "Very low"

CO2 (ppm):
- < 600: "Fresh"
- 600 - 1000: "OK"
- 1000 - 2000: "Poor"
- 2000+: "Very poor"

PM2.5 (ug/m3):
- 0 - 12: "Good"
- 13 - 35: "Moderate"
- 36 - 55: "Sensitive"
- 56 - 150: "Unhealthy"
- 151+: "Very poor"

Sound (dB):
- < 40: "Quiet"
- 40 - 70: "Normal"
- 70+: "Loud"

When reporting any of these values or averages, always state which
tier it falls into, using this exact wording.

Important:
- Do not invent sensor values.
- If a requested value is not present in the ThingSpeak data, say that it is unavailable.
- Treat the most recent entry in "recent_feeds" as the latest available reading.
- If a requested time window's data (recent window or 24h) is empty, say that window isn't available right now rather than guessing.
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
        feeds, // last 10 raw readings (kept for backward compatibility)
        recent_feeds: feeds,
        recent_window_sample: recentWindowSample,
        recent_window_summary: summaryRecentWindow,
        last_24h_hourly_sample: last24hSample,
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