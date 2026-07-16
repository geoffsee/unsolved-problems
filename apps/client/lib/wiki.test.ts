import { afterEach, describe, expect, test } from "bun:test";
import { parseManifestJson } from "./manifest";
import { getEnrichment, setEnrichments } from "./wiki";

afterEach(() => {
	setEnrichments({});
});

describe("enrichment store", () => {
	test("keys enrichments by the first 120 chars of problem text", () => {
		const text = `Problem ${"x".repeat(200)}`;
		setEnrichments({
			[text.slice(0, 120)]: {
				summary: "Short summary",
				significance: "Why it matters",
				field: "biology",
			},
		});

		expect(getEnrichment(text)).toEqual({
			summary: "Short summary",
			significance: "Why it matters",
			field: "biology",
		});
		expect(getEnrichment("unrelated problem")).toBeNull();
	});

	test("returns null when store is empty", () => {
		expect(getEnrichment("anything")).toBeNull();
	});
});

describe("published manifest", () => {
	test("contains the current problem, news, and case catalog", async () => {
		const manifest = parseManifestJson(
			await Bun.file(
				new URL("../public/data/manifest.json", import.meta.url),
			).text(),
		);
		expect(manifest.categories.mathematics?.type).toBe("problems");
		expect(manifest.categories["frontier research"]?.type).toBe("news");
		expect(manifest.categories["missing persons"]?.type).toBe("cases");
		expect(manifest.categories.physics?.presentation?.emoji).toBeTruthy();
	});
});
