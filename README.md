# 🌿 AirWatch — IoT Air Quality Monitor

> Real-time air quality monitoring system built with ESP32, multiple environmental sensors, ThingSpeak cloud, and an AI-powered web dashboard.

---

## 📸 Demo

Live dashboard → **[your-project.vercel.app](https://your-project.vercel.app)**  
ThingSpeak Channel → **[#3389722](https://thingspeak.com/channels/3389722)**

---

## 🔧 Hardware Components

| Component | Purpose |
|-----------|---------|
| ESP32 CP2102 Type-C | Main microcontroller — Wi-Fi, dual-core 32-bit |
| AHT20 | Temperature & humidity sensor (I²C) |
| BMP280 | Atmospheric pressure sensor (I²C) |
| SCD40 | Photoacoustic CO₂ sensor — 400–2000 ppm (I²C) |
| PMS5003 | Laser PM2.5 / PM10 particulate sensor (UART) |
| MAX4466 | Electret microphone amplifier — sound level |
| OLED 0.96″ | On-device real-time display (I²C, SSD1306) |
| Breadboard + Jumper Wires | Prototyping connections |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    ESP32 Device                      │
│  AHT20 ──┐                                          │
│  BMP280 ──┤  (I²C)                                  │
│  SCD40 ───┼──► ESP32 ──► OLED Display (live)        │
│  PMS5003 ─┤  (UART)     └──► ThingSpeak (Wi-Fi)    │
│  MAX4466 ─┘  (ADC)                                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   ThingSpeak Cloud    │
              │   Channel #3389722    │
              │   6 fields / 20-30s   │
              └───────────┬───────────┘
                          │ REST API
                          ▼
              ┌───────────────────────┐
              │   AirWatch Web App    │
              │   Vercel Deployment   │
              │                       │
              │  • Live Dashboard     │
              │  • Historical Charts  │
              │  • Alert Thresholds   │
              │  • AI Chatbot (Groq)  │
              │  • Outdoor Comparison │
              └───────────────────────┘
```

---

## 📊 Monitored Parameters

| Field | Sensor | Unit | Good Range |
|-------|--------|------|------------|
| Temperature | AHT20 | °C | 16 – 26°C |
| Humidity | AHT20 | % | 30 – 60% |
| Pressure | BMP280 | hPa | 990 – 1030 hPa |
| CO₂ | SCD40 | ppm | < 600 ppm |
| PM2.5 | PMS5003 | µg/m³ | ≤ 12 µg/m³ |
| Sound Level | MAX4466 | dB | < 40 dB |

---

## 💻 Web Dashboard Features

- ✅ **Live sensor cards** with color-coded status badges
- ✅ **AQI indicator** (Air Quality Index) based on PM2.5
- ✅ **Real-time charts** — auto-refresh every 30 seconds
- ✅ **Historical data** — last 1h / 6h / 24h / 7 days, with server-side windowed queries (not just client-side filtering)
- ✅ **CSV export** of historical readings
- ✅ **Configurable alerts** with per-parameter threshold toggles and a running alert log
- ✅ **Email notifications** — sent via a secure serverless function (Nodemailer + Gmail SMTP) when a threshold is exceeded
- ✅ **Outdoor comparison** — live outdoor weather + air pollution data (OpenWeatherMap) shown side-by-side with indoor readings, including deltas
- ✅ **AI chatbot** (AirWatch AI) powered by Groq (`openai/gpt-oss-20b`) — reads live and historical sensor context to answer natural-language questions
- ✅ **Offline detection** — detects when the ESP32 has stopped sending data
- ✅ **Dark mode** + mobile responsive
- ✅ **Secure API proxies** — Groq, Gmail, and OpenWeatherMap credentials all stay server-side via Vercel environment variables

---

## 🚀 Deployment

### Prerequisites
- [Vercel account](https://vercel.com) (free)
- [Groq API key](https://console.groq.com) (free)
- [OpenWeatherMap API key](https://openweathermap.org/api) (free)
- A Gmail account with an [app password](https://myaccount.google.com/apppasswords) (for email alerts)
- [GitHub account](https://github.com)

### Steps

**1. Clone the repo**
```bash
git clone https://github.com/YOUR_USERNAME/airwatch.git
cd airwatch
```

**2. Deploy to Vercel**
- Go to [vercel.com](https://vercel.com) → New Project
- Import your GitHub repository
- Add environment variables:
  ```
  GROQ_API_KEY           = your_groq_key_here
  THINGSPEAK_CHANNEL_ID  = your_channel_id_here
  THINGSPEAK_READ_API_KEY = your_thingspeak_read_key_here
  OWM_API_KEY             = your_openweathermap_key_here
  GMAIL_USER              = your_gmail_address_here
  GMAIL_PASS               = your_gmail_app_password_here
  ```
- Click Deploy

**3. Done!** Your dashboard is live at `https://your-project.vercel.app`

---

## 📁 Project Structure

```
airwatch/
├── index.html          # Main web dashboard (HTML/CSS/JS, single page, five views)
├── api/
│   ├── chat.js          # Serverless proxy to the Groq chat completion API
│   ├── alert.js          # Serverless function that formats and sends alert emails
│   └── outdoor.js        # Serverless proxy to the OpenWeatherMap API
├── vercel.json           # Vercel routing and header configuration
├── package.json          # Node dependencies (nodemailer)
├── .gitignore
└── README.md
```

---

## 🔐 Security

None of the third-party credentials are ever exposed to the browser. The Groq API key, the ThingSpeak read key, the OpenWeatherMap key, and the Gmail app password are all read from server-side Vercel environment variables and injected into outgoing requests inside their respective serverless functions (`chat.js`, `outdoor.js`, `alert.js`). The browser only ever talks to AirWatch's own `/api/*` endpoints, never to the third-party providers directly.

---

## 📚 Tech Stack

| Layer | Technology |
|-------|-----------|
| Microcontroller | ESP32 Arduino (C++) |
| Cloud Platform | ThingSpeak |
| Frontend | HTML5 / CSS3 / Vanilla JS |
| Charts | Chart.js v4 |
| AI | Groq API (`openai/gpt-oss-20b`) |
| Outdoor data | OpenWeatherMap (weather + air pollution API) |
| Email | Nodemailer + Gmail SMTP |
| Backend | Vercel Serverless Functions |
| Deployment | Vercel |

---

## 👨‍💻 Author

**Gëzim Jusufi**  
Computer Science — South East European University (SEEU)  
Mentor: Prof. Dr. Mennan Selimi  
Capstone Project — 2025

---

## 📄 License

MIT License — free to use and modify.
