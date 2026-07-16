import { describe, expect, test } from "bun:test";
import {
	extractProblemIdsFromListResult,
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

	test("resolves random mode to a concrete problem id", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					result: {
						structuredContent: {
							items: [
								{ id: "math-001" },
								{ id: "bio-002" },
								{ id: "phys-003" },
							],
						},
					},
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;

		try {
			const resolved = await resolveRuntimePick({
				pickMode: "random",
				mcpUrl: "https://example.test/mcp",
			});
			expect(resolved.pickMode).toBe("specific");
			expect(resolved.poolSize).toBe(3);
			expect(resolved.specificProblemId).not.toBeNull();
			expect(["math-001", "bio-002", "phys-003"]).toContain(
				resolved.specificProblemId as string,
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
