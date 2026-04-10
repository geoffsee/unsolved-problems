#!/usr/bin/env node
/**
 * Pre-fetches frontier research news from Perigon at build time.
 * Output: public/data/news.json
 */

import { writeFileSync, readFileSync, mkdirSync } from "fs";

function loadApiKey() {
  try {
    const text = readFileSync(".env.secrets", "utf-8");
    for (const line of text.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (key.trim() === "PERIGON_API_KEY") return rest.join("=").trim();
    }
  } catch {}
  return process.env.PERIGON_API_KEY || "";
}

function normalize(t) {
  return t.toLowerCase().replace(/['']/g, "'").replace(/[^\w\s]/g, "").trim();
}

function groupArticles(articles) {
  const groups = [];
  for (const article of articles) {
    const key = normalize(article.title);
    const existing = groups.find((g) => normalize(g.title) === key);
    if (existing) {
      if (!existing.sources.some((s) => s.domain === article.domain)) {
        existing.sources.push({ domain: article.domain, url: article.url });
      }
    } else {
      groups.push({
        title: article.title,
        seendate: article.seendate,
        sources: [{ domain: article.domain, url: article.url }],
      });
    }
  }
  return groups;
}

async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error("No PERIGON_API_KEY found in .env.secrets or environment");
    process.exit(1);
  }

  console.log("Fetching frontier research news from Perigon...\n");

  const params = new URLSearchParams({
    q: "frontier research OR scientific breakthrough OR scientific discovery",
    category: "Science",
    sourceGroup: "top100",
    size: "50",
    sortBy: "date",
  });

  const res = await fetch(`https://api.goperigon.com/v1/all?${params}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`Perigon API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const articles = (data.articles || []).map((a) => ({
    title: a.title,
    url: a.url,
    domain: a.source?.domain || "unknown",
    seendate: a.pubDate,
  }));

  const grouped = groupArticles(articles);

  const output = {
    fetchedAt: new Date().toISOString(),
    articles: grouped,
  };

  mkdirSync("public/data", { recursive: true });
  writeFileSync("public/data/news.json", JSON.stringify(output, null, 2));

  console.log(`Done. ${grouped.length} stories (${articles.length} articles) written to public/data/news.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
