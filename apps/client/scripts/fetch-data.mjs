#!/usr/bin/env node
/**
 * Pre-fetches all unsolved-problem data from Wikipedia at build time.
 * Output: public/data/problems.json
 *
 * The app loads this file first so users see content instantly
 * without waiting for runtime API calls.
 */

import { writeFileSync, mkdirSync } from "fs";
import { parseHTML } from "linkedom";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

const CATEGORIES = {
  mathematics: "List_of_unsolved_problems_in_mathematics",
  physics: "List_of_unsolved_problems_in_physics",
  "computer science": "List_of_unsolved_problems_in_computer_science",
  biology: "List_of_unsolved_problems_in_biology",
  chemistry: "List_of_unsolved_problems_in_chemistry",
  neuroscience: "List_of_unsolved_problems_in_neuroscience",
  philosophy: "List_of_philosophical_problems",
  astronomy: "List_of_unsolved_problems_in_astronomy",
  economics: "List_of_unsolved_problems_in_economics",
};

const SKIP_HEADINGS = new Set([
  "see also", "references", "external links", "notes",
  "further reading", "footnotes", "citations", "bibliography",
]);

async function wikiRequest(params, retries = 3) {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "UnsolvedProblemsFetcher/1.0 (Build; Node)" },
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const wait = (attempt + 1) * 5000;
      console.log(`    Rate limited, waiting ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Wikipedia API ${res.status}`);
  }
}

function cleanText(text) {
  text = text.replace(/\{\\displaystyle\s*([^}]*)\}/g, "$1");
  text = text.replace(/\\displaystyle\s*/g, "");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function removeCitations(el) {
  for (const node of el.querySelectorAll("sup, .reference, .mw-cite-backlink")) {
    node.remove();
  }
}

function htmlToListItems(html) {
  const { document: doc } = parseHTML(html);
  const items = [];
  const seen = new Set();

  // Try <li> items first
  for (const li of doc.querySelectorAll("li")) {
    if (li.closest(".reflist, .references, .mw-references-wrap")) continue;
    removeCitations(li);
    let text = cleanText(li.textContent);
    if (/^\^/.test(text)) continue;
    if (text.length < 15) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }

  // Fallback: extract <p> content if no list items found (e.g. philosophy)
  if (items.length === 0) {
    for (const p of doc.querySelectorAll("p")) {
      removeCitations(p);
      let text = cleanText(p.textContent);
      if (text.length < 30) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      items.push(text);
    }
  }

  return items;
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, "").trim();
}

async function fetchCategory(key) {
  const page = CATEGORIES[key];
  console.log(`  [${key}] fetching sections...`);

  const sectionsData = await wikiRequest({ action: "parse", page, prop: "sections", redirects: true });
  const sections = sectionsData.parse?.sections || [];
  const result = [];

  for (const sec of sections) {
    const heading = stripHtml(sec.line || "");
    const headingLower = heading.toLowerCase();
    if (SKIP_HEADINGS.has(headingLower)) continue;
    if (headingLower.includes("solved")) continue;
    if (parseInt(sec.toclevel) > 2) continue;

    await new Promise((r) => setTimeout(r, 200));
    const htmlData = await wikiRequest({
      action: "parse", page, prop: "text", section: sec.index,
    });
    const html = htmlData.parse?.text?.["*"] || "";
    const problems = htmlToListItems(html);

    if (problems.length > 0) {
      result.push({ heading, problems });
    }
  }

  console.log(`  [${key}] ${result.reduce((n, s) => n + s.problems.length, 0)} problems in ${result.length} sections`);
  return result;
}

async function main() {
  console.log("Fetching unsolved problems from Wikipedia...\n");
  const data = {};

  const keys = Object.keys(CATEGORIES);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      data[key] = await fetchCategory(key);
    } catch (err) {
      console.error(`  [${key}] FAILED: ${err.message}`);
      data[key] = [];
    }
    // Small delay between categories to avoid Wikipedia rate limiting
    if (i < keys.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    categories: data,
  };

  mkdirSync("public/data", { recursive: true });
  writeFileSync("public/data/problems.json", JSON.stringify(output, null, 2));

  const totalProblems = Object.values(data)
    .flat()
    .reduce((n, s) => n + s.problems.length, 0);

  console.log(`\nDone. ${totalProblems} problems written to public/data/problems.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
