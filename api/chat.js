// api/chat.js — Vercel Serverless Function

export default async function handler(req, res) {
  // =========================================================
  // CORS
  // =========================================================

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  // Browser CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    // =======================================================
    // 1. READ REQUEST BODY
    // =======================================================

    const { messages, systemPrompt } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Missing or invalid messages',
      });
    }

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return res.status(400).json({
        error: 'Missing systemPrompt',
      });
    }

    // Basic abuse protection
    if (messages.length > 20) {
      return res.status(429).json({
        error: 'Too many messages in context',
      });
    }

    // =======================================================
    // 2. ENVIRONMENT VARIABLES
    // =======================================================

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const THINGSPEAK_CHANNEL_ID =
      process.env.THINGSPEAK_CHANNEL_ID;
    const THINGSPEAK_READ_API_KEY =
      process.env.THINGSPEAK_READ_API_KEY;

    if (!GROQ_API_KEY) {
      console.error('GROQ_API_KEY is missing');

      return res.status(500).json({
        error: 'GROQ_API_KEY is not configured on Vercel',
      });
    }

    if (!THINGSPEAK_CHANNEL_ID) {
      console.error('THINGSPEAK_CHANNEL_ID is missing');

      return res.status(500).json({
        error: 'THINGSPEAK_CHANNEL_ID is not configured on Vercel',
      });
    }

    if (!THINGSPEAK_READ_API_KEY) {
      console.error('THINGSPEAK_READ_API_KEY is missing');

      return res.status(500).json({
        error: 'THINGSPEAK_READ_API_KEY is not configured on Vercel',
      });
    }

    // =======================================================
    // 3. GET LIVE DATA FROM THINGSPEAK
    // =======================================================

    const thingSpeakUrl =
      `https://api.thingspeak.com/channels/` +
      `${encodeURIComponent(THINGSPEAK_CHANNEL_ID)}` +
      `/feeds.json` +
      `?api_key=${encodeURIComponent(THINGSPEAK_READ_API_KEY)}` +
      `&results=10`;

    console.log(
      'Fetching ThingSpeak channel:',
      THINGSPEAK_CHANNEL_ID
    );

    const thingSpeakResponse = await fetch(thingSpeakUrl);

    if (!thingSpeakResponse.ok) {
      const errorText = await thingSpeakResponse.text();

      console.error(
        'ThingSpeak API error:',
        thingSpeakResponse.status,
        errorText
      );

      return res.status(502).json({
        error: 'Unable to read ThingSpeak data',
        detail: errorText,
      });
    }

    const thingSpeakData = await thingSpeakResponse.json();

    const channel = thingSpeakData.channel || {};
    const feeds = Array.isArray(thingSpeakData.feeds)
      ? thingSpeakData.feeds
      : [];

    // Most recent reading
    const latestReading =
      feeds.length > 0
        ? feeds[feeds.length - 1]
        : null;

    console.log(
      `ThingSpeak returned ${feeds.length} readings`
    );

    // =======================================================
    // 4. CREATE SENSOR CONTEXT FOR AI
    // =======================================================

    const sensorData = {
      channel: {
        id: channel.id || null,
        name: channel.name || null,
        description: channel.description || null,
        latitude: channel.latitude || null,
        longitude: channel.longitude || null,
        field1: channel.field1 || null,
        field2: channel.field2 || null,
        field3: channel.field3 || null,
        field4: channel.field4 || null,
        field5: channel.field5 || null,
        field6: channel.field6 || null,
        field7: channel.field7 || null,
        field8: channel.field8 || null,
      },

      latestReading,

      recentReadings: feeds,
    };

    // =======================================================
    // 5. SYSTEM PROMPT
    // =======================================================

    const aiSystemPrompt = `
${systemPrompt}

You are AirWatch AI, an intelligent air-quality assistant.

You have access to live sensor data from a ThingSpeak channel.

IMPORTANT:
The data below is the actual sensor data available right now.

LIVE THINGSPEAK DATA:
${JSON.stringify(sensorData, null, 2)}

INSTRUCTIONS:

1. Use the ThingSpeak data when answering questions about
   current air quality or sensor readings.

2. The "latestReading" object contains the newest available
   sensor reading.

3. Do not invent sensor values.

4. If a requested sensor value is not available, say that
   the value is unavailable.

5. If the user asks whether the air is good, evaluate the
   available measurements and explain the result simply.

6. If the user asks whether they should open a window, give
   practical advice based on the available air-quality data.

7. If the user asks about PM2.5, CO2, temperature, humidity,
   VOC, AQI, or another measurement, use the corresponding
   available field.

8. If the exact meaning of a field is not provided, do not
   pretend you know what it represents.

9. When discussing health effects, be informative and avoid
   making medical diagnoses.

10. Keep normal answers concise and easy to understand.

11. If there is insufficient sensor data to answer confidently,
    explain what data is missing.

The current sensor data is authoritative for current readings.
`;

    // =======================================================
    // 6. PREPARE GROQ MESSAGES
    // =======================================================

    const groqMessages = [
      {
        role: 'system',
        content: aiSystemPrompt,
      },
      ...messages,
    ];

    // =======================================================
    // 7. CALL GROQ
    // =======================================================

    console.log('Calling Groq AI...');

    const groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },

        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: groqMessages,
          max_tokens: 2000,
          temperature: 0.3,
        }),
      }
    );

    // =======================================================
    // 8. HANDLE GROQ ERROR
    // =======================================================

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();

      console.error(
        'Groq API error:',
        groqResponse.status,
        errorText
      );

      return res.status(502).json({
        error: 'AI service error',
        status: groqResponse.status,
        detail: errorText,
      });
    }

    const groqData = await groqResponse.json();

    // =======================================================
    // 9. EXTRACT AI RESPONSE
    // =======================================================

    const reply =
      groqData?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error(
        'Groq returned an empty response:',
        JSON.stringify(groqData)
      );

      return res.status(502).json({
        error: 'AI returned an empty response',
      });
    }

    // =======================================================
    // 10. RETURN RESULT TO FRONTEND
    // =======================================================

    return res.status(200).json({
      success: true,

      reply,

      thingSpeak: {
        channel: channel,
        latestReading: latestReading,
        recentReadings: feeds,
      },
    });

  } catch (error) {
    // =======================================================
    // GLOBAL ERROR HANDLER
    // =======================================================

    console.error('Chat API error:', error);

    return res.status(500).json({
      error: 'Internal server error',
      detail: error?.message || 'Unknown error',
    });
  }
}