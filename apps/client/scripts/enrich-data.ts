#!/usr/bin/env bun
/**
 * Enriches problem data with AI-generated summaries using the Anthropic SDK.
 *
 * Reads public/data/problems.json, sends batches to Claude Sonnet,
 * and writes public/data/enrichments.json. Supports incremental updates —
 * only processes problems not already in the enrichments cache.
 */

import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { EnrichmentProblem, Section } from "../lib/wiki";

const PROBLEMS_PATH = resolve("public/data/problems.json");
const ENRICHMENTS_PATH = resolve("public/data/enrichments.json");

const MODEL = "claude-opus-4-8";
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

interface ProblemItem {
	category: string;
	heading: string;
	text: string;
}

interface ProblemsFile {
	categories: Record<string, Section[]>;
}

interface EnrichmentsFile {
	problems?: Record<string, EnrichmentProblem>;
}

function makeKey(text: string): string {
	return text.slice(0, 120);
}

async function loadProblems(): Promise<ProblemItem[]> {
	const raw = (await Bun.file(PROBLEMS_PATH).json()) as ProblemsFile;
	const items: ProblemItem[] = [];
	for (const [category, sections] of Object.entries(raw.categories)) {
		for (const sec of sections) {
			for (const text of sec.problems) {
				items.push({ category, heading: sec.heading, text });
			}
		}
	}
	return items;
}

async function loadExistingEnrichments(): Promise<
	Record<string, EnrichmentProblem>
> {
	const file = Bun.file(ENRICHMENTS_PATH);
	if (!(await file.exists())) return {};
	try {
		const raw = (await file.json()) as EnrichmentsFile;
		return raw.problems || {};
	} catch {
		return {};
	}
}

function buildSystemPrompt(): string {
	return `You generate structured metadata about unsolved scientific problems.
For each problem, return a JSON object with exactly these fields:
- "summary": 1-2 sentence plain-language explanation accessible to a non-specialist
- "significance": 1 sentence on why solving this matters
- "field": specific sub-field (e.g. "algebraic geometry", "quantum gravity")
- "yearProposed": approximate year first stated as a number, or null if unknown

Return a JSON array with one object per problem, in the same order as the input.
Output ONLY valid JSON — no markdown fences, no commentary.`;
}

function buildUserPrompt(batch: ProblemItem[]): string {
	const lines = batch.map(
		(p, i) => `${i + 1}. [${p.category} / ${p.heading}] "${p.text}"`,
	);
	return `Generate metadata for these ${batch.length} unsolved problems:\n\n${lines.join("\n")}`;
}

async function callWithRetry(
	client: Anthropic,
	messages: Anthropic.MessageParam[],
	systemPrompt: string,
): Promise<EnrichmentProblem[]> {
	let lastError: unknown;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const response = await client.messages.create({
				model: MODEL,
				max_tokens: 4096,
				system: systemPrompt,
				messages,
			});
			const block = response.content[0];
			if (block?.type !== "text") {
				throw new Error("Unexpected Anthropic response content");
			}
			return JSON.parse(block.text) as EnrichmentProblem[];
		} catch (err) {
			lastError = err;
			const status =
				err && typeof err === "object" && "status" in err
					? Number(err.status)
					: undefined;
			if (
				status === 429 ||
				(status !== undefined && status >= 500 && status < 600)
			) {
				const delay = INITIAL_BACKOFF_MS * 2 ** attempt;
				console.warn(`  Retrying in ${delay}ms (${status})...`);
				await Bun.sleep(delay);
				continue;
			}
			throw err;
		}
	}
	throw lastError;
}

async function saveEnrichments(
	existing: Record<string, EnrichmentProblem>,
): Promise<void> {
	const output = {
		generatedAt: new Date().toISOString(),
		model: MODEL,
		problems: existing,
	};
	await Bun.write(ENRICHMENTS_PATH, JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
	if (!Bun.env.ANTHROPIC_API_KEY) {
		console.warn("ANTHROPIC_API_KEY not set — skipping enrichment.");
		return;
	}

	if (!(await Bun.file(PROBLEMS_PATH).exists())) {
		console.warn("No problems.json found — run fetch-data first.");
		return;
	}

	console.log("Enriching problem data with AI...\n");

	const client = new Anthropic();
	const allProblems = await loadProblems();
	const existing = await loadExistingEnrichments();

	const needed = allProblems.filter((p) => !existing[makeKey(p.text)]);

	if (needed.length === 0) {
		console.log("All problems already enriched. Nothing to do.");
		return;
	}

	const toProcess = needed;
	console.log(
		`  ${allProblems.length} total problems, ${needed.length} need enrichment`,
	);
	console.log(`  Processing ${toProcess.length} this run\n`);

	const systemPrompt = buildSystemPrompt();
	let enrichedCount = 0;

	for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
		const batch = toProcess.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);

		console.log(
			`  Batch ${batchNum}/${totalBatches} (${batch.length} problems)...`,
		);

		try {
			const results = await callWithRetry(
				client,
				[{ role: "user", content: buildUserPrompt(batch) }],
				systemPrompt,
			);

			if (!Array.isArray(results) || results.length !== batch.length) {
				console.warn("  Unexpected response length — skipping batch");
				continue;
			}

			for (const [j, problem] of batch.entries()) {
				const result = results[j];
				if (!result) continue;
				existing[makeKey(problem.text)] = result;
				enrichedCount++;
			}

			await saveEnrichments(existing);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`  Batch ${batchNum} failed: ${message} — skipping`);
		}

		if (i + BATCH_SIZE < toProcess.length) {
			await Bun.sleep(1000);
		}
	}

	console.log(`\nDone. Enriched ${enrichedCount} problems.`);
	console.log(`Total enrichments: ${Object.keys(existing).length}`);
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error("Enrichment failed:", message);
	// Never exit(1) — partial results are already saved
});
