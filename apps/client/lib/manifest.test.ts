import { describe, expect, test } from "bun:test";
import {
	getDataValidationErrors,
	getManifestValidationErrors,
	parseManifestJson,
	validateDataForManifest,
	validateManifest,
} from "./manifest";

const problemManifest = {
	version: 1,
	categories: {
		geometry: {
			label: "Geometry",
			type: "problems",
			source: { type: "wikipedia", page: "List_of_geometry_problems" },
		},
	},
};

describe("catalog manifest validation", () => {
	test("accepts a versioned manifest with a supported source", () => {
		expect(validateManifest(problemManifest).categories.geometry.label).toBe(
			"Geometry",
		);
	});

	test("rejects unsupported source and category types", () => {
		const errors = getManifestValidationErrors({
			version: 1,
			categories: {
				geometry: {
					label: "Geometry",
					type: "other",
					source: { type: "unknown" },
				},
			},
		});
		expect(errors.join(" ")).toContain("unsupported");
		expect(errors.join(" ")).toContain("problems, news, or cases");
	});

	test("detects duplicate JSON keys before JSON.parse loses them", () => {
		expect(() =>
			parseManifestJson(
				'{"version":1,"categories":{"a":{"label":"A","type":"problems","source":{"type":"external"}},"a":{"label":"B","type":"problems","source":{"type":"external"}}}}',
			),
		).toThrow(/duplicate object keys/);
	});

	test("rejects missing, extra, and malformed categories", () => {
		const errors = getDataValidationErrors(
			validateManifest({
				version: 1,
				categories: {
					geometry: problemManifest.categories.geometry,
				},
			}),
			{
				categories: {
					other: [{ heading: "General", problems: ["A question"] }],
				},
			},
			"problems",
		);
		expect(
			errors.some((error) => error.includes('extra category "other"')),
		).toBe(true);
		expect(
			errors.some((error) => error.includes('missing category "geometry"')),
		).toBe(true);
	});

	test("validates a keyed news feed against its category type", () => {
		const manifest = validateManifest({
			version: 1,
			categories: {
				news: {
					label: "News",
					type: "news",
					source: { type: "external" },
				},
			},
		});
		const data = {
			categories: {
				news: {
					articles: [
						{
							title: "A result",
							seendate: "2026-01-01T00:00:00Z",
							sources: [
								{ domain: "example.test", url: "https://example.test" },
							],
						},
					],
				},
			},
		};
		expect(() => validateDataForManifest(manifest, data, "news")).not.toThrow();
	});

	test("validates keyed news history snapshots and their index separately", () => {
		const manifest = validateManifest({
			version: 1,
			categories: {
				news: {
					label: "News",
					type: "news",
					source: { type: "external" },
				},
			},
		});
		const index = {
			updatedAt: "2026-01-02T00:00:00Z",
			snapshots: [
				{
					date: "2026-01-01",
					fetchedAt: "2026-01-01T00:00:00Z",
					totalArticles: 1,
					categories: { news: 1 },
					path: "news-history/2026-01-01.json",
				},
			],
		};
		expect(() =>
			validateDataForManifest(manifest, index, "news-history-index"),
		).not.toThrow();
		expect(
			getDataValidationErrors(
				manifest,
				{ ...index, snapshots: [{ ...index.snapshots[0], categories: {} }] },
				"news-history-index",
			),
		).toContain(
			'history index.snapshots[0].categories is missing category "news"',
		);
	});
});
