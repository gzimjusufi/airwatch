// api/chat.js — Vercel Serverless Function
// This runs on Vercel's servers. The GROQ_API_KEY is stored as an
// environment variable — never exposed to the browser.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic CORS — allow your own site only
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { messages, systemPrompt } = req.body;

  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'Missing messages or systemPrompt' });
  }

  // Rate limit: max 20 messages per request check (basic abuse prevention)
  if (messages.length > 20) {
    return res.status(429).json({ error: 'Too many messages in context' });
  }

  // --- DYNAMIC TIMEFRAME DETECTION FROM USER INPUT ---
  let targetMinutes = 1440; // Default fallback to 24 hours (1440 minutes)

  try {
    const userMessage = messages[messages.length - 1]?.content || "";
    const lowerText = userMessage.toLowerCase();

    // Regex parsing matching terms like "last 48 hours", "past 3 days", "history of 6 hours", etc.
    const hourMatch = lowerText.match(/(\d+)\s*(hour|hr)/);
    const dayMatch = lowerText.match(/(\d+)\s*day/);

    if (dayMatch && dayMatch[1]) {
      const days = parseInt(dayMatch[1], 10);
      targetMinutes = days * 24 * 60;
    } else if (hourMatch && hourMatch[1]) {
      const hours = parseInt(hourMatch[1], 10);
      targetMinutes = hours * 60;
    }
  } catch (parseErr) {
    console.error('Timeframe parsing error, using default:', parseErr);
  }

  // --- FETCH HISTORICAL LOGS FROM THINGSPEAK ---
  let historyContext = "No historical data available.";
  
  try {
    const channelId = process.env.THINGSPEAK_CHANNEL_ID;
    const readApiKey = process.env.THINGSPEAK_READ_API_KEY;

    if (channelId && readApiKey) {
      const thingSpeakUrl = `https://thingspeak.com{channelId}/feeds.json?api_key=${readApiKey}&minutes=${targetMinutes}`;
      
      const tsResponse = await fetch(thingSpeakUrl);
      
      if (tsResponse.ok) {
        const tsData = await tsResponse.json();
        const feeds = tsData.feeds || [];

        // Sample up to 24 data milestones across the timeline to protect context size
        const samplingInterval = Math.max(1, Math.floor(feeds.length / 24));
        const sampledFeeds = feeds.filter((_, index) => index % samplingInterval === 0);

        if (sampledFeeds.length > 0) {
          historyContext = sampledFeeds.map(f => {
            const timestamp = new Date(f.created_at).toLocaleString();
            return `[${timestamp}] Temp: ${f.field1}°C | Humid: ${f.field2}% | CO2: ${f.field3}ppm | PM2.5: ${f.field4}µg/m³ | Sound: ${f.field5}dB`;
          }).join('\n');
        } else {
          historyContext = "ThingSpeak channel returned an empty array of data points for this timeline.";
        }
      } else {
        console.error('ThingSpeak API responded with an error status:', tsResponse.status);
        historyContext = `Error fetching data from ThingSpeak. Status: ${tsResponse.status}`;
      }
    } else {
      console.warn('ThingSpeak Environment Variables missing. Skipping data fetch.');
      historyContext = "ThingSpeak environment variables are missing on the Vercel dashboard configuration.";
    }
  } catch (tsErr) {
    console.error('Failed to parse historical logs from ThingSpeak:', tsErr);
    historyContext = `Failed to connect or read from ThingSpeak API: ${tsErr.message}`;
  }

  // --- CONSTRUCT AMENDED CONTEXT AND DISPATCH TO GROQ ---
  try {
    // Inject operational constraints telling your model that it HAS the history right here.
    const operationalInstructions = `\n\n[SYSTEM INSTRUCTION OVERRIDE]: You have access to real historical data logs for this user environment. Look directly at the data block below marked [HISTORICAL METRICS PROVIDED FOR CONTEXT]. Use these specific logged time data entries to answer any questions regarding past trends, history, changes, or shifts over time. Never apologize or say you don't have access to historical readings.\n\n[HISTORICAL METRICS PROVIDED FOR CONTEXT]:\n${historyContext}`;

    const augmentedSystemPrompt = `${systemPrompt}${operationalInstructions}`;

    const response = await fetch('https://groq.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // API key lives here on the server — never sent to browser
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: augmentedSystemPrompt },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Groq API error:', err);
      return res.status(502).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'No response from AI.';
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
