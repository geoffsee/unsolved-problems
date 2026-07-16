import {
	type CategoryManifest,
	getDataShapeValidationErrors,
	type NewsCategoryData,
	type ProblemsData,
	parseManifestJson,
	validateDataForManifest,
} from "../../lib/manifest";

export async function data() {
	const origin = (import.meta.env.VITE_API_ORIGIN || "/api").replace(
		/\/+$/,
		"",
	);
	const loadText = async (name: string, optional = false) => {
		const response = await fetch(`${origin}/data/${name}`);
		if (!response.ok) {
			if (optional) return null;
			throw new Error(
				`Unable to load /data/${name}: upstream returned ${response.status}.`,
			);
		}
		return response.text();
	};
	const load = async (name: string, optional = false) => {
		const text = await loadText(name, optional);
		return text === null ? {} : JSON.parse(text);
	};
	const manifestText = await loadText("manifest.json");
	const manifest = parseManifestJson(manifestText ?? "");
	const hasProblems = Object.values(manifest.categories).some(
		(category) => category.type === "problems",
	);
	const hasNews = Object.values(manifest.categories).some(
		(category) => category.type === "news",
	);
	const hasCases = Object.values(manifest.categories).some(
		(category) => category.type === "cases",
	);
	const [problems, enrichmentData, newsData, casesData] = await Promise.all([
		hasProblems ? load("problems.json") : Promise.resolve({ categories: {} }),
		hasProblems
			? load("enrichments.json", true)
			: Promise.resolve({ problems: {} }),
		hasNews ? load("news.json") : Promise.resolve({ categories: {} }),
		hasCases ? load("cases.json") : Promise.resolve({ categories: {} }),
	]);
	validateDataForManifest(manifest, problems, "problems");
	validateDataForManifest(manifest, newsData, "news");
	validateDataForManifest(manifest, casesData, "cases");
	const normalizedEnrichments =
		typeof enrichmentData === "object" &&
		enrichmentData !== null &&
		!Array.isArray(enrichmentData) &&
		enrichmentData.problems === undefined
			? { problems: {} }
			: enrichmentData;
	const enrichmentErrors = getDataShapeValidationErrors(
		normalizedEnrichments,
		"enrichments",
	);
	if (enrichmentErrors.length) {
		throw new Error(`Invalid enrichments data: ${enrichmentErrors.join("; ")}`);
	}
	const problemData = problems as ProblemsData;
	const news = newsData as { categories: Record<string, NewsCategoryData> };
	return {
		manifest: manifest as CategoryManifest,
		categories: problemData.categories || {},
		enrichments: normalizedEnrichments.problems || {},
		news: news.categories || {},
		cases: casesData.categories || {},
	};
}
