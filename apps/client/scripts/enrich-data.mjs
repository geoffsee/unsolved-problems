#!/usr/bin/env node
/**
 * Enriches problem data with AI-generated summaries using the Anthropic SDK.
 *
 * Reads public/data/problems.json, sends batches to Claude Sonnet,
 * and writes public/data/enrichments.json. Supports incremental updates —
 * only processes problems not already in the enrichments cache.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import Anthropic from "@anthropic-ai/sdk";

const PROBLEMS_PATH = resolve("public/data/problems.json");
const ENRICHMENTS_PATH = resolve("public/data/enrichments.json");

const MODEL = "claude-sonnet-4-20250514";
const BATCH_SIZE = 20;
const MAX_NEW_PROBLEMS = 100;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

function makeKey(text) {
  return text.slice(0, 120);
}

function loadProblems() {
  const raw = JSON.parse(readFileSync(PROBLEMS_PATH, "utf-8"));
  const items = [];
  for (const [category, sections] of Object.entries(raw.categories)) {
    for (const sec of sections) {
      for (const text of sec.problems) {
        items.push({ category, heading: sec.heading, text });
      }
    }
  }
  return items;
}

function loadExistingEnrichments() {
  if (!existsSync(ENRICHMENTS_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(ENRICHMENTS_PATH, "utf-8"));
    return raw.problems || {};
  } catch {
    return {};
  }
}

function buildSystemPrompt() {
  return `You generate structured metadata about unsolved scientific problems.
For each problem, return a JSON object with exactly these fields:
- "summary": 1-2 sentence plain-language explanation accessible to a non-specialist
- "significance": 1 sentence on why solving this matters
- "field": specific sub-field (e.g. "algebraic geometry", "quantum gravity")
- "yearProposed": approximate year first stated as a number, or null if unknown

Return a JSON array with one object per problem, in the same order as the input.
Output ONLY valid JSON — no markdown fences, no commentary.`;
}

function buildUserPrompt(batch) {
  const lines = batch.map(
    (p, i) => `${i + 1}. [${p.category} / ${p.heading}] "${p.text}"`
  );
  return `Generate metadata for these ${batch.length} unsolved problems:\n\n${lines.join("\n")}`;
}

async function callWithRetry(client, messages, systemPrompt) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });
      const text = response.content[0].text;
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`  Retrying in ${delay}ms (${err.status})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function saveEnrichments(existing) {
  const output = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    problems: existing,
  };
  writeFileSync(ENRICHMENTS_PATH, JSON.stringify(output, null, 2));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY not set — skipping enrichment.");
    return;
  }

  if (!existsSync(PROBLEMS_PATH)) {
    console.warn("No problems.json found — run fetch-data first.");
    return;
  }

  console.log("Enriching problem data with AI...\n");

  const client = new Anthropic();
  const allProblems = loadProblems();
  const existing = loadExistingEnrichments();

  // Find problems that haven't been enriched yet
  const needed = allProblems.filter((p) => !existing[makeKey(p.text)]);

  if (needed.length === 0) {
    console.log("All problems already enriched. Nothing to do.");
    return;
  }

  const toProcess = needed.slice(0, MAX_NEW_PROBLEMS);
  console.log(
    `  ${allProblems.length} total problems, ${needed.length} need enrichment`
  );
  console.log(`  Processing ${toProcess.length} this run (cap: ${MAX_NEW_PROBLEMS})\n`);

  const systemPrompt = buildSystemPrompt();
  let enrichedCount = 0;

  // Process in batches
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);

    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} problems)...`);

    try {
      const results = await callWithRetry(
        client,
        [{ role: "user", content: buildUserPrompt(batch) }],
        systemPrompt
      );

      if (!Array.isArray(results) || results.length !== batch.length) {
        console.warn(`  Unexpected response length — skipping batch`);
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const key = makeKey(batch[j].text);
        existing[key] = results[j];
        enrichedCount++;
      }

      // Save after each batch so partial results persist
      saveEnrichments(existing);
    } catch (err) {
      console.error(`  Batch ${batchNum} failed: ${err.message} — skipping`);
    }

    // Brief pause between batches to respect rate limits
    if (i + BATCH_SIZE < toProcess.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone. Enriched ${enrichedCount} problems.`);
  console.log(`Total enrichments: ${Object.keys(existing).length}`);
}

main().catch((err) => {
  console.error("Enrichment failed:", err.message);
  // Never exit(1) — partial results are already saved
});
