import { describe, expect, test } from "bun:test";
import {
	extractCategoriesFromCatalog,
	extractCategoriesFromListResult,
	extractProblemIdsFromListResult,
	pickRandomCategory,
	resolveRuntimePick,
} from "./resolvePick";

describe("extractProblemIdsFromListResult", () => {
	test("reads structuredContent items", () => {
		expect(
			extractProblemIdsFromListResult({
				result: {
					structuredContent: {
						items: [{ id: "math-001" }, { id: " bio-002 " }],
					},
				},
			}),
		).toEqual(["math-001", "bio-002"]);
	});

	test("falls back to numbered text content", () => {
		expect(
			extractProblemIdsFromListResult({
				result: {
					content: [
						{
							type: "text",
							text: [
								"1. math-001 [available] math / Number theory: foo",
								"2. bio-002 [available] biology / Bar: baz",
							].join("\n"),
						},
					],
				},
			}),
		).toEqual(["math-001", "bio-002"]);
	});
});

describe("extractCategoriesFromListResult", () => {
	test("reads structuredContent categories with positive counts", () => {
		expect(
			extractCategoriesFromListResult({
				result: {
					structuredContent: {
						categories: {
							biology: 4,
							astronomy: 96,
							chemistry: 0,
						},
					},
				},
			}),
		).toEqual(["astronomy", "biology"]);
	});

	test("falls back to item categories", () => {
		expect(
			extractCategoriesFromListResult({
				result: {
					structuredContent: {
						items: [
							{ id: "a-1", category: "astronomy" },
							{ id: "b-1", category: "biology" },
							{ id: "a-2", category: "astronomy" },
						],
					},
				},
			}),
		).toEqual(["astronomy", "biology"]);
	});
});

describe("extractCategoriesFromCatalog", () => {
	test("reads catalog category counts", () => {
		expect(
			extractCategoriesFromCatalog({
				result: {
					contents: [
						{
							text: JSON.stringify({
								categories: {
									astronomy: 113,
									biology: 40,
									mathematics: 0,
								},
							}),
						},
					],
				},
			}),
		).toEqual(["astronomy", "biology"]);
	});
});

describe("pickRandomCategory", () => {
	test("rejects empty lists", () => {
		expect(() => pickRandomCategory([])).toThrow(
			"No available problem categories were returned.",
		);
	});

	test("returns a member of the list", () => {
		expect(["astronomy", "biology"]).toContain(
			pickRandomCategory(["astronomy", "biology"]),
		);
	});
});

describe("resolveRuntimePick", () => {
	test("keeps specific picks", async () => {
		await expect(
			resolveRuntimePick({
				pickMode: "specific",
				specificProblemId: "math-001",
				mcpUrl: "https://example.test/mcp",
			}),
		).resolves.toEqual({
			pickMode: "specific",
			specificProblemId: "math-001",
		});
	});

	test("leaves agent mode to the model", async () => {
		await expect(
			resolveRuntimePick({
				pickMode: "agent",
				mcpUrl: "https://example.test/mcp",
			}),
		).resolves.toEqual({
			pickMode: "agent",
			specificProblemId: null,
		});
	});

	test("resolves random mode via shuffled category then problem", async () => {
		const originalFetch = globalThis.fetch;
		const calls: Array<{ method?: string; args?: Record<string, unknown> }> =
			[];

		globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				method?: string;
				params?: {
					name?: string;
					arguments?: Record<string, unknown>;
					uri?: string;
				};
			};
			calls.push({
				method: body.method,
				args: body.params?.arguments,
			});

			if (body.method === "resources/read") {
				return new Response(
					JSON.stringify({
						result: {
							contents: [
								{
									text: JSON.stringify({
										categories: {
											astronomy: 96,
											biology: 4,
											chemistry: 12,
										},
									}),
								},
							],
						},
					}),
					{ status: 200 },
				);
			}

			const args = body.params?.arguments ?? {};
			if (!args.category) {
				return new Response(
					JSON.stringify({
						result: {
							structuredContent: {
								items: [{ id: "astronomy-1", category: "astronomy" }],
								categories: {
									astronomy: 96,
									biology: 4,
									chemistry: 12,
								},
								totalMatched: 112,
							},
						},
					}),
					{ status: 200 },
				);
			}

			const category = String(args.category);
			return new Response(
				JSON.stringify({
					result: {
						structuredContent: {
							items: [
								{ id: `${category}-001`, category },
								{ id: `${category}-002`, category },
							],
							categories: { [category]: 2 },
							totalMatched: 2,
						},
					},
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		try {
			const resolved = await resolveRuntimePick({
				pickMode: "random",
				mcpUrl: "https://example.test/mcp",
			});
			expect(resolved.pickMode).toBe("specific");
			expect(resolved.poolSize).toBe(2);
			expect(resolved.category).toBeTruthy();
			expect(["astronomy", "biology", "chemistry"]).toContain(
				resolved.category as string,
			);
			expect([
				`${resolved.category}-001`,
				`${resolved.category}-002`,
			]).toContain(resolved.specificProblemId as string);
			expect(calls[0]?.method).toBe("tools/call");
			expect(calls[0]?.args?.category).toBeUndefined();
			expect(calls[1]?.args?.category).toBe(resolved.category);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("falls back to catalog categories when list omits them", async () => {
		const originalFetch = globalThis.fetch;

		globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				method?: string;
				params?: { arguments?: Record<string, unknown> };
			};

			if (body.method === "resources/read") {
				return new Response(
					JSON.stringify({
						result: {
							contents: [
								{
									text: JSON.stringify({
										categories: { biology: 4, chemistry: 12 },
									}),
								},
							],
						},
					}),
					{ status: 200 },
				);
			}

			const args = body.params?.arguments ?? {};
			if (!args.category) {
				return new Response(
					JSON.stringify({
						result: {
							structuredContent: {
								items: [{ id: "astronomy-1" }],
								totalMatched: 1,
							},
						},
					}),
					{ status: 200 },
				);
			}

			const category = String(args.category);
			return new Response(
				JSON.stringify({
					result: {
						structuredContent: {
							items: [{ id: `${category}-001`, category }],
							totalMatched: 1,
						},
					},
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		try {
			const resolved = await resolveRuntimePick({
				pickMode: "random",
				mcpUrl: "https://example.test/mcp",
			});
			expect(["biology", "chemistry"]).toContain(resolved.category as string);
			expect(resolved.specificProblemId).toBe(`${resolved.category}-001`);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
