#!/usr/bin/env bun
/**
 * Pre-fetches official FBI ViCAP case listings with a real browser session.
 * Outputs:
 * - public/data/cases.json
 * - public/data/case-history/YYYY-MM-DD.json
 * - public/data/case-history/index.json
 */

import { type BrowserContext, chromium, type LaunchOptions } from "playwright";
import type { CaseCategoryData, CaseItem } from "../lib/cases";
import {
	type CategoryManifest,
	type CategoryManifestEntry,
	categoryEntries,
	normalizedSourceType,
	parseManifestJson,
} from "../lib/manifest";
import { publish } from "./publish";

const OUTPUT_PATH = "public/data/cases.json";
const HISTORY_DIR = "public/data/case-history";
const MAX_WAIT_MS = 120000;
const DETAIL_CONCURRENCY = Number(Bun.env.VICAP_DETAIL_CONCURRENCY || 4);
const MANIFEST_PATH =
	Bun.env.PUBLISH_MANIFEST ||
	Bun.env.OPEN_QUESTIONS_MANIFEST ||
	Bun.env.CATALOG_MANIFEST ||
	"public/data/manifest.json";

interface CaseSource {
	key: string;
	label: string;
	heading: string;
	sourceSection: string;
	url: string;
	sourceName: string;
	disclaimer: string;
}

interface CasesFile {
	fetchedAt?: string;
	sourceName?: string;
	categories?: Record<string, CaseCategoryData>;
}

interface ArchiveEntry {
	date: string;
	fetchedAt: string;
	totalCases: number;
	categories: Record<string, number>;
	path: string;
}

interface ArchiveIndex {
	updatedAt?: string;
	snapshots: ArchiveEntry[];
}

interface DetailPayload {
	title: string | null;
	bodyText: string;
}

interface ListingResult {
	total: number;
	items: CaseItem[];
}

export async function loadManifest(
	path = MANIFEST_PATH,
): Promise<CategoryManifest> {
	const file = Bun.file(path);
	if (!(await file.exists())) throw new Error(`Manifest not found at ${path}.`);
	return parseManifestJson(await file.text());
}

export function caseSourceFromManifest(
	key: string,
	category: CategoryManifestEntry,
): CaseSource {
	if (normalizedSourceType(category.source) !== "fbi-vicap") {
		throw new Error(
			`Case category "${key}" does not use a supported fbi-vicap source; external data must be supplied to the publish CLI.`,
		);
	}
	const source = category.source;
	const sourceName =
		typeof source.sourceName === "string" ? source.sourceName : category.label;
	const url = String(source.url);
	return {
		key,
		label: category.label,
		heading:
			typeof source.heading === "string"
				? source.heading
				: String(source.sourceSection),
		sourceSection: String(source.sourceSection),
		url,
		sourceName,
		disclaimer:
			typeof source.disclaimer === "string" && source.disclaimer.trim()
				? source.disclaimer
				: `Public listings supplied by ${category.label}.`,
	};
}

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

function buildSnapshotDate(isoTimestamp: string): string {
	return isoTimestamp.slice(0, 10);
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
	const file = Bun.file(path);
	if (!(await file.exists())) return fallback;
	try {
		return (await file.json()) as T;
	} catch {
		return fallback;
	}
}

async function loadExistingCategories(): Promise<
	Record<string, CaseCategoryData>
> {
	const data = await loadJson<CasesFile>(OUTPUT_PATH, { categories: {} });
	return data.categories || {};
}

async function loadArchiveIndex(path: string): Promise<ArchiveIndex> {
	return loadJson(path, { snapshots: [] });
}

