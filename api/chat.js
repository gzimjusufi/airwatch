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

    // Convert a ThingSpeak UTC timestamp to a compact Europe/Skopje
    // local time string, e.g. "2026-08-18 19:47".
    function toSkopjeTime(isoString) {
      if (!isoString) return isoString;
      const d = new Date(isoString);
      if (Number.isNaN(d.getTime())) return isoString;
      const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Skopje',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const get = (t) => parts.find((p) => p.type === t)?.value;
      return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    }

    // Strip a feed down to just the fields we actually use (local
    // timestamp + the mapped field columns), and round numeric
    // values to 1 decimal. This is the main thing keeping the
    // Groq payload small — raw ThingSpeak feeds include every
    // field1..field8 (even unused/null ones) plus entry_id.
    function slimFeed(f) {
      const slim = { t: toSkopjeTime(f.created_at) };
      for (const fieldKey of Object.keys(fieldNameMap)) {
        const v = parseFloat(f[fieldKey]);
        if (!Number.isNaN(v)) slim[fieldNameMap[fieldKey]] = Number(v.toFixed(1));
      }
      return slim;
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

    // Downsample a list to at most maxPoints evenly-spaced entries.
    function downsample(feedList, maxPoints = 24) {
      if (feedList.length === 0) return [];
      const bucketSize = Math.max(1, Math.ceil(feedList.length / maxPoints));
      return feedList.filter((_, i) => i % bucketSize === 0);
    }

    const recentWindowSample = downsample(feedsRecentWindow, 16).map(slimFeed);
    const last24hSample = downsample(feeds24h, 12).map(slimFeed);
    const recentFeedsSlim = feeds.map(slimFeed);

    // ---------------------------------------------------------------
    // SERVER-SIDE WINDOW FILTER
    // Parse "last/past N hours|days" from the user's message and
    // slice the right feed list here, so the AI never filters itself.
    // ---------------------------------------------------------------
    let requestedHours = null;
    const lastUserMsg =
      [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // "last 8 hours", "past 3h", "last 24 hours", etc.
    const hoursMatch = lastUserMsg.match(
      /(?:last|past)\s+(\d+(?:\.\d+)?)\s*h(?:ou?r?s?)?/i
    );
    // "last 1 day", "last 2 days"
    const daysMatch = !hoursMatch && lastUserMsg.match(
      /(?:last|past)\s+(\d+(?:\.\d+)?)\s*d(?:ay?s?)?/i
    );

    if (hoursMatch) {
      requestedHours = parseFloat(hoursMatch[1]);
    } else if (daysMatch) {
      requestedHours = parseFloat(daysMatch[1]) * 24;
    }

    // Always derive real start/end for the 24h window from actual data
    const last24hStart =
      feeds24h.length > 0 ? toSkopjeTime(feeds24h[0].created_at) : null;
    const last24hEnd =
      feeds24h.length > 0
        ? toSkopjeTime(feeds24h[feeds24h.length - 1].created_at)
        : null;

    let customWindowFeeds = null;
    let customWindowSample = null;
    let customWindowSummary = null;
    let customWindowStart = null;
    let customWindowEnd = null;

    if (requestedHours !== null) {
      // Pick the right source list based on requested span
      const sourceList =
        requestedHours > 12 ? feeds24h : feedsRecentWindow;

      if (sourceList.length > 0) {
        // Find the latest UTC timestamp in the list as the anchor
        const latestTs = Math.max(
          ...sourceList.map((f) => new Date(f.created_at).getTime())
        );
        const cutoffTs = latestTs - requestedHours * 60 * 60 * 1000;

        customWindowFeeds = sourceList.filter(
          (f) => new Date(f.created_at).getTime() >= cutoffTs
        );
        customWindowSummary = computeSummary(customWindowFeeds);
        customWindowSample = downsample(customWindowFeeds, 16).map(slimFeed);

        if (customWindowFeeds.length > 0) {
          customWindowStart = toSkopjeTime(customWindowFeeds[0].created_at);
          customWindowEnd = toSkopjeTime(
            customWindowFeeds[customWindowFeeds.length - 1].created_at
          );
        }
      }
    }

    const sensorData = {
      channel_name: channel.name,
      location: 'Palatica, Tetovo region, North Macedonia',
      field_names: fieldNameMap,
      timezone: 'Europe/Skopje (all timestamps below are local Skopje time, not UTC)',
      // Most recent raw readings (for "current"/"live" questions)
      recent_feeds: recentFeedsSlim,
      // Sparse samples + precomputed summaries for standard windows
      recent_window_sample: recentWindowSample,
      recent_window_summary: summaryRecentWindow,
      last_24h_start: last24hStart,
      last_24h_end: last24hEnd,
      last_24h_hourly_sample: last24hSample,
      last_24h_summary: summary24h,
      // Pre-filtered window for the specific span the user requested
      // (null when the user didn't ask for a specific number of hours)
      requested_window_hours: requestedHours,
      requested_window_start: customWindowStart,
      requested_window_end: customWindowEnd,
      requested_window_sample: customWindowSample,
      requested_window_summary: customWindowSummary,
    };

    /*
     * ---------------------------------------------------------
     * 3. SEND THE THINGSPEAK DATA TO GROQ
     * ---------------------------------------------------------
     */

    const aiSystemPrompt = `${systemPrompt}

You have access to live and, when available, historical sensor/device
data from ThingSpeak.

Current time (Europe/Skopje, local): ${toSkopjeTime(new Date().toISOString())}

THINGSpeak DATA:
${JSON.stringify(sensorData)}

How to use this data:
- The "location" field is the physical location of the sensor.
  Always use it when referring to location. Never substitute or
  guess a different city name (e.g. do not say "Skopje").
- All timestamps in the data (field "t") are already in local
  Europe/Skopje time, NOT UTC. Report times to the user as-is,
  without converting or appending "UTC".
- "recent_feeds" = the last 10 raw readings. Use these for "current",
  "live", or "right now" questions.
- "recent_window_sample" = a sample of readings covering roughly the
  last 12 hours, showing trend shape.
- "recent_window_summary" = precomputed min/max/avg per field over
  the FULL last 12 hours.
- "last_24h_start", "last_24h_end" = the actual first and last
  timestamps in the 24h dataset. ALWAYS use these when reporting
  the 24h time range — never compute or invent a range yourself.
- "last_24h_hourly_sample" = sparse sample from the last 24 hours.
- "last_24h_summary" = precomputed min/max/avg over the FULL last
  24 hours. Use for "today", "last 24 hours", or "24h average"
  questions. Report the range as last_24h_start – last_24h_end.
- "requested_window_hours", "requested_window_start",
  "requested_window_end", "requested_window_sample",
  "requested_window_summary" — when the user asked for a specific
  number of hours (e.g. "last 8 hours"), these fields are already
  filtered server-side to exactly that span. Use them directly:
    • Report requested_window_start – requested_window_end as the
      actual time range covered.
    • Use requested_window_summary for min/max/avg numbers.
    • Use requested_window_sample only for trend shape.
    • DO NOT re-filter or re-compute the window yourself.
  If requested_window_summary is null, that window has no data —
  say so rather than guessing.
- Any of the above may be empty/null if that window isn't available.
  If empty, say so rather than guessing.

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
          model: 'openai/gpt-oss-20b',
          max_tokens: 1500,
          reasoning_effort: 'low',
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
      'The AI ran out of room thinking through that one — try asking again, or narrow the time range.';

    /*
     * ---------------------------------------------------------
     * 4. RETURN AI RESPONSE + SENSOR DATA
     * ---------------------------------------------------------
     */

    return res.status(200).json({
      reply,
      thingSpeak: {
        channel,
        feeds, // last 10 raw readings, full/unslimmed (kept for backward compat)
        recent_feeds: feeds,
        recent_window_sample: recentWindowSample,
        recent_window_summary: summaryRecentWindow,
        last_24h_start: last24hStart,
        last_24h_end: last24hEnd,
        last_24h_hourly_sample: last24hSample,
        last_24h_summary: summary24h,
        requested_window_hours: requestedHours,
        requested_window_start: customWindowStart,
        requested_window_end: customWindowEnd,
        requested_window_sample: customWindowSample,
        requested_window_summary: customWindowSummary,
      },
    });
  } catch (err) {
    console.error('Handler error:', err);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}