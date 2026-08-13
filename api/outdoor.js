// api/outdoor.js — proxies OpenWeatherMap so API key stays server-side
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const key = process.env.OWM_API_KEY;
  const lat = '42.0058';
  const lon = '20.9716';

  try {
    // Fetch weather + AQI in parallel
    const [wRes, aqRes] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`),
      fetch(`http://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${key}`)
    ]);

    const weather = await wRes.json();
    const air = await aqRes.json();

    const aqi = air.list?.[0];

    return res.status(200).json({
      temp:        weather.main?.temp ?? null,
      humidity:    weather.main?.humidity ?? null,
      pressure:    weather.main?.pressure ?? null,
      description: weather.weather?.[0]?.description ?? '',
      icon:        weather.weather?.[0]?.main ?? '',
      wind:        weather.wind?.speed ?? null,
      pm25:        aqi?.components?.pm2_5 ?? null,
      co:          aqi?.components?.co ?? null,
      aqi:         aqi?.main?.aqi ?? null,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}