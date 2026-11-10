#!/usr/bin/env node
// 24/7 Cloud Catalyst & SEC Monitor for GitHub Actions
// Pure Node.js - Zero dependencies
// Delivers specific Actionable Trade Plans: Entry, Stop Loss, Take Profit 1 & 2, Risk/Reward!

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SEEN_FILE = path.join(ROOT, "seen.json");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const POSITIVE_KEYWORDS = [
  "met primary endpoint", "statistically significant", "positive topline",
  "fda approves", "fda approved", "fda grants", "fda clearance",
  "breakthrough therapy", "fast track designation", "priority review",
  "positive phase 2", "positive phase 3", "positive phase 1",
  "raises guidance", "raised full year", "beats estimates",
  "to be acquired by", "merger agreement", "strategic partnership"
];

const NEGATIVE_KEYWORDS = [
  "failed to meet", "did not meet", "missed primary endpoint",
  "complete response letter", "clinical hold", "discontinues phase",
  "cuts guidance", "lowers full year", "doj probe", "sec investigation"
];

const FEEDS = [
  { name: "GlobeNewswire Health", url: "https://www.globenewswire.com/rssfeed/industry/Health%20Care" },
  { name: "PR Newswire Health", url: "https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss" },
  { name: "Yahoo Finance Headlines", url: "https://finance.yahoo.com/news/rssindex" }
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        timeout: 9000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout: " + url));
    });
  });
}

function parseRss(xml, sourceName) {
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
    if (title && link) {
      items.push({
        title,
        link,
        source: sourceName,
      });
    }
  }
  return items;
}

async function getLivePriceData(ticker) {
  if (!ticker || ticker === "NEWS") return null;
  try {
    const raw = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`);
    const j = JSON.parse(raw);
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    return {
      price: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose,
      high52: meta.fiftyTwoWeekHigh,
      low52: meta.fiftyTwoWeekLow,
    };
  } catch (e) {
    return null;
  }
}

function calculateTradePlan(marketData) {
  const price = marketData.price;
  const high52 = marketData.high52 || price * 1.5;

  // Stop loss: -7.5% from entry (controlled risk for catalyst breakout)
  const stopLoss = Number((price * 0.925).toFixed(2));
  const risk = price - stopLoss;

  // Take Profit 1: +22% (Quick momentum expansion)
  const tp1 = Number((price * 1.22).toFixed(2));
  const reward1 = tp1 - price;

  // Take Profit 2: 52-week high or +50%
  const tp2 = Number(Math.max(price * 1.5, high52).toFixed(2));

  const rrRatio = risk > 0 ? (reward1 / risk).toFixed(1) : "2.9";

  return {
    entryZone: `$${(price * 0.99).toFixed(2)} - $${(price * 1.01).toFixed(2)}`,
    stopLoss: `$${stopLoss} (-7.5%)`,
    tp1: `$${tp1} (+22.0%)`,
    tp2: `$${tp2}`,
    riskReward: `1:${rrRatio}`,
    currentPrice: `$${price.toFixed(2)}`,
  };
}

function sendTelegram(html) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN || !CHAT_ID) {
      console.log("[i] Δεν έχουν οριστεί TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (skip notification).");
      return resolve(false);
    }
    const payload = JSON.stringify({
      chat_id: CHAT_ID,
      text: html,
      parse_mode: "HTML",
    });

    const req = https.request(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(d);
            resolve(j.ok);
          } catch (e) {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log("=== 24/7 Cloud Catalyst Scanner Starting ===");
  let seen = [];
  try {
    if (fs.existsSync(SEEN_FILE)) {
      seen = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
    }
  } catch (e) {
    seen = [];
  }
  const seenSet = new Set(seen);
  let newAlertCount = 0;

  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml, feed.name);
      
      for (const item of items) {
        if (!item.link || seenSet.has(item.link)) continue;
        seenSet.add(item.link);

        const lower = item.title.toLowerCase();
        const isPos = POSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
        const isNeg = NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw));

        if (isPos || isNeg) {
          // Extract ticker
          const tickerMatch = /\(([A-Z]{1,5})\)|\bNASDAQ:\s*([A-Z]{1,5})\b|\bNYSE:\s*([A-Z]{1,5})\b|\$([A-Z]{1,5})\b/.exec(item.title);
          const ticker = tickerMatch ? (tickerMatch[1] || tickerMatch[2] || tickerMatch[3] || tickerMatch[4]) : "NEWS";

          let tradeSection = "";
          if (isPos && ticker !== "NEWS") {
            const marketData = await getLivePriceData(ticker);
            if (marketData) {
              const plan = calculateTradePlan(marketData);
              tradeSection = `
📊 <b>ΣΧΕΔΙΟ ΣΥΝΑΛΛΑΓΗΣ (TRADE PLAN):</b>
• <b>Ζώνη Εισόδου (Entry):</b> <code>${plan.entryZone}</code>
• <b>Stop Loss:</b> <code>${plan.stopLoss}</code>
• <b>Take Profit 1:</b> <code>${plan.tp1}</code>
• <b>Take Profit 2 (Max):</b> <code>${plan.tp2}</code>
• <b>Σχέση R:R:</b> <code>${plan.riskReward}</code>
`;
            }
          }

          const badge = isPos ? "🟢 <b>ΘΕΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (BUY ALERT)</b>" : "🔴 <b>ΑΡΝΗΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (AVOID)</b>";

          const msg = `
🚨 <b>ACTIONABLE CATALYST SIGNAL</b> 🚨

<b>Ticker:</b> <code>${ticker}</code>
<b>Ετυμηγορία:</b> ${badge}
${tradeSection}
📰 <b>Ανακοίνωση:</b> ${item.title}
<b>Πηγή:</b> ${item.source}
🔗 <a href="${item.link}">Διαβάστε το Πρωτότυπο Δελτίο Τύπου</a>

⚡ <i>Αυτόματο σήμα από το Cloud Catalyst Engine</i>
`;
          console.log(`[ALERT] ${ticker}: ${item.title}`);
          await sendTelegram(msg);
          newAlertCount++;
        }
      }
    } catch (e) {
      console.log(`[!] Σφάλμα ανάγνωσης feed ${feed.name}: ${e.message}`);
    }
  }

  const updatedSeen = Array.from(seenSet).slice(-500);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(updatedSeen, null, 2), "utf8");

  console.log(`=== Ολοκληρώθηκε: ${newAlertCount} νέες ειδοποιήσεις εστάλησαν ===`);
}

run().catch(console.error);
