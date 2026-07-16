/**
 * The published catalog contract.
 *
 * This module is intentionally free of browser, Bun, and Node APIs.  The API
 * imports it as well as the client and the publishing scripts, so every
 * surface applies the same manifest and data validation rules.
 */

export const MANIFEST_VERSION = 1 as const;

export type CategoryType = "problems" | "news" | "cases";

export type SourceType = "wikipedia" | "perigon" | "fbi-vicap" | "external";

export interface CategoryPresentation {
	page?: string;
	emoji?: string;
	color?: string;
	description?: string;
	sourceLabel?: string;
	sourceUrl?: string;
}

export interface SourceConfig {
	type?: SourceType;
	kind?: SourceType;
	[key: string]: unknown;
}

export interface CategoryManifestEntry {
	label: string;
	type: CategoryType;
	presentation?: CategoryPresentation;
	source: SourceConfig;
}

export interface CategoryManifest {
	version: typeof MANIFEST_VERSION;
	categories: Record<string, CategoryManifestEntry>;
}

export interface ProblemSectionData {
	heading: string;
	problems: string[];
}

export interface ProblemsData {
	fetchedAt?: string;
	categories: Record<string, ProblemSectionData[]>;
}

export interface NewsSourceData {
	domain: string;
	url: string;
}

export interface NewsArticleData {
	title: string;
	sources: NewsSourceData[];
	seendate: string;
}

export interface NewsCategoryData {
	label?: string;
	totalArticles?: number;
	articles: NewsArticleData[];
	sourceName?: string;
	sourceUrl?: string;
	lastSuccessfulFetchAt?: string | null;
	lastError?: string | null;
}

export interface NewsData {
	fetchedAt?: string;
	categories: Record<string, NewsCategoryData>;
}

export interface CaseItemData {
	id: string;
	title: string;
	url: string;
	imageUrl: string | null;
	sourceName: string;
	sourceSection: string;
	sourceUrl: string;
	reportedDate: string | null;
	location: string | null;
	facts: Record<string, string>;
	details: string | null;
	remarks: string | null;
}

export interface CaseCategoryDataShape {
	label: string;
	sourceName: string;
	sourceSection: string;
	sourceUrl: string;
	disclaimer: string;
	total: number;
	fresh: boolean;
	attemptedAt: string;
	lastSuccessfulFetchAt: string | null;
	lastError: string | null;
	items: CaseItemData[];
}

export interface CasesData {
	fetchedAt?: string;
	sourceName?: string;
	categories: Record<string, CaseCategoryDataShape>;
}

export interface EnrichmentsData {
	generatedAt?: string;
	model?: string;
	problems: Record<string, unknown>;
}

export interface HistorySnapshotIndexEntry {
	date: string;
	fetchedAt: string;
	totalArticles?: number;
	totalCases?: number;
	categories: Record<string, number>;
	path: string;
}

export interface HistoryIndexData {
	updatedAt?: string;
	snapshots: HistorySnapshotIndexEntry[];
}

export type PublishedDataKind =
	| "manifest"
	| "problems"
	| "news"
	| "cases"
	| "enrichments"
	| "news-history"
	| "case-history"
	| "news-history-index"
	| "case-history-index";

export class ManifestValidationError extends Error {
	readonly errors: string[];

