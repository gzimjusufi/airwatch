export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { messages, systemPrompt } = req.body;

  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'Missing messages or systemPrompt' });
  }

  if (messages.length > 20) {
    return res.status(429).json({ error: 'Too many messages in context' });
  }

  // --- NEW: FETCH HISTORICAL DATA FROM THINGSPEAK ---
  let historyContext = "No historical logs available.";
  try {
    const channelId = process.env.THINGSPEAK_CHANNEL_ID;
    const readKey = process.env.THINGSPEAK_READ_API_KEY;
    
    // Fetch data points spanning the last 24 hours (1440 minutes)
    const thingSpeakUrl = `https://thingspeak.com{channelId}/feeds.json?api_key=${readKey}&minutes=1440`;
    
    const tsResponse = await fetch(thingSpeakUrl);
    if (tsResponse.ok) {
      const tsData = await tsResponse.json();
      
      // Keep it compact so you do not exceed Groq's max context size
      // Slice to analyze every Nth reading or just the last 20 sequential intervals
      const recentFeeds = tsData.feeds ? tsData.feeds.slice(-20) : [];
      
      historyContext = recentFeeds.map(f => 
        `Time: ${f.created_at} | T: ${f.field1}°C | H: ${f.field2}% | CO2: ${f.field3}ppm | PM2.5: ${f.field4}µg/m³ | Sound: ${f.field5}dB`
      ).join('\n');
    }
  } catch (tsErr) {
    console.error('Failed to pull historical logs from ThingSpeak:', tsErr);
    // Fail silently or fallback so the chatbot doesn't completely crash if ThingSpeak is down
  }
  // ----------------------------------------------------

  try {
    // Inject the structured history straight into the system prompt block
    const augmentedSystemPrompt = `${systemPrompt}\n\n[HISTORICAL DATA - LAST 24 HOURS]:\n${historyContext}`;

    const response = await fetch('https://groq.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b', // Standardized official ID fixed from before
        max_tokens: 400,
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
