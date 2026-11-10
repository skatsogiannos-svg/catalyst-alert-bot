#!/usr/bin/env node
// 24/7 Cloud Catalyst & SEC Monitor for GitHub Actions
// Pure Node.js - Zero dependencies
// Delivers specific Actionable Trade Plans for BOTH Positive (Long) and Negative (Short / Avoid) Catalysts!

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
  "cuts guidance", "lowers full year", "doj probe", "sec investigation",
  "delisting notice", "bankruptcy", "chapter 11", "restatement of financial"
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

function calculateLongPlan(marketData) {
  const price = marketData.price;
  const high52 = marketData.high52 || price * 1.5;

  const stopLoss = Number((price * 0.925).toFixed(2));
  const risk = price - stopLoss;
  const tp1 = Number((price * 1.22).toFixed(2));
  const tp2 = Number(Math.max(price * 1.5, high52).toFixed(2));
  const rrRatio = risk > 0 ? ((tp1 - price) / risk).toFixed(1) : "2.9";

  return `
📊 <b>ΣΧΕΔΙΟ ΑΝΟΔΙΚΗΣ ΣΥΝΑΛΛΑΓΗΣ (LONG PLAN):</b>
• <b>Ζώνη Εισόδου (Entry):</b> <code>$${(price * 0.99).toFixed(2)} - $${(price * 1.01).toFixed(2)}</code>
• <b>Stop Loss:</b> <code>$${stopLoss} (-7.5%)</code>
• <b>Take Profit 1:</b> <code>$${tp1} (+22.0%)</code>
• <b>Take Profit 2 (Max):</b> <code>$${tp2}</code>
• <b>Σχέση R:R:</b> <code>1:${rrRatio}</code>
`;
}

function calculateShortPlan(marketData) {
  const price = marketData.price;
  const low52 = marketData.low52 || price * 0.5;

  // Short Stop Loss is above current price (+7.0%)
  const stopLoss = Number((price * 1.07).toFixed(2));
  const risk = stopLoss - price;

  // Short Downside Targets
  const tp1 = Number((price * 0.78).toFixed(2)); // -22% fall
  const tp2 = Number(Math.min(price * 0.55, low52).toFixed(2)); // -45% to 52-week low
  const reward1 = price - tp1;
  const rrRatio = risk > 0 ? (reward1 / risk).toFixed(1) : "3.1";

  return `
⚠️ <b>ΕΠΕΙΓΟΥΣΑ ΠΡΟΕΙΔΟΠΟΙΗΣΗ ΚΑΤΑΡΡΕΥΣΗΣ (RISK ALERT):</b>
• <b>Σύσταση:</b> 🚫 <b>ΑΜΕΣΗ ΑΠΟΦΥΓΗ ΑΓΟΡΑΣ</b> (Μην πιάνετε πέφτοντα μαχαίρια!).
• <b>Αν κατέχετε τη μετοχή:</b> Εξέταση άμεσης ρευστοποίησης (Exit) για αποφυγή περαιτέρω κατάρρευσης.

📉 <b>ΣΧΕΔΙΟ ΠΤΩΤΙΚΗΣ ΣΥΝΑΛΛΑΓΗΣ (SHORT / PUT OPTIONS):</b>
• <b>Ζώνη Εισόδου Short:</b> <code>$${(price * 0.99).toFixed(2)} - $${(price * 1.01).toFixed(2)}</code>
• <b>Stop Loss (Short):</b> <code>$${stopLoss} (+7.0%)</code>
• <b>Πτωτικός Στόχος 1:</b> <code>$${tp1} (-22.0%)</code>
• <b>Πτωτικός Στόχος 2:</b> <code>$${tp2} (52-Week Low)</code>
• <b>Σχέση R:R:</b> <code>1:${rrRatio}</code>
`;
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
          const tickerMatch = /\(([A-Z]{1,5})\)|\bNASDAQ:\s*([A-Z]{1,5})\b|\bNYSE:\s*([A-Z]{1,5})\b|\$([A-Z]{1,5})\b/.exec(item.title);
          const ticker = tickerMatch ? (tickerMatch[1] || tickerMatch[2] || tickerMatch[3] || tickerMatch[4]) : "NEWS";

          let tradeSection = "";
          if (ticker !== "NEWS") {
            const marketData = await getLivePriceData(ticker);
            if (marketData) {
              tradeSection = isPos ? calculateLongPlan(marketData) : calculateShortPlan(marketData);
            }
          }

          const badge = isPos
            ? "🟢 <b>ΘΕΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (BUY / LONG ALERT)</b>"
            : "🔴 <b>ΑΡΝΗΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (AVOID / SHORT ALERT)</b>";

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
          console.log(`[ALERT] ${ticker} (${isPos ? 'POS' : 'NEG'}): ${item.title}`);
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
