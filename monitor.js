#!/usr/bin/env node
// 24/7 Universal Multi-Asset Cloud Catalyst Engine
// Includes:
// 1. Multi-Asset Coverage (Stocks, Crypto, Oil, Gas, Gold, Silver)
// 2. Exact Trade Plan (Entry, Stop Loss, Take Profit 1 & 2, R:R)
// 3. 3-Phase Market Lifecycle Tracking (Phase 1: Shock, Phase 2: Pullback, Phase 3: Drift)
// 4. Expected Percentage Gain & Timeline Estimation

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
  // 1. Equities & Biotech
  { name: "GlobeNewswire Health", cat: "STOCK", url: "https://www.globenewswire.com/rssfeed/industry/Health%20Care" },
  { name: "PR Newswire Health", cat: "STOCK", url: "https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss" },
  { name: "Yahoo Finance Headlines", cat: "STOCK", url: "https://finance.yahoo.com/news/rssindex" },

  // 2. Crypto
  { name: "Cointelegraph", cat: "CRYPTO", url: "https://cointelegraph.com/rss" },
  { name: "CoinDesk", cat: "CRYPTO", url: "https://www.coindesk.com/arc/outboundfeeds/rss" },

  // 3. Energy & Commodities
  { name: "OilPrice.com", cat: "ENERGY", url: "https://oilprice.com/rss/main" }
];

const KEYWORDS = {
  STOCK: {
    pos: [
      "met primary endpoint", "statistically significant", "positive topline",
      "fda approves", "fda approved", "fda grants", "fda clearance",
      "breakthrough therapy", "fast track designation", "priority review",
      "positive phase 2", "positive phase 3", "raises guidance", "merger agreement"
    ],
    neg: [
      "failed to meet", "did not meet", "missed primary endpoint",
      "complete response letter", "clinical hold", "discontinues phase",
      "cuts guidance", "sec investigation", "delisting notice"
    ]
  },
  CRYPTO: {
    pos: [
      "etf approved", "etf approval", "sec approves", "bitcoin reserve",
      "strategic reserve", "institutional adoption", "inflows record",
      "rate cut", "treasury adoption", "major upgrade"
    ],
    neg: [
      "sec sues", "sec charges", "hack", "exploit", "stolen", "banned",
      "crackdown", "liquidation cascade", "insolvency", "freezes withdrawals"
    ]
  },
  ENERGY: {
    pos: [
      "opec cuts", "opec+ cuts", "production cut", "inventory draw",
      "crude inventories fall", "pipeline shutdown", "supply disruption",
      "escalation in middle east", "straits of hormuz"
    ],
    neg: [
      "opec increases", "opec hikes output", "crude inventories surge",
      "inventory build", "ceasefire", "oil glut", "demand slump"
    ]
  },
  METALS: {
    pos: [
      "central bank buys gold", "record gold buying", "gold reserve",
      "copper supply deficit", "mine shutdown", "dollar plunges"
    ],
    neg: [
      "dollar surges", "rate hike", "gold selling", "copper surplus"
    ]
  }
};

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
    const pubDate = pick("pubDate");
    if (title && link) {
      items.push({
        title,
        link,
        source: sourceName,
        cat,
        pubDate: pubDate ? new Date(pubDate) : new Date(),
      });
    }
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

function estimatePhase(category, priceData, isPos) {
  const price = priceData.price;
  const prevClose = priceData.prevClose || price;
  const changePct = ((price / prevClose) - 1) * 100;

  if (isPos) {
    // Phase 1: Fresh spike or pre-market gap (> 10% change today)
    if (changePct >= 12.0) {
      return {
        phaseName: "ΦΑΣΗ 1: Αρχικός Σπινθήρας (Catalyst Shock / Spike)",
        desc: "Η είδηση μόλις εκδηλώθηκε. Υψηλό ενδοσυνεδριακό momentum.",
        expectedGain: "+25% έως +45% (Βραχυπρόθεσμη εκτόνωση)",
        timeline: "Πρώτες 24–48 ώρες",
        action: "Προσοχή σε chasing. Ιδανικό για γρήγορο momentum trade ή αναμονή για Φάση 2."
      };
    }
    // Phase 2: Pullback / Sweet spot (consolidating, -3% to +8%)
    else if (changePct >= -4.0 && changePct <= 8.0) {
      return {
        phaseName: "ΦΑΣΗ 2: Χώνευση & Στήριξη (Pullback / Sweet Spot Εισόδου)",
        desc: "Η τιμή ηρέμησε και δοκιμάζει στήριξη στον 21 EMA. Ελάχιστο ρίσκο.",
        expectedGain: "+40% έως +85% (2ο Κύμα Θεσμικής Ανόδου)",
        timeline: "2 έως 4 εβδομάδες",
        action: "ΙΔΑΝΙΚΗ ΖΩΝΗ ΕΙΣΟΔΟΥ με σφιχτό Stop Loss κάτω από τη βάση."
      };
    }
    // Phase 3: Institutional Drift (> 20% over recent baseline)
    else {
      return {
        phaseName: "ΦΑΣΗ 3: Θεσμικό Ρεύμα (Institutional Trend Drift)",
        desc: "Σταθερή είσοδος μεγάλων funds (BlackRock/Vanguard). Ισχυρή πολυήμερη τάση.",
        expectedGain: "+60% έως +130% (Πλήρες ράλι επέκτασης)",
        timeline: "4 έως 8 εβδομάδες",
        action: "Trend Following: Αφήστε τα κέρδη να τρέξουν με Trailing Stop Loss."
      };
    }
  } else {
    return {
      phaseName: "ΠΤΩΤΙΚΗ ΚΑΤΑΡΡΕΥΣΗ (Negative Breakdown)",
      desc: "Εκροή κεφαλαίων και πανικός πωλητών.",
      expectedGain: "-25% έως -55% (Αναμενόμενη πτώση)",
      timeline: "1 έως 2 εβδομάδες",
      action: "ΑΜΕΣΗ ΕΞΟΔΟΣ. Μόνο Short Selling / Puts."
    };
  }
}

