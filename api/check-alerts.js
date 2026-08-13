// /api/check-alerts.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const CH = '3389722', KEY = 'MR7NAISO5CSJT7S7';

const ALERTS_DEF = [
  { id:'co2', label:'CO₂', unit:'ppm', field:'field4' },
  { id:'pm',  label:'PM2.5', unit:'µg/m³', field:'field5' },
  { id:'temp',label:'Temperature', unit:'°C', field:'field1' },
  { id:'hum', label:'Humidity', unit:'%', field:'field2' },
  { id:'snd', label:'Sound', unit:'dB', field:'field6' },
];

export default async function handler(req, res) {
  // 1. Get latest reading
  const r = await fetch(`https://api.thingspeak.com/channels/${CH}/feeds.json?api_key=${KEY}&results=1`);
  const j = await r.json();
  const latest = j.feeds?.[0];
  if (!latest) return res.status(200).json({ skipped: 'no data' });

  // 2. Load thresholds/email/cooldown from Upstash
  const thresholds = await redis.get('thresholds') || {};
  const enabled    = await redis.get('enabled')    || {};
  const toEmail    = await redis.get('alert_email');
  const lastSent   = await redis.get('last_email_sent') || 0;

  if (!toEmail) return res.status(200).json({ skipped: 'no email configured' });
  if (Date.now() - lastSent < 10 * 60 * 1000) return res.status(200).json({ skipped: 'cooldown' });

  // 3. Check thresholds
  const fired = [];
  for (const a of ALERTS_DEF) {
    if (!enabled[a.id]) continue;
    const v = parseFloat(latest[a.field]);
    if (!isNaN(v) && v > thresholds[a.id]) fired.push({ ...a, value: v });
  }

  if (!fired.length) return res.status(200).json({ skipped: 'no threshold exceeded' });

  // 4. Send email (triggers your existing /api/alert logic)
  await fetch(`${process.env.VERCEL_URL ? 'https://'+process.env.VERCEL_URL : ''}/api/alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alerts: fired, toEmail }),
  });

  await redis.set('last_email_sent', Date.now());
  res.status(200).json({ sent: true, fired });
}
