#!/usr/bin/env node
/**
 * Pre-fetches frontier research news from Perigon at build time.
 * Outputs:
 * - public/data/news.json
 * - public/data/news-history/YYYY-MM-DD.json
 * - public/data/news-history/index.json
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";

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

function buildSnapshotDate(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

function loadArchiveIndex(path) {
  if (!existsSync(path)) return { snapshots: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { snapshots: [] };
  }
}

function saveArchive(output) {
  const snapshotDate = buildSnapshotDate(output.fetchedAt);
  const historyDir = "public/data/news-history";
  const snapshotPath = `${historyDir}/${snapshotDate}.json`;
  const indexPath = `${historyDir}/index.json`;

  mkdirSync(historyDir, { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(output, null, 2));

  const existing = loadArchiveIndex(indexPath);
  const snapshots = Array.isArray(existing.snapshots) ? existing.snapshots : [];
  const nextEntry = {
    date: snapshotDate,
    fetchedAt: output.fetchedAt,
    storyCount: output.articles.length,
    articleCount: output.totalArticles,
    path: `news-history/${snapshotDate}.json`,
  };

  const filtered = snapshots.filter((entry) => entry.date !== snapshotDate);
  filtered.push(nextEntry);
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  writeFileSync(
    indexPath,
    JSON.stringify(
      {
        updatedAt: output.fetchedAt,
        snapshots: filtered,
      },
      null,
      2,
    ),
  );

  return { snapshotDate, snapshotPath, historyDir, snapshotCount: filtered.length };
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
  const fetchedAt = new Date().toISOString();

  const output = {
    fetchedAt,
    totalArticles: articles.length,
    articles: grouped,
  };

  mkdirSync("public/data", { recursive: true });
  writeFileSync("public/data/news.json", JSON.stringify(output, null, 2));
  const archive = saveArchive(output);

  console.log(`Done. ${grouped.length} stories (${articles.length} articles) written to public/data/news.json`);
  console.log(
    `Archived snapshot for ${archive.snapshotDate} at ${archive.snapshotPath} (${archive.snapshotCount} total snapshots)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