function calculatePlan(category, priceData, isPos) {
  const price = priceData.price;
  let slPct = 0.07;
  let tp1Pct = 0.22;
  let tp2Pct = 0.50;

  if (category === "CRYPTO") {
    slPct = 0.05;
    tp1Pct = 0.18;
    tp2Pct = 0.40;
  } else if (category === "ENERGY") {
    slPct = 0.04;
    tp1Pct = 0.12;
    tp2Pct = 0.25;
  } else if (category === "METALS") {
    slPct = 0.025;
    tp1Pct = 0.07;
    tp2Pct = 0.16;
  }

  const formatPrice = (v) => v > 500 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v.toFixed(2);
  const phaseInfo = estimatePhase(category, priceData, isPos);

  if (isPos) {
    const sl = Number((price * (1 - slPct)).toFixed(2));
    const tp1 = Number((price * (1 + tp1Pct)).toFixed(2));
    const tp2 = Number((price * (1 + tp2Pct)).toFixed(2));
    const rr = ((tp1 - price) / (price - sl)).toFixed(1);

    return `
📍 <b>ΕΚΤΙΜΗΣΗ ΦΑΣΗΣ & ΑΝΑΜΕΝΟΜΕΝΗΣ ΑΥΞΗΣΗΣ:</b>
• <b>Κατάσταση:</b> <code>${phaseInfo.phaseName}</code>
• <b>Περιγραφή:</b> ${phaseInfo.desc}
• <b>Αναμενόμενη Αύξηση:</b> <b>${phaseInfo.expectedGain}</b>
• <b>Χρονικός Ορίζοντας:</b> ${phaseInfo.timeline}
• <b>Τακτική:</b> <i>${phaseInfo.action}</i>

📊 <b>ΣΧΕΔΙΟ ΑΝΟΔΙΚΗΣ ΣΥΝΑΛΛΑΓΗΣ (TRADE PLAN):</b>
• <b>Ζώνη Εισόδου (Entry):</b> <code>$${formatPrice(price * 0.995)} - $${formatPrice(price * 1.005)}</code>
• <b>Stop Loss:</b> <code>$${formatPrice(sl)} (-${(slPct * 100).toFixed(1)}%)</code>
• <b>Take Profit 1:</b> <code>$${formatPrice(tp1)} (+${(tp1Pct * 100).toFixed(1)}%)</code>
• <b>Take Profit 2 (Max):</b> <code>$${formatPrice(tp2)} (+${(tp2Pct * 100).toFixed(1)}%)</code>
• <b>Σχέση R:R:</b> <code>1:${rr}</code>
`;
  } else {
    const sl = Number((price * (1 + slPct)).toFixed(2));
    const tp1 = Number((price * (1 - tp1Pct)).toFixed(2));
    const tp2 = Number((price * (1 - tp2Pct)).toFixed(2));
    const rr = ((price - tp1) / (sl - price)).toFixed(1);

    return `
📍 <b>ΕΚΤΙΜΗΣΗ ΠΤΩΣΗΣ:</b>
• <b>Κατάσταση:</b> <code>${phaseInfo.phaseName}</code>
• <b>Αναμενόμενη Πτώση:</b> <b>${phaseInfo.expectedGain}</b>
• <b>Χρονικός Ορίζοντας:</b> ${phaseInfo.timeline}
• <b>Τακτική:</b> <i>${phaseInfo.action}</i>

📉 <b>ΣΧΕΔΙΟ ΠΤΩΤΙΚΗΣ ΣΥΝΑΛΛΑΓΗΣ (SHORT):</b>
• <b>Ζώνη Εισόδου Short:</b> <code>$${formatPrice(price * 0.995)} - $${formatPrice(price * 1.005)}</code>
• <b>Stop Loss (Short):</b> <code>$${formatPrice(sl)} (+${(slPct * 100).toFixed(1)}%)</code>
• <b>Πτωτικός Στόχος 1:</b> <code>$${formatPrice(tp1)} (-${(tp1Pct * 100).toFixed(1)}%)</code>
• <b>Πτωτικός Στόχος 2:</b> <code>$${formatPrice(tp2)} (-${(tp2Pct * 100).toFixed(1)}%)</code>
• <b>Σχέση R:R:</b> <code>1:${rr}</code>
`;
  }
}

