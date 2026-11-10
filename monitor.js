#!/usr/bin/env node
// 24/7 Cloud Catalyst & SEC Monitor for GitHub Actions
// Pure Node.js - Zero dependencies

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
          "User-Agent": "AmberCloudCatalyst/1.0 (+https://github.com)",
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

function sendTelegram(html) {
  return new Promise((resolve, reject) => {
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
    req.on("error", reject);
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
        if (seenSet.has(item.link)) continue;
        seenSet.add(item.link);

        const lower = item.title.toLowerCase();
        const isPos = POSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
        const isNeg = NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw));

        if (isPos || isNeg) {
          const tickerMatch = /\(([A-Z]{1,5})\)|\bNASDAQ:\s*([A-Z]{1,5})\b|\$([A-Z]{1,5})\b/.exec(item.title);
          const ticker = tickerMatch ? (tickerMatch[1] || tickerMatch[2] || tickerMatch[3]) : "NEWS";

          const badge = isPos ? "🟢 <b>ΘΕΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (BUY ALERT)</b>" : "🔴 <b>ΑΡΝΗΤΙΚΟΣ ΚΑΤΑΛΥΤΗΣ (AVOID)</b>";

          const msg = `
🚨 <b>CLOUD CATALYST ALERT</b> 🚨

<b>Ticker:</b> <code>${ticker}</code>
<b>Τύπος:</b> ${badge}
<b>Τίτλος:</b> ${item.title}
<b>Πηγή:</b> ${item.source}
🔗 <a href="${item.link}">Διαβάστε το Δελτίο Τύπου</a>

⚡ <i>Αυτόματη ειδοποίηση από το GitHub Cloud 24/7 Bot</i>
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

  // Keep seen array bounded to last 500 links
  const updatedSeen = Array.from(seenSet).slice(-500);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(updatedSeen, null, 2), "utf8");

  console.log(`=== Ολοκληρώθηκε: ${newAlertCount} νέες ειδοποιήσεις εστάλησαν ===`);
}

run().catch(console.error);
