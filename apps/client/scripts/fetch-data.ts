#!/usr/bin/env bun
/**
 * Pre-fetches all unsolved-problem data from Wikipedia at build time.
 * Output: public/data/problems.json
 *
 * The app loads this file first so users see content instantly
 * without waiting for runtime API calls.
 */

import { parseHTML } from "linkedom";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const OUTPUT_PATH = "public/data/problems.json";

const CATEGORIES: Record<string, string> = {
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

async function fetchCategory(key: string): Promise<ProblemSection[]> {
	const page = CATEGORIES[key];
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

async function main(): Promise<void> {
	console.log("Fetching unsolved problems from Wikipedia...\n");
	const data: Record<string, ProblemSection[]> = {};

	const keys = Object.keys(CATEGORIES);
	for (const [i, key] of keys.entries()) {
		try {
			data[key] = await fetchCategory(key);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`  [${key}] FAILED: ${message}`);
			data[key] = [];
		}
		if (i < keys.length - 1) await Bun.sleep(1000);
	}

	const output = {
		fetchedAt: new Date().toISOString(),
		categories: data,
	};

	await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));

	const totalProblems = Object.values(data)
		.flat()
		.reduce((n, s) => n + s.problems.length, 0);

	console.log(`\nDone. ${totalProblems} problems written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
