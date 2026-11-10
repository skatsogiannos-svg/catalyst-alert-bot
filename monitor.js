#!/usr/bin/env node
// 24/7 Universal Multi-Asset Cloud Catalyst Engine
// Ultra-Compact, Laser-Focused Action Alerts (Direct Execution Instructions)

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SEEN_FILE = path.join(ROOT, "seen.json");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const FEEDS = [
  { name: "GlobeNewswire Health", cat: "STOCK", url: "https://www.globenewswire.com/rssfeed/industry/Health%20Care" },
  { name: "PR Newswire Health", cat: "STOCK", url: "https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss" },
  { name: "Yahoo Finance Headlines", cat: "STOCK", url: "https://finance.yahoo.com/news/rssindex" },
  { name: "Cointelegraph", cat: "CRYPTO", url: "https://cointelegraph.com/rss" },
  { name: "CoinDesk", cat: "CRYPTO", url: "https://www.coindesk.com/arc/outboundfeeds/rss" },
  { name: "OilPrice.com", cat: "ENERGY", url: "https://oilprice.com/rss/main" }
];

const KEYWORDS = {
  STOCK: {
    pos: ["met primary endpoint", "statistically significant", "positive topline", "fda approves", "fda approved", "fda grants", "positive phase 2", "positive phase 3", "raises guidance", "merger agreement"],
    neg: ["failed to meet", "did not meet", "missed primary endpoint", "complete response letter", "clinical hold", "discontinues phase", "cuts guidance", "sec investigation"]
  },
  CRYPTO: {
    pos: ["etf approved", "etf approval", "sec approves", "bitcoin reserve", "strategic reserve", "institutional adoption"],
    neg: ["sec sues", "sec charges", "hack", "exploit", "stolen", "banned", "crackdown", "insolvency"]
  },
  ENERGY: {
    pos: ["opec cuts", "opec+ cuts", "production cut", "inventory draw", "crude inventories fall", "pipeline shutdown", "escalation in middle east"],
    neg: ["opec increases", "opec hikes output", "crude inventories surge", "inventory build", "ceasefire"]
  },
  METALS: {
    pos: ["central bank buys gold", "record gold buying", "copper supply deficit", "mine shutdown", "dollar plunges"],
    neg: ["dollar surges", "rate hike", "gold selling", "copper surplus"]
  }
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, timeout: 9000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout: " + url)); });
  });
}

function parseRss(xml, sourceName, cat) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of itemMatches) {
    const block = m[1];
    const pick = (tag) => {
      const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
      return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
    };
    const title = pick("title");
    const link = pick("link") || pick("guid");
    if (title && link) items.push({ title, link, source: sourceName, cat });
  }
  return items;
}

async function getLivePrice(sym) {
  try {
    const raw = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
    const j = JSON.parse(raw);
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    return {
      price: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose || meta.previousClose,
      high52: meta.fiftyTwoWeekHigh,
      low52: meta.fiftyTwoWeekLow,
    };
  } catch (e) {
    return null;
  }
}

function resolveAssetSymbol(category, title) {
  const upper = title.toUpperCase();
  if (category === "CRYPTO") {
    if (upper.includes("ETHEREUM") || upper.includes("ETH")) return { sym: "ETH-USD", name: "ETH (Ethereum)" };
    if (upper.includes("SOLANA") || upper.includes("SOL")) return { sym: "SOL-USD", name: "SOL (Solana)" };
    if (upper.includes("RIPPLE") || upper.includes("XRP")) return { sym: "XRP-USD", name: "XRP" };
    return { sym: "BTC-USD", name: "BTC (Bitcoin)" };
  }
  if (category === "ENERGY") {
    if (upper.includes("GAS") || upper.includes("LNG")) return { sym: "UNG", name: "NATURAL GAS (UNG)" };
    return { sym: "CL=F", name: "WTI CRUDE OIL (Πετρέλαιο)" };
  }
  if (category === "METALS") {
    if (upper.includes("SILVER") || upper.includes("ΑΣΗΜΙ")) return { sym: "SLV", name: "SILVER (Ασήμι)" };
    if (upper.includes("COPPER") || upper.includes("ΧΑΛΚΟΣ")) return { sym: "HG=F", name: "COPPER (Χαλκός)" };
    return { sym: "GC=F", name: "GOLD (Χρυσός)" };
  }
  const tickerMatch = /\(([A-Z]{1,5})\)|\bNASDAQ:\s*([A-Z]{1,5})\b|\bNYSE:\s*([A-Z]{1,5})\b|\$([A-Z]{1,5})\b/.exec(title);
  const ticker = tickerMatch ? (tickerMatch[1] || tickerMatch[2] || tickerMatch[3] || tickerMatch[4]) : null;
  return ticker ? { sym: ticker, name: ticker } : null;
}

