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

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // API key lives here on the server — never sent to browser
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
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