async function saveArchive(output: {
	fetchedAt: string;
	categories: Record<string, CaseCategoryData>;
}) {
	const snapshotDate = buildSnapshotDate(output.fetchedAt);
	const snapshotPath = `${HISTORY_DIR}/${snapshotDate}.json`;
	const indexPath = `${HISTORY_DIR}/index.json`;

	await Bun.write(snapshotPath, JSON.stringify(output, null, 2));

	const existing = await loadArchiveIndex(indexPath);
	const categoryKeys = Object.keys(output.categories).sort();
	const snapshots = (
		Array.isArray(existing.snapshots) ? existing.snapshots : []
	).filter(
		(entry) =>
			typeof entry?.date === "string" &&
			/^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
			typeof entry?.fetchedAt === "string" &&
			typeof entry?.path === "string" &&
			Number.isInteger(entry?.totalCases) &&
			entry?.categories &&
			Object.keys(entry.categories).sort().join("\u0000") ===
				categoryKeys.join("\u0000"),
	);
	const categoryCounts = Object.fromEntries(
		Object.entries(output.categories).map(([key, value]) => [
			key,
			value.items.length,
		]),
	);
	const totalCases = Object.values(output.categories).reduce(
		(sum, value) => sum + value.items.length,
		0,
	);

	const nextEntry: ArchiveEntry = {
		date: snapshotDate,
		fetchedAt: output.fetchedAt,
		totalCases,
		categories: categoryCounts,
		path: `case-history/${snapshotDate}.json`,
	};

	const filtered = snapshots.filter((entry) => entry.date !== snapshotDate);
	filtered.push(nextEntry);
	filtered.sort((a, b) => b.date.localeCompare(a.date));

	await Bun.write(
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

	return {
		snapshotDate,
		snapshotPath,
		snapshotCount: filtered.length,
		totalCases,
	};
}

async function resolveExecutablePath(): Promise<string | null> {
	const explicit = Bun.env.PLAYWRIGHT_EXECUTABLE_PATH;
	if (explicit && (await Bun.file(explicit).exists())) return explicit;

	const candidates = [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/snap/bin/chromium",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	];

	for (const candidate of candidates) {
		if (await Bun.file(candidate).exists()) return candidate;
	}
	return null;
}

async function createLaunchOptions(): Promise<LaunchOptions> {
	const executablePath = await resolveExecutablePath();
	const options: LaunchOptions = {
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

function normalizeLine(raw: string): string {
	return raw
		.replace(/\u00a0/g, " ")
		.replace(/[ ]+/g, " ")
		.trim();
}

function toLines(text: string): string[] {
	return text.split("\n").map(normalizeLine).filter(Boolean);
}

function looksLikeDate(line: string): boolean {
	return /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(line);
}

function extractSection(
	lines: string[],
	startLabel: string,
	endLabels: string[],
): string | null {
	const start = lines.indexOf(startLabel);
	if (start === -1) return null;

	let end = lines.length;
	for (const label of endLabels) {
		const index = lines.findIndex((line, i) => i > start && line === label);
		if (index !== -1 && index < end) end = index;
	}

	const body = lines
		.slice(start + 1, end)
		.filter(
			(line) => !["View Poster", "Download Poster", "English"].includes(line),
		);

	return body.length ? body.join(" ") : null;
}

function parseFacts(lines: string[]): Record<string, string> {
	const start = lines.indexOf("English");
	if (start === -1) return {};

	const stopLabels = new Set([
		"Remarks:",
		"Details:",
		"Submit a Tip:",
		"Reward:",
		"Caution:",
	]);
	const facts: Record<string, string> = {};

	for (const line of lines.slice(start + 1)) {
		if (stopLabels.has(line)) break;
		const parts = line
			.split("\t")
			.map((part) => part.trim())
			.filter(Boolean);
		const [label, ...values] = parts;
		if (label && values.length > 0) {
			facts[label] = values.join(" ");
		}
	}

	return facts;
}

function parseDetailPayload(item: CaseItem, payload: DetailPayload): CaseItem {
	const title = payload.title || item.title;
	const lines = toLines(payload.bodyText || "");
	const titleIndex = lines.indexOf(title);
	const afterTitle = titleIndex === -1 ? lines : lines.slice(titleIndex + 1);
	const shareIndex = afterTitle.findIndex((line) => /^Share on /i.test(line));
	const headerLines = (
		shareIndex === -1 ? afterTitle.slice(0, 6) : afterTitle.slice(0, shareIndex)
	).filter(
		(line) => !["View Poster", "Download Poster", "English"].includes(line),
	);

	let reportedDate: string | null = null;
	let location: string | null = null;
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

function buildFallbackCategory(
	source: CaseSource,
	existing: CaseCategoryData | undefined,
	fetchedAt: string,
	error: Error,
): CaseCategoryData {
	if (existing) {
		return {
			...existing,
			label: source.label,
			sourceName: source.sourceName,
			sourceSection: source.sourceSection,
			sourceUrl: source.url,
			disclaimer: source.disclaimer,
			fresh: false,
			attemptedAt: fetchedAt,
			lastSuccessfulFetchAt:
				existing.lastSuccessfulFetchAt || existing.attemptedAt || null,
			lastError: error.message,
		};
	}

	return {
		label: source.label,
		sourceName: source.sourceName,
		sourceSection: source.sourceSection,
		sourceUrl: source.url,
		disclaimer: source.disclaimer,
		total: 0,
		fresh: false,
		attemptedAt: fetchedAt,
		lastSuccessfulFetchAt: null,
		lastError: error.message,
		items: [],
	};
}

async function waitForListings(
	page: Awaited<ReturnType<BrowserContext["newPage"]>>,
	source: CaseSource,
): Promise<void> {
	await page.waitForFunction(
		(heading) => {
			const title = document.title || "";
			const body = document.body?.innerText || "";
			if (
				/Just a moment|Checking your browser|Performing security verification/i.test(
					`${title}\n${body}`,
				)
			) {
				return false;
			}

			const pageHeading =
				document.querySelector("h1")?.textContent?.trim() || "";
			return (
				pageHeading.includes(heading) &&
				document.querySelectorAll("li.portal-type-person").length > 0
			);
		},
		source.heading,
		{ timeout: MAX_WAIT_MS },
	);
}

async function expandListings(
	page: Awaited<ReturnType<BrowserContext["newPage"]>>,
	source: CaseSource,
): Promise<void> {
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
			(count) =>
				document.querySelectorAll("li.portal-type-person").length > count,
			before,
			{ timeout: MAX_WAIT_MS },
		);
		await page.waitForTimeout(250);
	}

	throw new Error(`Exceeded pagination safety limit for ${source.key}`);
}

async function scrapeListing(
	context: BrowserContext,
	source: CaseSource,
): Promise<ListingResult> {
	const page = await context.newPage();
	try {
		console.log(`  [${source.key}] opening ${source.url}`);
		await page.goto(source.url, {
			waitUntil: "domcontentloaded",
			timeout: MAX_WAIT_MS,
		});
		await waitForListings(page, source);
		await expandListings(page, source);

		const listing = await page.evaluate(
			({ section, sourceName, sourceUrl }) => {
				const body = document.body?.innerText || "";
				const totalMatch = body.match(/Results:\s*([\d,]+)\s*Items/i);
				const items = [...document.querySelectorAll("li.portal-type-person")]
					.map((card) => {
						const nameLink = card.querySelector("p.name a");
						if (!nameLink || !(nameLink instanceof HTMLAnchorElement))
							return null;

						const img = card.querySelector("img");
						return {
							id: new URL(nameLink.href).pathname.replace(/^\/+/, ""),
							title: nameLink.textContent?.trim() || "",
							url: nameLink.href,
							imageUrl: img instanceof HTMLImageElement ? img.src : null,
							sourceName,
							sourceSection: section,
							sourceUrl,
							reportedDate: null,
							location: null,
							facts: {},
							details: null,
							remarks: null,
						};
					})
					.filter((item): item is NonNullable<typeof item> => Boolean(item));

				return {
					total: totalMatch?.[1]
						? Number(totalMatch[1].replace(/,/g, ""))
						: items.length,
					items,
				};
			},
			{
				section: source.sourceSection,
				sourceName: source.sourceName,
				sourceUrl: source.url,
			},
		);

		const dedupedItems: CaseItem[] = [];
		const seen = new Set<string>();
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

function splitExistingDetails(
	items: CaseItem[],
	existingItems: CaseItem[] | undefined,
) {
	const existingByUrl = new Map(
		(existingItems || []).map((item) => [item.url, item]),
	);
	const hydrated: CaseItem[] = [];
	const pending: CaseItem[] = [];

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

		if (canReuse && existing) {
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

async function scrapeDetail(
	context: BrowserContext,
	item: CaseItem,
): Promise<CaseItem> {
	const page = await context.newPage();
	try {
		await page.goto(item.url, {
			waitUntil: "domcontentloaded",
			timeout: MAX_WAIT_MS,
		});
		await page.waitForFunction(
			() => {
				const title = document.title || "";
				const body = document.body?.innerText || "";
				return (
					!/Just a moment|Checking your browser|Performing security verification/i.test(
						`${title}\n${body}`,
					) && !!document.querySelector("h1")
				);
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

async function enrichPendingDetails(
	context: BrowserContext,
	items: CaseItem[],
): Promise<CaseItem[]> {
	if (items.length === 0) return [];

	const results = new Array<CaseItem>(items.length);
	let cursor = 0;

	async function worker() {
		while (true) {
			const current = cursor++;
			const item = items[current];
			if (!item) return;

			try {
				results[current] = await scrapeDetail(context, item);
				console.log(
					`    [detail] ${current + 1}/${items.length} ${item.title}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`    [detail] failed for ${item.title}: ${message}`);
				results[current] = item;
			}
		}
	}

	const workers = Array.from(
		{ length: Math.min(DETAIL_CONCURRENCY, items.length) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
}

async function scrapeSource(
	context: BrowserContext,
	source: CaseSource,
	existingCategory: CaseCategoryData | undefined,
	fetchedAt: string,
): Promise<CaseCategoryData> {
	const listing = await scrapeListing(context, source);
	const { hydrated, pending } = splitExistingDetails(
		listing.items,
		existingCategory?.items,
	);
	const pendingDetails = await enrichPendingDetails(context, pending);
	const pendingByUrl = new Map(pendingDetails.map((item) => [item.url, item]));
	const hydratedByUrl = new Map(hydrated.map((item) => [item.url, item]));
	const items = listing.items.map(
		(item) => pendingByUrl.get(item.url) || hydratedByUrl.get(item.url) || item,
	);

	return {
		label: source.label,
		sourceName: source.sourceName,
		sourceSection: source.sourceSection,
		sourceUrl: source.url,
		disclaimer: source.disclaimer,
		total: listing.total,
		fresh: true,
		attemptedAt: fetchedAt,
		lastSuccessfulFetchAt: fetchedAt,
		lastError: null,
		items,
	};
}

export async function main(): Promise<void> {
	console.log("Fetching FBI ViCAP case listings with Playwright...\n");

	const manifest = await loadManifest();
	const sources = categoryEntries(manifest)
		.filter(([, category]) => category.type === "cases")
		.map(([key, category]) => caseSourceFromManifest(key, category));
	const fetchedAt = new Date().toISOString();
	if (sources.length === 0) {
		const output = {
			fetchedAt,
			sourceName: "Configured source",
			categories: {},
		};
		await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
		const archive = await saveArchive(output);
		await publish(
			OUTPUT_PATH,
			archive.snapshotPath,
			`${HISTORY_DIR}/index.json`,
		);
		console.log("No case categories declared; wrote an empty cases file.");
		return;
	}
	const existingCategories = await loadExistingCategories();
	const browser = await chromium.launch(await createLaunchOptions());
	const context = await browser.newContext({
		userAgent: USER_AGENT,
		viewport: { width: 1440, height: 1024 },
		locale: "en-US",
		timezoneId: "America/New_York",
	});

	const categories: Record<string, CaseCategoryData> = {};

	try {
		for (const source of sources) {
			try {
				categories[source.key] = await scrapeSource(
					context,
					source,
					existingCategories[source.key],
					fetchedAt,
				);
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				console.warn(`  [${source.key}] fetch failed: ${err.message}`);
				categories[source.key] = buildFallbackCategory(
					source,
					existingCategories[source.key],
					fetchedAt,
					err,
				);
			}
		}
	} finally {
		await context.close();
		await browser.close();
	}

	const output = {
		fetchedAt,
		sourceName: sources[0]?.sourceName || "Configured source",
		categories,
	};

	await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
	const archive = await saveArchive(output);
	await publish(OUTPUT_PATH, archive.snapshotPath, `${HISTORY_DIR}/index.json`);

	console.log(
		`\nDone. ${archive.totalCases} case listings written to ${OUTPUT_PATH} and archived at ${archive.snapshotPath} (${archive.snapshotCount} total snapshots)`,
	);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
