// api/chat.js — Vercel Serverless Function

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { messages, systemPrompt, isInsight } = req.body;

  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'Missing messages or systemPrompt' });
  }

  // 1. Setup Your Model Profiles
  let selectedModel = 'openai/gpt-oss-120b'; // Premium chat model
  let dynamicMaxTokens = 4096;
  let dynamicTemperature = 0.7; 
  let finalSystemPrompt = systemPrompt;

  // 2. Lock down the 27B model profile for the Insight feature
  if (isInsight) {
    selectedModel = 'qwen-3.6-27b'; // Explicit Groq Model ID for Qwen 27B
    dynamicMaxTokens = 1000;
    
    // Near-zero temperature locks down the model to strictly follow data constraints
    dynamicTemperature = 0.1; 

    // Inject strict system constraints to force AirWatch & Offline status compliance
    finalSystemPrompt = `${systemPrompt}
    
    CRITICAL TOPICAL GUARDRAILS:
    1. You are an exclusive data analytics engine for AirWatch (Workspace ONE UEM) mobile device management data.
    2. Do NOT mention alternative MDM platforms, general web search references, or unrelated software.
    3. DEVICE OFFLINE RULE: You must check the device connection logs or last-seen status. If the data shows the device is disconnected, unreachable, or offline, you MUST explicitly state that the device is "Offline" right away in your response.
    4. If the user data history or input is entirely missing AirWatch relevant data, reply ONLY with: "No AirWatch insight data available."
    5. Keep your observations brief, grounded, and focused on device registration, profiles, compliance logs, or console actions.`;
  }

  try {
    const response = await fetch('https://groq.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: dynamicMaxTokens,
        temperature: dynamicTemperature, 
        messages: [
          { role: 'system', content: finalSystemPrompt },
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
