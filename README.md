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
              │   6 fields / 30s      │
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
- ✅ **Historical data** — last 1h / 6h / 24h / 7 days
- ✅ **CSV export** of historical readings
- ✅ **Configurable alerts** with threshold toggles
- ✅ **AI chatbot** powered by Groq (llama-3.3-70b) — analyses live data
- ✅ **Offline detection** — detects when ESP32 is not sending data
- ✅ **Dark mode** + mobile responsive
- ✅ **Secure API proxy** — Groq key stored server-side via Vercel

---

## 🚀 Deployment

### Prerequisites
- [Vercel account](https://vercel.com) (free)
- [Groq API key](https://console.groq.com) (free)
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
- Add environment variable:
  ```
  GROQ_API_KEY = your_key_here
  ```
- Click Deploy

**3. Done!** Your dashboard is live at `https://your-project.vercel.app`

---

## 📁 Project Structure

```
airwatch/
├── index.html          # Main web dashboard (HTML/CSS/JS)
├── api/
│   └── chat.js         # Vercel serverless function (Groq proxy)
├── vercel.json         # Vercel routing config
├── .gitignore
└── README.md
```

---

## 🔐 Security

The Groq API key is **never exposed to the browser**. All AI requests go through `/api/chat` — a Vercel serverless function that injects the key server-side from environment variables.

---

## 📚 Tech Stack

| Layer | Technology |
|-------|-----------|
| Microcontroller | ESP32 Arduino (C++) |
| Cloud Platform | ThingSpeak |
| Frontend | HTML5 / CSS3 / Vanilla JS |
| Charts | Chart.js v4 |
| AI | Groq API (llama-3.3-70b-versatile) |
| Backend | Vercel Serverless Functions |
| Deployment | Vercel |

---

## 👨‍💻 Author

**Gëzim Jusufi**  
Computer Science — South East European University (SEEU)  
Mentor: Prof. Dr. Mennan Sali  
Capstone Project — 2025

---

## 📄 License

MIT License — free to use and modify.
