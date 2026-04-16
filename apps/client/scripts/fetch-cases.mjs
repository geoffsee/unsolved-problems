#!/usr/bin/env node
/**
 * Pre-fetches official FBI ViCAP case listings with a real browser session.
 * Outputs:
 * - public/data/cases.json
 * - public/data/case-history/YYYY-MM-DD.json
 * - public/data/case-history/index.json
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { chromium } from "playwright";

const OUTPUT_PATH = "public/data/cases.json";
const HISTORY_DIR = "public/data/case-history";
const MAX_WAIT_MS = 120000;
const DETAIL_CONCURRENCY = Number(process.env.VICAP_DETAIL_CONCURRENCY || 4);
const SOURCE_NAME = "FBI ViCAP";
const DISCLAIMER =
  "Official public FBI ViCAP listings. Availability depends on what agencies publish publicly and is not a comprehensive national registry.";

const SOURCES = [
  {
    key: "missing persons",
    label: "Missing Persons",
    heading: "ViCAP Missing Persons",
    sourceSection: "ViCAP Missing Persons",
    url: "https://www.fbi.gov/wanted/vicap/missing-persons",
  },
  {
    key: "unsolved homicides",
    label: "Unsolved Homicides",
    heading: "ViCAP Homicides and Sexual Assaults",
    sourceSection: "ViCAP Homicides and Sexual Assaults",
    url: "https://www.fbi.gov/wanted/vicap/homicides-and-sexual-assaults",
  },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

function buildSnapshotDate(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function loadExistingCategories() {
  return loadJson(OUTPUT_PATH, { categories: {} }).categories || {};
}

function loadArchiveIndex(path) {
  return loadJson(path, { snapshots: [] });
}

function saveArchive(output) {
  const snapshotDate = buildSnapshotDate(output.fetchedAt);
  const snapshotPath = `${HISTORY_DIR}/${snapshotDate}.json`;
  const indexPath = `${HISTORY_DIR}/index.json`;

  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(output, null, 2));

  const existing = loadArchiveIndex(indexPath);
  const snapshots = Array.isArray(existing.snapshots) ? existing.snapshots : [];
  const categoryCounts = Object.fromEntries(
    Object.entries(output.categories).map(([key, value]) => [key, value.items.length]),
  );
  const totalCases = Object.values(output.categories).reduce((sum, value) => sum + value.items.length, 0);

  const nextEntry = {
    date: snapshotDate,
    fetchedAt: output.fetchedAt,
    totalCases,
    categories: categoryCounts,
    path: `case-history/${snapshotDate}.json`,
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

  return { snapshotDate, snapshotPath, snapshotCount: filtered.length, totalCases };
}

function resolveExecutablePath() {
  const explicit = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function createLaunchOptions() {
  const executablePath = resolveExecutablePath();
  const options = {
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  };

  if (executablePath) {
    options.executablePath = executablePath;
  }

  return options;
}

function normalizeLine(raw) {
  return raw.replace(/\u00a0/g, " ").replace(/[ ]+/g, " ").trim();
}

function toLines(text) {
  return text.split("\n").map(normalizeLine).filter(Boolean);
}

function looksLikeDate(line) {
  return /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(line);
}

function extractSection(lines, startLabel, endLabels) {
  const start = lines.findIndex((line) => line === startLabel);
  if (start === -1) return null;

  let end = lines.length;
  for (const label of endLabels) {
    const index = lines.findIndex((line, i) => i > start && line === label);
    if (index !== -1 && index < end) end = index;
  }

  const body = lines
    .slice(start + 1, end)
    .filter((line) => !["View Poster", "Download Poster", "English"].includes(line));

  return body.length ? body.join(" ") : null;
}

function parseFacts(lines) {
  const start = lines.findIndex((line) => line === "English");
  if (start === -1) return {};

  const stopLabels = new Set(["Remarks:", "Details:", "Submit a Tip:", "Reward:", "Caution:"]);
  const facts = {};

  for (const line of lines.slice(start + 1)) {
    if (stopLabels.has(line)) break;
    const parts = line.split("\t").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      facts[parts[0]] = parts.slice(1).join(" ");
    }
  }

  return facts;
}

function parseDetailPayload(item, payload) {
  const title = payload.title || item.title;
  const lines = toLines(payload.bodyText || "");
  const titleIndex = lines.findIndex((line) => line === title);
  const afterTitle = titleIndex === -1 ? lines : lines.slice(titleIndex + 1);
  const shareIndex = afterTitle.findIndex((line) => /^Share on /i.test(line));
  const headerLines = (shareIndex === -1 ? afterTitle.slice(0, 6) : afterTitle.slice(0, shareIndex)).filter(
    (line) => !["View Poster", "Download Poster", "English"].includes(line),
  );

  let reportedDate = null;
  let location = null;
  for (const line of headerLines) {
    if (!reportedDate && looksLikeDate(line)) {
      reportedDate = line;
      continue;
    }
    if (!location && !/^Share on /i.test(line)) {
      location = line;
    }
  }

  return {
    ...item,
    title,
    reportedDate,
    location,
    facts: parseFacts(lines),
    remarks: extractSection(lines, "Remarks:", ["Details:", "Submit a Tip:"]),
    details: extractSection(lines, "Details:", ["Submit a Tip:"]),
  };
}

function buildFallbackCategory(source, existing, fetchedAt, error) {
  if (existing) {
    return {
      ...existing,
      label: source.label,
      sourceName: SOURCE_NAME,
      sourceSection: source.sourceSection,
      sourceUrl: source.url,
      disclaimer: DISCLAIMER,
      fresh: false,
      attemptedAt: fetchedAt,
      lastSuccessfulFetchAt: existing.lastSuccessfulFetchAt || existing.attemptedAt || null,
      lastError: error.message,
    };
  }

  return {
    label: source.label,
    sourceName: SOURCE_NAME,
    sourceSection: source.sourceSection,
    sourceUrl: source.url,
    disclaimer: DISCLAIMER,
    total: 0,
    fresh: false,
    attemptedAt: fetchedAt,
    lastSuccessfulFetchAt: null,
    lastError: error.message,
    items: [],
  };
}

async function waitForListings(page, source) {
  await page.waitForFunction(
    (heading) => {
      const title = document.title || "";
      const body = document.body?.innerText || "";
      if (/Just a moment|Checking your browser|Performing security verification/i.test(`${title}\n${body}`)) {
        return false;
      }

      const pageHeading = document.querySelector("h1")?.textContent?.trim() || "";
      return pageHeading.includes(heading) && document.querySelectorAll("li.portal-type-person").length > 0;
    },
    source.heading,
    { timeout: MAX_WAIT_MS },
  );
}

async function expandListings(page, source) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const button = page.locator("button.load-more").first();
    const exists = (await button.count()) > 0;
    if (!exists) return;

    const visible = await button.isVisible().catch(() => false);
    if (!visible) return;

    const before = await page.locator("li.portal-type-person").count();
    console.log(`  [${source.key}] loading more results (${before} so far)...`);
    await button.click();
    await page.waitForFunction(
      (count) => document.querySelectorAll("li.portal-type-person").length > count,
      before,
      { timeout: MAX_WAIT_MS },
    );
    await page.waitForTimeout(250);
  }

  throw new Error(`Exceeded pagination safety limit for ${source.key}`);
}

async function scrapeListing(context, source) {
  const page = await context.newPage();
  try {
    console.log(`  [${source.key}] opening ${source.url}`);
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: MAX_WAIT_MS });
    await waitForListings(page, source);
    await expandListings(page, source);

    const listing = await page.evaluate((section) => {
      const body = document.body?.innerText || "";
      const totalMatch = body.match(/Results:\s*([\d,]+)\s*Items/i);
      const items = [...document.querySelectorAll("li.portal-type-person")]
        .map((card) => {
          const nameLink = card.querySelector("p.name a");
          if (!nameLink) return null;

          const img = card.querySelector("img");
          return {
            id: new URL(nameLink.href).pathname.replace(/^\/+/, ""),
            title: nameLink.textContent?.trim() || "",
            url: nameLink.href,
            imageUrl: img?.src || null,
            sourceName: "FBI ViCAP",
            sourceSection: section,
            sourceUrl: location.href,
            reportedDate: null,
            location: null,
            facts: {},
            details: null,
            remarks: null,
          };
        })
        .filter(Boolean);

      return {
        total: totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : items.length,
        items,
      };
    }, source.sourceSection);

    const dedupedItems = [];
    const seen = new Set();
    for (const item of listing.items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      dedupedItems.push(item);
    }

    return {
      total: listing.total,
      items: dedupedItems,
    };
  } finally {
    await page.close();
  }
}

function splitExistingDetails(items, existingItems) {
  const existingByUrl = new Map((existingItems || []).map((item) => [item.url, item]));
  const hydrated = [];
  const pending = [];

  for (const item of items) {
    const existing = existingByUrl.get(item.url);
    const canReuse =
      existing &&
      existing.title === item.title &&
      existing.imageUrl === item.imageUrl &&
      (existing.details ||
        existing.remarks ||
        existing.reportedDate ||
        existing.location ||
        Object.keys(existing.facts || {}).length);

    if (canReuse) {
      hydrated.push({
        ...item,
        reportedDate: existing.reportedDate || null,
        location: existing.location || null,
        facts: existing.facts || {},
        details: existing.details || null,
        remarks: existing.remarks || null,
      });
    } else {
      pending.push(item);
    }
  }

  return { hydrated, pending };
}

async function scrapeDetail(context, item) {
  const page = await context.newPage();
  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: MAX_WAIT_MS });
    await page.waitForFunction(
      () => {
        const title = document.title || "";
        const body = document.body?.innerText || "";
        return !/Just a moment|Checking your browser|Performing security verification/i.test(`${title}\n${body}`) && !!document.querySelector("h1");
      },
      { timeout: MAX_WAIT_MS },
    );
    await page.waitForTimeout(500);

    const payload = await page.evaluate(() => ({
      title: document.querySelector("h1")?.textContent?.trim() || null,
      bodyText: document.body?.innerText || "",
    }));

    return parseDetailPayload(item, payload);
  } finally {
    await page.close();
  }
}

async function enrichPendingDetails(context, items) {
  if (items.length === 0) return [];

  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;

      const item = items[current];
      try {
        results[current] = await scrapeDetail(context, item);
        console.log(`    [detail] ${current + 1}/${items.length} ${item.title}`);
      } catch (error) {
        console.warn(`    [detail] failed for ${item.title}: ${error.message}`);
        results[current] = item;
      }
    }
  }

  const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function scrapeSource(context, source, existingCategory, fetchedAt) {
  const listing = await scrapeListing(context, source);
  const { hydrated, pending } = splitExistingDetails(listing.items, existingCategory?.items);
  const pendingDetails = await enrichPendingDetails(context, pending);
  const pendingByUrl = new Map(pendingDetails.map((item) => [item.url, item]));
  const hydratedByUrl = new Map(hydrated.map((item) => [item.url, item]));
  const items = listing.items.map((item) => pendingByUrl.get(item.url) || hydratedByUrl.get(item.url) || item);

  return {
    label: source.label,
    sourceName: SOURCE_NAME,
    sourceSection: source.sourceSection,
    sourceUrl: source.url,
    disclaimer: DISCLAIMER,
    total: listing.total,
    fresh: true,
    attemptedAt: fetchedAt,
    lastSuccessfulFetchAt: fetchedAt,
    lastError: null,
    items,
  };
}

async function main() {
  console.log("Fetching FBI ViCAP case listings with Playwright...\n");

  const fetchedAt = new Date().toISOString();
  const existingCategories = loadExistingCategories();
  const browser = await chromium.launch(createLaunchOptions());
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 1024 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const categories = {};

  try {
    for (const source of SOURCES) {
      try {
        categories[source.key] = await scrapeSource(context, source, existingCategories[source.key], fetchedAt);
      } catch (error) {
        console.warn(`  [${source.key}] fetch failed: ${error.message}`);
        categories[source.key] = buildFallbackCategory(source, existingCategories[source.key], fetchedAt, error);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const output = {
    fetchedAt,
    sourceName: SOURCE_NAME,
    categories,
  };

  mkdirSync("public/data", { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  const archive = saveArchive(output);

  console.log(
    `\nDone. ${archive.totalCases} case listings written to ${OUTPUT_PATH} and archived at ${archive.snapshotPath} (${archive.snapshotCount} total snapshots)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
