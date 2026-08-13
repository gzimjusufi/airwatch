// /api/settings.js
import { Redis } from '@upstash/redis';

// This automatically hooks into the Upstash environment variables added by Vercel
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const thresholds = await redis.get('thresholds') || {};
    const enabled    = await redis.get('enabled') || {};
    const toEmail    = await redis.get('alert_email') || '';
    return res.status(200).json({ thresholds, enabled, toEmail });
  }
  if (req.method === 'POST') {
    const { thresholds, enabled, toEmail } = req.body;
    if (thresholds) await redis.set('thresholds', thresholds);
    if (enabled)    await redis.set('enabled', enabled);
    if (toEmail !== undefined) await redis.set('alert_email', toEmail);
    return res.status(200).json({ saved: true });
  }
  res.status(405).end();
}