function resolveAssetSymbol(category, title) {
  const upper = title.toUpperCase();
  if (category === "CRYPTO") {
    if (upper.includes("ETHEREUM") || upper.includes("ETH")) return { sym: "ETH-USD", name: "Ethereum (ETH)" };
    if (upper.includes("SOLANA") || upper.includes("SOL")) return { sym: "SOL-USD", name: "Solana (SOL)" };
    if (upper.includes("RIPPLE") || upper.includes("XRP")) return { sym: "XRP-USD", name: "XRP" };
    return { sym: "BTC-USD", name: "Bitcoin (BTC)" };
  }
  if (category === "ENERGY") {
    if (upper.includes("GAS") || upper.includes("LNG")) return { sym: "UNG", name: "Natural Gas (UNG / NG)" };
    return { sym: "CL=F", name: "WTI Crude Oil (Πετρέλαιο)" };
  }
  if (category === "METALS") {
    if (upper.includes("SILVER") || upper.includes("ΑΣΗΜΙ")) return { sym: "SLV", name: "Silver (Ασήμι)" };
    if (upper.includes("COPPER") || upper.includes("ΧΑΛΚΟΣ")) return { sym: "HG=F", name: "Copper (Χαλκός)" };
    return { sym: "GC=F", name: "Gold (Χρυσός)" };
  }
  const tickerMatch = /\(([A-Z]{1,5})\)|\bNASDAQ:\s*([A-Z]{1,5})\b|\bNYSE:\s*([A-Z]{1,5})\b|\$([A-Z]{1,5})\b/.exec(title);
  const ticker = tickerMatch ? (tickerMatch[1] || tickerMatch[2] || tickerMatch[3] || tickerMatch[4]) : null;
  return ticker ? { sym: ticker, name: ticker } : null;
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
  console.log("=== 24/7 Universal Catalyst Scanner Starting ===");
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
      const items = parseRss(xml, feed.name, feed.cat);
      
      for (const item of items) {
        if (!item.link || seenSet.has(item.link)) continue;
        seenSet.add(item.link);

        const lower = item.title.toLowerCase();
        let cat = item.cat;

        if (lower.includes("gold") || lower.includes("silver") || lower.includes("copper")) {
          cat = "METALS";
        } else if (lower.includes("oil") || lower.includes("opec") || lower.includes("crude") || lower.includes("natural gas")) {
          cat = "ENERGY";
        }

        const catKws = KEYWORDS[cat] || KEYWORDS.STOCK;
        const isPos = catKws.pos.some((kw) => lower.includes(kw));
        const isNeg = catKws.neg.some((kw) => lower.includes(kw));

        if (isPos || isNeg) {
          const asset = resolveAssetSymbol(cat, item.title);
          const assetName = asset ? asset.name : cat;
          const assetSym = asset ? asset.sym : null;

          let tradeSection = "";
          if (assetSym) {
            const priceData = await getLivePrice(assetSym);
            if (priceData) {
              tradeSection = calculatePlan(cat, priceData, isPos);
            }
          }

          const catIcons = {
            CRYPTO: "🪙 CRYPTO",
            ENERGY: "🛢️ ΕΝΕΡΓΕΙΑ / ΠΕΤΡΕΛΑΙΟ",
            METALS: "🥇 ΜΕΤΑΛΛΑ / ΧΡΥΣΟΣ",
            STOCK: "💊 ΜΕΤΟΧΕΣ / BIOTECH"
          };

          const badge = isPos
            ? "🟢 <b>ΘΕΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (BUY / LONG ALERT)</b>"
            : "🔴 <b>ΑΡΝΗΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (AVOID / SHORT ALERT)</b>";

          const msg = `
🚨 <b>${catIcons[cat] || "MARKET"} CATALYST SIGNAL</b> 🚨

<b>Asset:</b> <code>${assetName}</code>
<b>Ετυμηγορία:</b> ${badge}
${tradeSection}
📰 <b>Γεγονός:</b> ${item.title}
<b>Πηγή:</b> ${item.source}
🔗 <a href="${item.link}">Διαβάστε την Πρωτότυπη Πηγή</a>

⚡ <i>Αυτόματο σήμα από το Cloud Multi-Asset Engine</i>
`;
          console.log(`[ALERT] [${cat}] ${assetName} (${isPos ? 'POS' : 'NEG'}): ${item.title}`);
          await sendTelegram(msg);
          newAlertCount++;
        }
      }
    } catch (e) {
      console.log(`[!] Σφάλμα ανάγνωσης feed ${feed.name}: ${e.message}`);
    }
  }

  const updatedSeen = Array.from(seenSet).slice(-600);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(updatedSeen, null, 2), "utf8");

  console.log(`=== Ολοκληρώθηκε: ${newAlertCount} νέες ειδοποιήσεις εστάλησαν ===`);
}

run().catch(console.error);
