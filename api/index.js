const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { HttpsProxyAgent } = require("https-proxy-agent");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Proxy list
const proxies = [
  "http://139.99.237.62:80",
  "http://94.46.172.104:80",
  "http://222.252.194.29:8080",
  "http://78.28.152.111:80"
];

// 🔹 Rotate proxies
function getRandomProxy() {
  return proxies[Math.floor(Math.random() * proxies.length)];
}

// 🔹 Rotate User-Agent
function getRandomUserAgent() {
  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/118.0"
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

// 🔹 Robust fetch with retries & proxy
async function fetchPage(url, retries = 3, delay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const proxy = getRandomProxy();
      console.log(`🌐 Using proxy: ${proxy}`);
      const agent = HttpsProxyAgent(proxy); // ✅ FIXED

      const response = await axios.get(url, {
        httpsAgent: agent,
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.google.com/",
          "Connection": "keep-alive"
        },
        timeout: 20000
      });

      return response.data;
    } catch (err) {
      console.warn(`⚠️ Attempt ${attempt} failed (${err.message})`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw new Error(`❌ Failed after ${retries} attempts: ${err.message}`);
      }
    }
  }
}

// 🔹 Example route scraping OpenNPI
app.get("/", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider?taxonomy=183500000X";
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Example: grab provider names
    const providers = [];
    $(".card-title a").each((i, el) => {
      providers.push($(el).text().trim());
    });

    res.json({ success: true, count: providers.length, providers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
