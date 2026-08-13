// api/alert.js — Vercel Serverless Function
// Sends email alerts via Gmail SMTP using Nodemailer.
// GMAIL_USER and GMAIL_PASS stored as Vercel env variables — never in browser.

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { alerts, readings, toEmail } = req.body;
  if (!alerts?.length || !toEmail) return res.status(400).json({ error: 'Missing alerts or toEmail' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return res.status(400).json({ error: 'Invalid email' });

const timestamp = new Date().toLocaleString('en-GB', { 
  dateStyle: 'full', 
  timeStyle: 'short',
  timeZone: 'Europe/Skopje'
});
  const alertCount = alerts.length;

  const alertRows = alerts.map(a => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #e8ede8;font-weight:600">${a.icon} ${a.label}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e8ede8;color:#c0392b;font-family:monospace;font-size:15px">${a.value} ${a.unit}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e8ede8;color:#5a6b5a">Limit: ${a.threshold} ${a.unit}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e8ede8">
        <span style="background:${a.badgeBg};color:${a.badgeColor};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700">${a.status}</span>
      </td>
    </tr>`).join('');

  const readingRows = readings.map(r => `
    <tr>
      <td style="padding:8px 16px;border-bottom:1px solid #f0f4f0;color:#5a6b5a">${r.icon} ${r.label}</td>
      <td style="padding:8px 16px;border-bottom:1px solid #f0f4f0;font-family:monospace">${r.value} ${r.unit}</td>
      <td style="padding:8px 16px;border-bottom:1px solid #f0f4f0">
        <span style="background:${r.badgeBg};color:${r.badgeColor};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">${r.status}</span>
      </td>
    </tr>`).join('');

  const recommendations = [
    alerts.some(a=>a.id==='co2') && '<li><strong>CO₂ high:</strong> Open windows to ventilate the room immediately</li>',
    alerts.some(a=>a.id==='pm')  && '<li><strong>PM2.5 high:</strong> Avoid outdoor activity, use an air purifier if available</li>',
    alerts.some(a=>a.id==='temp')&& '<li><strong>Temperature high:</strong> Increase ventilation or use cooling</li>',
    alerts.some(a=>a.id==='hum') && '<li><strong>Humidity high:</strong> Use a dehumidifier or increase airflow</li>',
    alerts.some(a=>a.id==='snd') && '<li><strong>Sound high:</strong> Identify and reduce noise sources</li>',
    '<li>Monitor the dashboard for changes over the next 15–30 minutes</li>',
  ].filter(Boolean).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f4f0;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#c0392b,#e74c3c);padding:32px;color:#fff">
    <div style="font-size:28px;margin-bottom:8px">⚠️ Air Quality Alert</div>
    <div style="font-size:15px;opacity:.9">${alertCount} threshold${alertCount>1?'s':''} exceeded — attention recommended</div>
    <div style="font-size:12px;opacity:.7;margin-top:6px">${timestamp}</div>
  </div>
  <div style="padding:24px 32px 0">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5a6b5a;margin-bottom:10px">Triggered Alerts</div>
    <table style="width:100%;border-collapse:collapse;background:#fdecea;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#fadbd8">
        <th style="padding:10px 16px;text-align:left;font-size:12px;color:#7a1515">Sensor</th>
        <th style="padding:10px 16px;text-align:left;font-size:12px;color:#7a1515">Reading</th>
        <th style="padding:10px 16px;text-align:left;font-size:12px;color:#7a1515">Threshold</th>
        <th style="padding:10px 16px;text-align:left;font-size:12px;color:#7a1515">Status</th>
      </tr></thead>
      <tbody>${alertRows}</tbody>
    </table>
  </div>
  <div style="padding:24px 32px 0">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5a6b5a;margin-bottom:10px">All Current Readings</div>
    <table style="width:100%;border-collapse:collapse"><tbody>${readingRows}</tbody></table>
  </div>
  <div style="padding:24px 32px">
    <div style="background:#f0f4f0;border-radius:10px;padding:16px 20px">
      <div style="font-size:13px;font-weight:700;color:#111a11;margin-bottom:10px">💡 Recommended Actions</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#5a6b5a;line-height:1.8">${recommendations}</ul>
    </div>
  </div>
  <div style="background:#f0f4f0;padding:20px 32px;text-align:center">
    <a href="https://airwatch-rose.vercel.app" style="display:inline-block;background:#1a7a41;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:12px">Open AirWatch Dashboard →</a>
    <div style="font-size:11px;color:#5a6b5a">AirWatch · ESP32 IoT Air Quality Monitor · Channel #3389722</div>
    <div style="font-size:11px;color:#5a6b5a;margin-top:4px">You enabled email alerts on the AirWatch dashboard.</div>
  </div>
</div>
</body></html>`;

  try {
    // Create Gmail transporter using app password
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS, // 16-char app password, NOT your real Gmail password
      },
    });

    await transporter.sendMail({
      from: `"AirWatch Alerts" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: `⚠️ AirWatch — ${alertCount} alert${alertCount>1?'s':''} triggered`,
      html,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Gmail SMTP error:', err);
    return res.status(500).json({ error: 'Failed to send email', detail: err.message });
  }
}