function buildLaserCard(assetName, priceData, isPos, title, link) {
  const price = priceData ? priceData.price : null;
  const formatPrice = (v) => v > 500 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v.toFixed(2);

  if (isPos) {
    let sl = price ? Number((price * 0.93).toFixed(2)) : "N/A";
    let tp1 = price ? Number((price * 1.22).toFixed(2)) : "N/A";
    let tp2 = price ? Number((price * 1.50).toFixed(2)) : "N/A";

    const changePct = priceData?.prevClose ? ((price / priceData.prevClose) - 1) * 100 : 0;
    let phase = "Φάση 2 (Pullback - Ιδανική Είσοδος)";
    let horizon = "2-3 εβδομάδες";
    if (changePct > 12) {
      phase = "Φάση 1 (Αρχικό Spike - Προσοχή)";
      horizon = "24-48 ώρες";
    }

    return `
🟢 <b>ΑΓΟΡΑ (LONG): ${assetName}</b>
━━━━━━━━━━━━━━━━━━━━━━
🎯 <b>Είσοδος:</b> <code>$${price ? formatPrice(price) : "Τρέχουσα"}</code>
🛑 <b>Stop Loss:</b> <code>$${price ? formatPrice(sl) : "-7%"} (-7%)</code>
💰 <b>Στόχος 1:</b> <code>$${price ? formatPrice(tp1) : "+22%"} (+22%)</code>
🚀 <b>Στόχος 2:</b> <code>$${price ? formatPrice(tp2) : "+50%"} (+50%)</code>
━━━━━━━━━━━━━━━━━━━━━━
📍 <b>Φάση:</b> ${phase}
⏳ <b>Ορίζοντας:</b> ${horizon}
📰 <b>Νέα:</b> ${title.slice(0, 90)}...
🔗 <a href="${link}">Δελτίο Τύπου</a>
`;
  } else {
    let sl = price ? Number((price * 1.07).toFixed(2)) : "N/A";
    let tp1 = price ? Number((price * 0.78).toFixed(2)) : "N/A";

    return `
🔴 <b>ΠΩΛΗΣΗ / SHORT: ${assetName}</b>
━━━━━━━━━━━━━━━━━━━━━━
🚫 <b>ΔΡΑΣΗ:</b> ΑΜΕΣΗ ΑΠΟΦΥΓΗ / ΠΟΥΛΑ ΑΝ ΕΧΕΙΣ
🎯 <b>Είσοδος Short:</b> <code>$${price ? formatPrice(price) : "Τρέχουσα"}</code>
🛑 <b>Stop Loss:</b> <code>$${price ? formatPrice(sl) : "+7%"} (+7%)</code>
📉 <b>Στόχος:</b> <code>$${price ? formatPrice(tp1) : "-22%"} (-22%)</code>
━━━━━━━━━━━━━━━━━━━━━━
📰 <b>Νέα:</b> ${title.slice(0, 90)}...
🔗 <a href="${link}">Δελτίο Τύπου</a>
`;
  }
}

function sendTelegram(html) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN || !CHAT_ID) return resolve(false);
    const payload = JSON.stringify({ chat_id: CHAT_ID, text: html, parse_mode: "HTML" });
    const req = https.request(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve(JSON.parse(d).ok); } catch (e) { resolve(false); }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.write(payload);
    req.end();
  });
}

async function run() {
  let seen = [];
  try {
    if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
  } catch (e) { seen = []; }
  const seenSet = new Set(seen);

  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml, feed.name, feed.cat);

      for (const item of items) {
        if (!item.link || seenSet.has(item.link)) continue;
        seenSet.add(item.link);

        const lower = item.title.toLowerCase();
        let cat = item.cat;
        if (lower.includes("gold") || lower.includes("silver") || lower.includes("copper")) cat = "METALS";
        else if (lower.includes("oil") || lower.includes("opec") || lower.includes("crude") || lower.includes("natural gas")) cat = "ENERGY";

        const catKws = KEYWORDS[cat] || KEYWORDS.STOCK;
        const isPos = catKws.pos.some((kw) => lower.includes(kw));
        const isNeg = catKws.neg.some((kw) => lower.includes(kw));

        if (isPos || isNeg) {
          const asset = resolveAssetSymbol(cat, item.title);
          const assetName = asset ? asset.name : "MARKET";
          const assetSym = asset ? asset.sym : null;

          const priceData = assetSym ? await getLivePrice(assetSym) : null;
          const msg = buildLaserCard(assetName, priceData, isPos, item.title, item.link);

          console.log(`[ALERT] ${assetName} -> Sent`);
          await sendTelegram(msg);
        }
      }
    } catch (e) {}
  }

  const updatedSeen = Array.from(seenSet).slice(-600);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(updatedSeen, null, 2), "utf8");
}

run().catch(console.error);
