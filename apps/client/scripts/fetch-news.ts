#!/usr/bin/env bun
/**
 * Pre-fetches manifest-declared news feeds from Perigon at build time.
 * Outputs:
 * - public/data/news.json
 * - public/data/news-history/YYYY-MM-DD.json
 * - public/data/news-history/index.json
 */

const OUTPUT_PATH = "public/data/news.json";

import {
	type CategoryManifest,
	categoryEntries,
	normalizedSourceType,
	parseManifestJson,
} from "../lib/manifest";
import { publish } from "./publish";

const HISTORY_DIR = "public/data/news-history";
const MANIFEST_PATH =
	Bun.env.PUBLISH_MANIFEST ||
	Bun.env.OPEN_QUESTIONS_MANIFEST ||
	Bun.env.CATALOG_MANIFEST ||
	"public/data/manifest.json";

interface RawArticle {
	title: string;
	url: string;
	domain: string;
	seendate: string;
}

interface NewsSource {
	domain: string;
	url: string;
}

interface NewsStory {
	title: string;
	seendate: string;
	sources: NewsSource[];
}

interface NewsOutput {
	fetchedAt: string;
	categories: Record<string, NewsCategoryOutput>;
}

interface NewsCategoryOutput {
	label: string;
	totalArticles: number;
	articles: NewsStory[];
	sourceName?: string;
	sourceUrl?: string;
}

interface ArchiveEntry {
	date: string;
	fetchedAt: string;
	totalArticles: number;
	categories: Record<string, number>;
	path: string;
}

interface ArchiveIndex {
	updatedAt?: string;
	snapshots: ArchiveEntry[];
}

interface PerigonArticle {
	title: string;
	url: string;
	pubDate: string;
	source?: { domain?: string };
}

interface PerigonResponse {
	articles?: PerigonArticle[];
}

export async function loadManifest(
	path = MANIFEST_PATH,
): Promise<CategoryManifest> {
	const file = Bun.file(path);
	if (!(await file.exists())) throw new Error(`Manifest not found at ${path}.`);
	return parseManifestJson(await file.text());
}

async function loadApiKey(): Promise<string> {
	const secrets = Bun.file(".env.secrets");
	if (await secrets.exists()) {
		const text = await secrets.text();
		for (const line of text.split("\n")) {
			const [key, ...rest] = line.split("=");
			if (key?.trim() === "PERIGON_API_KEY") return rest.join("=").trim();
		}
	}
	return Bun.env.PERIGON_API_KEY || "";
}

function normalize(t: string): string {
	return t
		.toLowerCase()
		.replace(/['']/g, "'")
		.replace(/[^\w\s]/g, "")
		.trim();
}

export function groupArticles(articles: RawArticle[]): NewsStory[] {
	const groups: NewsStory[] = [];
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

function buildSnapshotDate(isoTimestamp: string): string {
	return isoTimestamp.slice(0, 10);
}

async function loadArchiveIndex(path: string): Promise<ArchiveIndex> {
	const file = Bun.file(path);
	if (!(await file.exists())) return { snapshots: [] };
	try {
		return (await file.json()) as ArchiveIndex;
	} catch {
		return { snapshots: [] };
	}
}

async function saveArchive(output: NewsOutput) {
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
			Number.isInteger(entry?.totalArticles) &&
			entry?.categories &&
			Object.keys(entry.categories).sort().join("\u0000") ===
				categoryKeys.join("\u0000"),
	);
	const nextEntry: ArchiveEntry = {
		date: snapshotDate,
		fetchedAt: output.fetchedAt,
		totalArticles: Object.values(output.categories).reduce(
			(sum, category) => sum + category.totalArticles,
			0,
		),
		categories: Object.fromEntries(
			Object.entries(output.categories).map(([key, category]) => [
				key,
				category.articles.length,
			]),
		),
		path: `news-history/${snapshotDate}.json`,
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
		historyDir: HISTORY_DIR,
		snapshotCount: filtered.length,
	};
}

export async function main(): Promise<void> {
	const manifest = await loadManifest();
	const newsCategories = categoryEntries(manifest).filter(
		([, category]) => category.type === "news",
	);
	if (newsCategories.length === 0) {
		const output: NewsOutput = {
			fetchedAt: new Date().toISOString(),
			categories: {},
		};
		await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
		const archive = await saveArchive(output);
		await publish(
			OUTPUT_PATH,
			archive.snapshotPath,
			`${HISTORY_DIR}/index.json`,
		);
		console.log("No news categories declared; wrote an empty news file.");
		return;
	}

	const apiKey = await loadApiKey();
	if (!apiKey) {
		console.error("No PERIGON_API_KEY found in .env.secrets or environment");
		process.exit(1);
	}

	console.log("Fetching news categories from Perigon...\n");
	const fetchedAt = new Date().toISOString();
	const categories: Record<string, NewsCategoryOutput> = {};

	for (const [key, category] of newsCategories) {
		if (normalizedSourceType(category.source) !== "perigon") {
			throw new Error(
				`News category "${key}" does not use a supported perigon source; external data must be supplied to the publish CLI.`,
			);
		}
		const source = category.source;
		const params = new URLSearchParams({
			q: String(source.query),
			...(source.category ? { category: String(source.category) } : {}),
			...(source.sourceGroup
				? { sourceGroup: String(source.sourceGroup) }
				: {}),
			...(source.size ? { size: String(source.size) } : {}),
			...(source.sortBy ? { sortBy: String(source.sortBy) } : {}),
		});
		const res = await fetch(`https://api.goperigon.com/v1/all?${params}`, {
			headers: { "x-api-key": apiKey },
		});
		if (!res.ok) {
			throw new Error(
				`Perigon API error for ${key}: ${res.status} ${await res.text()}`,
			);
		}
		const data = (await res.json()) as PerigonResponse;
		const articles: RawArticle[] = (data.articles || []).map((a) => ({
			title: a.title,
			url: a.url,
			domain: a.source?.domain || "unknown",
			seendate: a.pubDate,
		}));
		const grouped = groupArticles(articles);
		categories[key] = {
			label: category.label,
			totalArticles: articles.length,
			articles: grouped,
			...(typeof source.sourceName === "string"
				? { sourceName: source.sourceName }
				: {}),
			...(typeof source.sourceUrl === "string"
				? { sourceUrl: source.sourceUrl }
				: {}),
		};
		console.log(
			`  [${key}] ${grouped.length} stories (${articles.length} articles)`,
		);
	}

	const output: NewsOutput = { fetchedAt, categories };

	await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
	const archive = await saveArchive(output);
	await publish(OUTPUT_PATH, archive.snapshotPath, `${HISTORY_DIR}/index.json`);

	console.log(
		`Done. ${Object.values(categories).reduce((sum, category) => sum + category.articles.length, 0)} stories written to ${OUTPUT_PATH}`,
	);
	console.log(
		`Archived snapshot for ${archive.snapshotDate} at ${archive.snapshotPath} (${archive.snapshotCount} total snapshots)`,
	);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
