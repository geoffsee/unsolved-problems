#!/usr/bin/env bun
/**
 * Pre-fetches all unsolved-problem data from Wikipedia at build time.
 * Output: public/data/problems.json
 *
 * The app loads this file first so users see content instantly
 * without waiting for runtime API calls.
 */

import { parseHTML } from "linkedom";
import {
	type CategoryManifest,
	type CategoryManifestEntry,
	categoryEntries,
	normalizedSourceType,
	parseManifestJson,
} from "../lib/manifest";
import { publish } from "./publish";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const OUTPUT_PATH = "public/data/problems.json";

const MANIFEST_PATH =
	Bun.env.PUBLISH_MANIFEST ||
	Bun.env.OPEN_QUESTIONS_MANIFEST ||
	Bun.env.CATALOG_MANIFEST ||
	"public/data/manifest.json";

const SKIP_HEADINGS = new Set([
	"see also",
	"references",
	"external links",
	"notes",
	"further reading",
	"footnotes",
	"citations",
	"bibliography",
]);

interface WikiSection {
	line?: string;
	toclevel: string;
	index: string;
}

interface WikiParseResponse {
	parse?: {
		sections?: WikiSection[];
		text?: { "*": string };
	};
}

interface ProblemSection {
	heading: string;
	problems: string[];
}

export async function loadManifest(
	path = MANIFEST_PATH,
): Promise<CategoryManifest> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`Manifest not found at ${path}.`);
	}
	return parseManifestJson(await file.text());
}

async function wikiRequest(
	params: Record<string, string | number | boolean>,
	retries = 3,
): Promise<WikiParseResponse> {
	const url = new URL(WIKI_API);
	url.searchParams.set("format", "json");
	url.searchParams.set("origin", "*");
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, String(v));
	}
	for (let attempt = 0; attempt <= retries; attempt++) {
		const res = await fetch(url, {
			headers: { "User-Agent": "OpenQuestionsFetcher/1.0 (Build; Bun)" },
		});
		if (res.ok) return (await res.json()) as WikiParseResponse;
		if (res.status === 429 && attempt < retries) {
			const wait = (attempt + 1) * 5000;
			console.log(`    Rate limited, waiting ${wait / 1000}s...`);
			await Bun.sleep(wait);
			continue;
		}
		throw new Error(`Wikipedia API ${res.status}`);
	}
	throw new Error("Wikipedia API request failed");
}

function cleanText(text: string): string {
	return text
		.replace(/\{\\displaystyle\s*([^}]*)\}/g, "$1")
		.replace(/\\displaystyle\s*/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function removeCitations(el: Element): void {
	for (const node of el.querySelectorAll(
		"sup, .reference, .mw-cite-backlink",
	)) {
		node.remove();
	}
}

function htmlToListItems(html: string): string[] {
	const { document: doc } = parseHTML(html);
	const items: string[] = [];
	const seen = new Set<string>();

	for (const li of doc.querySelectorAll("li")) {
		if (li.closest(".reflist, .references, .mw-references-wrap")) continue;
		removeCitations(li);
		const text = cleanText(li.textContent ?? "");
		if (/^\^/.test(text)) continue;
		if (text.length < 15) continue;
		if (seen.has(text)) continue;
		seen.add(text);
		items.push(text);
	}

	if (items.length === 0) {
		for (const p of doc.querySelectorAll("p")) {
			removeCitations(p);
			const text = cleanText(p.textContent ?? "");
			if (text.length < 30) continue;
			if (seen.has(text)) continue;
			seen.add(text);
			items.push(text);
		}
	}

	return items;
}

function stripHtml(str: string): string {
	return str.replace(/<[^>]+>/g, "").trim();
}

export async function fetchCategory(
	key: string,
	category: CategoryManifestEntry,
): Promise<ProblemSection[]> {
	const page = category.source.page;
	if (
		normalizedSourceType(category.source) !== "wikipedia" ||
		typeof page !== "string"
	) {
		throw new Error(
			`Category "${key}" does not have a supported wikipedia source; external data must be supplied to the publish CLI.`,
		);
	}
	console.log(`  [${key}] fetching sections...`);

	const sectionsData = await wikiRequest({
		action: "parse",
		page,
		prop: "sections",
		redirects: true,
	});
	const sections = sectionsData.parse?.sections || [];
	const result: ProblemSection[] = [];

	for (const sec of sections) {
		const heading = stripHtml(sec.line || "");
		const headingLower = heading.toLowerCase();
		if (SKIP_HEADINGS.has(headingLower)) continue;
		if (headingLower.includes("solved")) continue;
		if (Number.parseInt(sec.toclevel, 10) > 2) continue;

		await Bun.sleep(200);
		const htmlData = await wikiRequest({
			action: "parse",
			page,
			prop: "text",
			section: sec.index,
		});
		const html = htmlData.parse?.text?.["*"] || "";
		const problems = htmlToListItems(html);

		if (problems.length > 0) {
			result.push({ heading, problems });
		}
	}

	console.log(
		`  [${key}] ${result.reduce((n, s) => n + s.problems.length, 0)} problems in ${result.length} sections`,
	);
	return result;
}

export async function main(): Promise<void> {
	console.log("Fetching unsolved problems from Wikipedia...\n");
	const manifest = await loadManifest();
	const data: Record<string, ProblemSection[]> = {};

	const categories = categoryEntries(manifest).filter(
		([, category]) => category.type === "problems",
	);
	if (categories.length === 0) {
		const output = {
			fetchedAt: new Date().toISOString(),
			categories: {},
		};
		await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
		await publish(OUTPUT_PATH);
		console.log(
			"No problem categories declared; wrote an empty problems file.",
		);
		return;
	}
	for (const [i, [key, category]] of categories.entries()) {
		if (normalizedSourceType(category.source) !== "wikipedia") {
			throw new Error(
				`Problem category "${key}" does not use a supported wikipedia source; supply its prebuilt data to open-questions-publish instead.`,
			);
		}
		try {
			data[key] = await fetchCategory(key, category);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`  [${key}] FAILED: ${message}`);
			data[key] = [];
		}
		if (i < categories.length - 1) await Bun.sleep(1000);
	}
	const output = {
		fetchedAt: new Date().toISOString(),
		categories: data,
	};

	await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
	await publish(OUTPUT_PATH);

	const totalProblems = Object.values(data)
		.flat()
		.reduce((n, s) => n + s.problems.length, 0);

	console.log(`\nDone. ${totalProblems} problems written to ${OUTPUT_PATH}`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
