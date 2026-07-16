#!/usr/bin/env bun
/**
 * Pre-fetches frontier research news from Perigon at build time.
 * Outputs:
 * - public/data/news.json
 * - public/data/news-history/YYYY-MM-DD.json
 * - public/data/news-history/index.json
 */

const OUTPUT_PATH = "public/data/news.json";
const HISTORY_DIR = "public/data/news-history";

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
	totalArticles: number;
	articles: NewsStory[];
}

interface ArchiveEntry {
	date: string;
	fetchedAt: string;
	storyCount: number;
	articleCount: number;
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

function groupArticles(articles: RawArticle[]): NewsStory[] {
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
	const snapshots = Array.isArray(existing.snapshots) ? existing.snapshots : [];
	const nextEntry: ArchiveEntry = {
		date: snapshotDate,
		fetchedAt: output.fetchedAt,
		storyCount: output.articles.length,
		articleCount: output.totalArticles,
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

async function main(): Promise<void> {
	const apiKey = await loadApiKey();
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

	const data = (await res.json()) as PerigonResponse;
	const articles: RawArticle[] = (data.articles || []).map((a) => ({
		title: a.title,
		url: a.url,
		domain: a.source?.domain || "unknown",
		seendate: a.pubDate,
	}));

	const grouped = groupArticles(articles);
	const fetchedAt = new Date().toISOString();

	const output: NewsOutput = {
		fetchedAt,
		totalArticles: articles.length,
		articles: grouped,
	};

	await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
	const archive = await saveArchive(output);

	console.log(
		`Done. ${grouped.length} stories (${articles.length} articles) written to ${OUTPUT_PATH}`,
	);
	console.log(
		`Archived snapshot for ${archive.snapshotDate} at ${archive.snapshotPath} (${archive.snapshotCount} total snapshots)`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