	constructor(message: string, errors: string[] = [message]) {
		super(message);
		this.name = "ManifestValidationError";
		this.errors = errors;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function duplicateNormalizedKeys(keys: string[]): string[] {
	const seen = new Map<string, string>();
	const duplicates: string[] = [];
	for (const key of keys) {
		const normalized = key.trim().toLowerCase();
		const previous = seen.get(normalized);
		if (previous) duplicates.push(`"${key}" duplicates category "${previous}"`);
		else seen.set(normalized, key);
	}
	return duplicates;
}

function sourceError(
	category: string,
	categoryType: unknown,
	source: Record<string, unknown>,
	path: string,
): string[] {
	const errors: string[] = [];
	const sourceType = source.type ?? source.kind;
	if (!isNonEmptyString(sourceType)) {
		errors.push(
			`${path}.type must be one of wikipedia, perigon, fbi-vicap, or external`,
		);
		return errors;
	}

	const allowed: SourceType[] = [
		"wikipedia",
		"perigon",
		"fbi-vicap",
		"external",
	];
	if (!allowed.includes(sourceType as SourceType)) {
		errors.push(
			`${path}.type "${sourceType}" is unsupported for category "${category}"`,
		);
		return errors;
	}
	const supportedForCategory: Record<string, SourceType[]> = {
		problems: ["wikipedia", "external"],
		news: ["perigon", "external"],
		cases: ["fbi-vicap", "external"],
	};
	if (
		isNonEmptyString(categoryType) &&
		!supportedForCategory[categoryType]?.includes(sourceType as SourceType)
	) {
		errors.push(
			`${path}.type "${sourceType}" is incompatible with category type "${categoryType}" for "${category}"`,
		);
	}

	if (sourceType === "wikipedia" && !isNonEmptyString(source.page)) {
		errors.push(`${path}.page is required for a wikipedia source`);
	}
	for (const key of ["url", "sourceUrl"]) {
		if (source[key] !== undefined && !isNonEmptyString(source[key])) {
			errors.push(`${path}.${key} must be a non-empty string when supplied`);
		} else if (isNonEmptyString(source[key]) && !isHttpUrl(source[key])) {
			errors.push(`${path}.${key} must be an http(s) URL`);
		}
	}

	if (sourceType === "perigon") {
		if (!isNonEmptyString(source.query)) {
			errors.push(`${path}.query is required for a perigon source`);
		}
		for (const key of ["category", "sourceGroup", "sortBy"]) {
			if (source[key] !== undefined && !isNonEmptyString(source[key])) {
				errors.push(`${path}.${key} must be a non-empty string`);
			}
		}
		if (
			source.size !== undefined &&
			(!Number.isInteger(source.size) || Number(source.size) < 1)
		) {
			errors.push(`${path}.size must be a positive integer`);
		}
	}

	if (sourceType === "fbi-vicap") {
		for (const key of ["sourceSection", "url"]) {
			if (!isNonEmptyString(source[key])) {
				errors.push(`${path}.${key} is required for an fbi-vicap source`);
			}
		}
	}

	if (sourceType === "external" && source.path !== undefined) {
		// A path is useful as operator-facing documentation, but the manifest is
		// deliberately not an artifact map.  Rejecting it would make external
		// sources needlessly hard to describe, so only validate its type here.
		if (!isNonEmptyString(source.path)) {
			errors.push(`${path}.path must be a non-empty string when supplied`);
		}
	}

	return errors;
}

/** Return all validation errors without throwing. */
export function getManifestValidationErrors(value: unknown): string[] {
	if (!isRecord(value)) return ["manifest must be a JSON object"];

	const errors: string[] = [];
	if (value.version !== MANIFEST_VERSION) {
		errors.push(
			`manifest.version must be ${MANIFEST_VERSION}; received ${String(value.version)}`,
		);
	}
	if (!isRecord(value.categories)) {
		return [
			...errors,
			"manifest.categories must be an object keyed by category",
		];
	}

	const keys = Object.keys(value.categories);
	if (keys.length === 0) errors.push("manifest.categories must not be empty");
	errors.push(...duplicateNormalizedKeys(keys));

	const sourceKeys = new Map<string, string>();
	for (const category of keys) {
		const path = `manifest.categories[${JSON.stringify(category)}]`;
		if (!isNonEmptyString(category) || category !== category.trim()) {
			errors.push(`${path} must use a non-empty trimmed category key`);
		}
		const entry = value.categories[category];
		if (!isRecord(entry)) {
			errors.push(`${path} must be an object`);
			continue;
		}
		if (!isNonEmptyString(entry.label))
			errors.push(`${path}.label is required`);
		if (
			entry.type !== "problems" &&
			entry.type !== "news" &&
			entry.type !== "cases"
		) {
			errors.push(`${path}.type must be problems, news, or cases`);
		}

		if (entry.presentation !== undefined) {
			if (!isRecord(entry.presentation)) {
				errors.push(`${path}.presentation must be an object`);
			} else {
				for (const key of [
					"page",
					"emoji",
					"color",
					"description",
					"sourceLabel",
					"sourceUrl",
				]) {
					if (
						entry.presentation[key] !== undefined &&
						!isNonEmptyString(entry.presentation[key])
					) {
						errors.push(
							`${path}.presentation.${key} must be a non-empty string`,
						);
					}
				}
				if (
					isNonEmptyString(entry.presentation.sourceUrl) &&
					!isHttpUrl(entry.presentation.sourceUrl)
				) {
					errors.push(`${path}.presentation.sourceUrl must be an http(s) URL`);
				}
			}
		}

		if (!isRecord(entry.source)) {
			errors.push(`${path}.source is required and must be an object`);
			continue;
		}
		errors.push(
			...sourceError(category, entry.type, entry.source, `${path}.source`),
		);
		const sourceKey = entry.source.key;
		if (isNonEmptyString(sourceKey)) {
			const normalized = sourceKey.trim().toLowerCase();
			const previous = sourceKeys.get(normalized);
			if (previous) {
				errors.push(
					`${path}.source.key "${sourceKey}" duplicates source key on category "${previous}"`,
				);
			} else sourceKeys.set(normalized, category);
		}
	}

	return errors;
}

/** Validate and return a typed manifest. */
export function validateManifest(value: unknown): CategoryManifest {
	const errors = getManifestValidationErrors(value);
	if (errors.length) {
		throw new ManifestValidationError(
			`Invalid manifest: ${errors.join("; ")}`,
			errors,
		);
	}
	return value as CategoryManifest;
}

export function parseManifestJson(text: string): CategoryManifest {
	const duplicateKeys = findDuplicateJsonKeys(text);
	if (duplicateKeys.length) {
		throw new ManifestValidationError(
			`Invalid manifest JSON: duplicate object keys ${duplicateKeys.join(", ")}`,
			duplicateKeys.map((key) => `duplicate object key ${key}`),
		);
	}
	try {
		return validateManifest(JSON.parse(text));
	} catch (error) {
		if (error instanceof ManifestValidationError) throw error;
		throw new ManifestValidationError(
			`Invalid manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function findDuplicateJsonKeys(text: string): string[] {
	const stack: Array<Set<string>> = [];
	const duplicates: string[] = [];
	let index = 0;
	while (index < text.length) {
		const character = text[index];
		if (character === '"') {
			const start = index;
			index += 1;
			while (index < text.length) {
				if (text[index] === "\\") {
					index += 2;
					continue;
				}
				if (text[index] === '"') {
					index += 1;
					break;
				}
				index += 1;
			}
			let next = index;
			while (/\s/.test(text[next] || "")) next += 1;
			if (text[next] === ":" && stack.length > 0) {
				const rawKey = text.slice(start, index);
				let key: string;
				try {
					key = JSON.parse(rawKey) as string;
				} catch {
					key = rawKey;
				}
				const keys = stack[stack.length - 1];
				if (!keys) {
					index = next + 1;
					continue;
				}
				if (keys.has(key)) duplicates.push(`"${key}"`);
				else keys.add(key);
			}
			continue;
		}
		if (character === "{") stack.push(new Set());
		else if (character === "}") stack.pop();
		index += 1;
	}
	return [...new Set(duplicates)];
}

function expectedCategories(manifest: CategoryManifest, type: CategoryType) {
	return Object.entries(manifest.categories)
		.filter(([, category]) => category.type === type)
		.map(([key]) => key);
}

function validateCategoryKeys(
	actual: Record<string, unknown>,
	expected: string[],
	path: string,
): string[] {
	const errors: string[] = [];
	const expectedSet = new Set(expected);
	const actualKeys = Object.keys(actual);
	for (const key of expected) {
		if (!Object.hasOwn(actual, key))
			errors.push(`${path} is missing category "${key}"`);
	}
	for (const key of actualKeys) {
		if (!expectedSet.has(key))
			errors.push(`${path} has extra category "${key}"`);
	}
	errors.push(
		...duplicateNormalizedKeys(actualKeys).map((error) => `${path} ${error}`),
	);
	return errors;
}

function validateProblemsData(
	value: unknown,
	manifest: CategoryManifest,
): string[] {
	if (!isRecord(value)) return ["problems data must be a JSON object"];
	if (!isRecord(value.categories))
		return ["problems.categories must be an object"];
	const errors = validateCategoryKeys(
		value.categories,
		expectedCategories(manifest, "problems"),
		"problems.categories",
	);
	if (value.fetchedAt !== undefined && !isNonEmptyString(value.fetchedAt))
		errors.push("problems.fetchedAt must be a non-empty string");
	for (const [category, rawSections] of Object.entries(value.categories)) {
		if (!Array.isArray(rawSections)) {
			errors.push(
				`problems.categories[${JSON.stringify(category)}] must be an array`,
			);
			continue;
		}
		const headings = new Set<string>();
		for (const [index, rawSection] of rawSections.entries()) {
			const path = `problems.categories[${JSON.stringify(category)}][${index}]`;
			if (!isRecord(rawSection)) {
				errors.push(`${path} must be an object`);
				continue;
			}
			if (!isNonEmptyString(rawSection.heading))
				errors.push(`${path}.heading is required`);
			else if (headings.has(rawSection.heading))
				errors.push(`${path}.heading duplicates "${rawSection.heading}"`);
			else headings.add(rawSection.heading);
			if (!Array.isArray(rawSection.problems)) {
				errors.push(`${path}.problems must be an array`);
				continue;
			}
			const problems = new Set<string>();
			for (const [problemIndex, problem] of rawSection.problems.entries()) {
				if (!isNonEmptyString(problem)) {
					errors.push(
						`${path}.problems[${problemIndex}] must be a non-empty string`,
					);
				} else if (problems.has(problem)) {
					errors.push(`${path}.problems contains duplicate problem text`);
				} else problems.add(problem);
			}
		}
	}
	return errors;
}

function validateNewsData(
	value: unknown,
	manifest: CategoryManifest,
): string[] {
	if (!isRecord(value)) return ["news data must be a JSON object"];
	if (!isRecord(value.categories)) return ["news.categories must be an object"];
	const errors = validateCategoryKeys(
		value.categories,
		expectedCategories(manifest, "news"),
		"news.categories",
	);
	if (value.fetchedAt !== undefined && !isNonEmptyString(value.fetchedAt))
		errors.push("news.fetchedAt must be a non-empty string");
	for (const [category, rawFeed] of Object.entries(value.categories)) {
		const path = `news.categories[${JSON.stringify(category)}]`;
		if (!isRecord(rawFeed)) {
			errors.push(`${path} must be an object`);
			continue;
		}
		for (const field of ["label", "sourceName"]) {
			if (rawFeed[field] !== undefined && !isNonEmptyString(rawFeed[field]))
				errors.push(`${path}.${field} must be a non-empty string`);
		}
		if (
			rawFeed.sourceUrl !== undefined &&
			(!isNonEmptyString(rawFeed.sourceUrl) || !isHttpUrl(rawFeed.sourceUrl))
		)
			errors.push(`${path}.sourceUrl must be an http(s) URL`);
		if (!Array.isArray(rawFeed.articles)) {
			errors.push(`${path}.articles must be an array`);
			continue;
		}
		const titles = new Set<string>();
		for (const [index, rawArticle] of rawFeed.articles.entries()) {
			const articlePath = `${path}.articles[${index}]`;
			if (!isRecord(rawArticle)) {
				errors.push(`${articlePath} must be an object`);
				continue;
			}
			for (const field of ["title", "seendate"]) {
				if (!isNonEmptyString(rawArticle[field]))
					errors.push(`${articlePath}.${field} is required`);
			}
			if (isNonEmptyString(rawArticle.title)) {
				if (titles.has(rawArticle.title))
					errors.push(
						`${path}.articles contains duplicate title "${rawArticle.title}"`,
					);
				titles.add(rawArticle.title);
			}
			if (
				!Array.isArray(rawArticle.sources) ||
				rawArticle.sources.length === 0
			) {
				errors.push(`${articlePath}.sources must be a non-empty array`);
			} else {
				for (const [sourceIndex, rawSource] of rawArticle.sources.entries()) {
					const sourcePath = `${articlePath}.sources[${sourceIndex}]`;
					if (
						!isRecord(rawSource) ||
						!isNonEmptyString(rawSource.domain) ||
						!isNonEmptyString(rawSource.url) ||
						!isHttpUrl(rawSource.url)
					) {
						errors.push(
							`${sourcePath} must contain a domain and an http(s) url`,
						);
					}
				}
			}
		}
		if (
			rawFeed.totalArticles !== undefined &&
			(!Number.isInteger(rawFeed.totalArticles) ||
				Number(rawFeed.totalArticles) < 0)
		) {
			errors.push(`${path}.totalArticles must be a non-negative integer`);
		}
	}
	return errors;
}

function validateCasesData(
	value: unknown,
	manifest: CategoryManifest,
): string[] {
	if (!isRecord(value)) return ["cases data must be a JSON object"];
	if (!isRecord(value.categories))
		return ["cases.categories must be an object"];
	const errors = validateCategoryKeys(
		value.categories,
		expectedCategories(manifest, "cases"),
		"cases.categories",
	);
	if (value.fetchedAt !== undefined && !isNonEmptyString(value.fetchedAt))
		errors.push("cases.fetchedAt must be a non-empty string");
	if (value.sourceName !== undefined && !isNonEmptyString(value.sourceName))
		errors.push("cases.sourceName must be a non-empty string");
	for (const [category, rawFeed] of Object.entries(value.categories)) {
		const path = `cases.categories[${JSON.stringify(category)}]`;
		if (!isRecord(rawFeed)) {
			errors.push(`${path} must be an object`);
			continue;
		}
		for (const field of [
			"label",
			"sourceName",
			"sourceSection",
			"sourceUrl",
			"disclaimer",
			"attemptedAt",
		]) {
			if (!isNonEmptyString(rawFeed[field]))
				errors.push(`${path}.${field} is required`);
		}
		if (!isHttpUrl(String(rawFeed.sourceUrl)))
			errors.push(`${path}.sourceUrl must be an http(s) URL`);
		if (
			typeof rawFeed.total !== "number" ||
			!Number.isInteger(rawFeed.total) ||
			rawFeed.total < 0
		)
			errors.push(`${path}.total must be a non-negative integer`);
		if (typeof rawFeed.fresh !== "boolean")
			errors.push(`${path}.fresh must be a boolean`);
		if (
			rawFeed.lastSuccessfulFetchAt !== null &&
			rawFeed.lastSuccessfulFetchAt !== undefined &&
			!isNonEmptyString(rawFeed.lastSuccessfulFetchAt)
		)
			errors.push(`${path}.lastSuccessfulFetchAt must be a string or null`);
		if (
			rawFeed.lastError !== null &&
			rawFeed.lastError !== undefined &&
			!isNonEmptyString(rawFeed.lastError)
		)
			errors.push(`${path}.lastError must be a string or null`);
		if (!Array.isArray(rawFeed.items)) {
			errors.push(`${path}.items must be an array`);
			continue;
		}
		const ids = new Set<string>();
		for (const [index, rawItem] of rawFeed.items.entries()) {
			const itemPath = `${path}.items[${index}]`;
			if (!isRecord(rawItem)) {
				errors.push(`${itemPath} must be an object`);
				continue;
			}
			for (const field of [
				"id",
				"title",
				"url",
				"sourceName",
				"sourceSection",
				"sourceUrl",
			]) {
				if (!isNonEmptyString(rawItem[field]))
					errors.push(`${itemPath}.${field} is required`);
			}
			for (const field of ["url", "sourceUrl"]) {
				if (isNonEmptyString(rawItem[field]) && !isHttpUrl(rawItem[field]))
					errors.push(`${itemPath}.${field} must be an http(s) URL`);
			}
			if (isNonEmptyString(rawItem.id)) {
				if (ids.has(rawItem.id))
					errors.push(`${path}.items contains duplicate id "${rawItem.id}"`);
				ids.add(rawItem.id);
			}
			if (!isRecord(rawItem.facts))
				errors.push(`${itemPath}.facts must be an object`);
			if (
				rawItem.facts &&
				isRecord(rawItem.facts) &&
				Object.values(rawItem.facts).some((fact) => typeof fact !== "string")
			)
				errors.push(`${itemPath}.facts values must be strings`);
			for (const field of [
				"imageUrl",
				"reportedDate",
				"location",
				"details",
				"remarks",
			]) {
				if (
					!Object.hasOwn(rawItem, field) ||
					(rawItem[field] !== null && typeof rawItem[field] !== "string")
				)
					errors.push(`${itemPath}.${field} must be a string or null`);
			}
		}
	}
	return errors;
}

function validateEnrichmentsData(value: unknown): string[] {
	if (!isRecord(value)) return ["enrichments data must be a JSON object"];
	if (!isRecord(value.problems))
		return ["enrichments.problems must be an object"];
	for (const [key, enrichment] of Object.entries(value.problems)) {
		if (!isRecord(enrichment))
			return [`enrichments.problems[${JSON.stringify(key)}] must be an object`];
	}
	return [];
}

function validateHistoryIndexData(
	value: unknown,
	manifest: CategoryManifest | undefined,
	categoryType: "news" | "cases",
): string[] {
	if (!isRecord(value)) return ["history index must be a JSON object"];
	if (value.updatedAt !== undefined && !isNonEmptyString(value.updatedAt))
		return ["history index.updatedAt must be a non-empty string"];
	if (!Array.isArray(value.snapshots))
		return ["history index.snapshots must be an array"];

	const errors: string[] = [];
	const dates = new Set<string>();
	const expected = manifest
		? expectedCategories(manifest, categoryType)
		: undefined;
	for (const [index, rawSnapshot] of value.snapshots.entries()) {
		const path = `history index.snapshots[${index}]`;
		if (!isRecord(rawSnapshot)) {
			errors.push(`${path} must be an object`);
			continue;
		}
		for (const field of ["date", "fetchedAt", "path"]) {
			if (!isNonEmptyString(rawSnapshot[field]))
				errors.push(`${path}.${field} is required`);
		}
		if (isNonEmptyString(rawSnapshot.date)) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(rawSnapshot.date))
				errors.push(`${path}.date must use YYYY-MM-DD format`);
			if (dates.has(rawSnapshot.date))
				errors.push(`${path}.date is duplicated`);
			dates.add(rawSnapshot.date);
		}

		const totalField = categoryType === "news" ? "totalArticles" : "totalCases";
		if (
			typeof rawSnapshot[totalField] !== "number" ||
			!Number.isInteger(rawSnapshot[totalField]) ||
			Number(rawSnapshot[totalField]) < 0
		)
			errors.push(`${path}.${totalField} must be a non-negative integer`);
		if (rawSnapshot.categories === undefined) {
			errors.push(`${path}.categories must be an object`);
			continue;
		}
		if (!isRecord(rawSnapshot.categories)) {
			errors.push(`${path}.categories must be an object`);
			continue;
		}
		if (expected) {
			errors.push(
				...validateCategoryKeys(
					rawSnapshot.categories,
					expected,
					`${path}.categories`,
				),
			);
		}
		for (const [category, count] of Object.entries(rawSnapshot.categories)) {
			if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
				errors.push(
					`${path}.categories[${JSON.stringify(category)}] must be a non-negative integer`,
				);
		}
	}
	return errors;
}

/** Validate the structural shape of a file when no manifest was supplied. */
export function getDataShapeValidationErrors(
	value: unknown,
	kind: PublishedDataKind,
): string[] {
	if (kind === "manifest") return getManifestValidationErrors(value);
	if (kind === "enrichments") return validateEnrichmentsData(value);
	if (kind === "news-history-index")
		return validateHistoryIndexData(value, undefined, "news");
	if (kind === "case-history-index")
		return validateHistoryIndexData(value, undefined, "cases");
	if (!isRecord(value) || !isRecord(value.categories)) {
		return [`${kind}.categories must be an object`];
	}
	const type: CategoryType =
		kind === "problems"
			? "problems"
			: kind === "news" || kind === "news-history"
				? "news"
				: "cases";
	const categories = Object.fromEntries(
		Object.keys(value.categories).map((key) => [
			key,
			{
				label: key,
				type,
				source: { type: "external" },
			},
		]),
	);
	const shapeManifest = {
		version: MANIFEST_VERSION,
		categories,
	} as CategoryManifest;
	return type === "problems"
		? validateProblemsData(value, shapeManifest)
		: type === "news"
			? validateNewsData(value, shapeManifest)
			: validateCasesData(value, shapeManifest);
}

/** Return all errors for a published data file against a manifest. */
export function getDataValidationErrors(
	manifest: CategoryManifest,
	value: unknown,
	kind: PublishedDataKind,
): string[] {
	const manifestErrors = getManifestValidationErrors(manifest);
	if (manifestErrors.length)
		return manifestErrors.map((error) => `manifest: ${error}`);
	if (kind === "manifest") return getManifestValidationErrors(value);
	if (kind === "problems") return validateProblemsData(value, manifest);
	if (kind === "news" || kind === "news-history")
		return validateNewsData(value, manifest);
	if (kind === "news-history-index")
		return validateHistoryIndexData(value, manifest, "news");
	if (kind === "cases" || kind === "case-history")
		return validateCasesData(value, manifest);
	if (kind === "case-history-index")
		return validateHistoryIndexData(value, manifest, "cases");
	return validateEnrichmentsData(value);
}

/** Validate a published data file and throw a clear error on failure. */
export function validateDataForManifest(
	manifest: CategoryManifest,
	value: unknown,
	kind: PublishedDataKind,
): void {
	const errors = getDataValidationErrors(manifest, value, kind);
	if (errors.length) {
		throw new ManifestValidationError(
			`Invalid ${kind} data: ${errors.join("; ")}`,
			errors,
		);
	}
}

export const validatePublishedData = validateDataForManifest;

export function categoryEntries(manifest: CategoryManifest) {
	return Object.entries(manifest.categories);
}

export function categorySourceUrl(
	category: CategoryManifestEntry,
): string | null {
	const presentationUrl = category.presentation?.sourceUrl;
	if (presentationUrl) return presentationUrl;
	const configuredSourceUrl = category.source.sourceUrl;
	if (typeof configuredSourceUrl === "string" && isHttpUrl(configuredSourceUrl))
		return configuredSourceUrl;
	const sourceUrl = category.source.url;
	if (typeof sourceUrl === "string" && isHttpUrl(sourceUrl)) return sourceUrl;
	const page = category.presentation?.page ?? category.source.page;
	if (typeof page === "string" && page.trim()) {
		return `https://en.wikipedia.org/wiki/${page}`;
	}
	return null;
}

export function normalizedSourceType(
	source: SourceConfig,
): SourceType | string {
	return source.type ?? (source as SourceConfig & { kind?: string }).kind ?? "";
}
