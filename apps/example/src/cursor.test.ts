import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildMcpServers } from "./cursorMcp";
import { buildCatalogPrompt, buildUserBrief } from "./prompt";

describe("cursor example", () => {
	test("catalog prompt includes local-edit guardrails", () => {
		const prompt = buildCatalogPrompt({
			agentId: "cursor-agent-sdk-1",
			leaseMinutes: 60,
			pickMode: "specific",
			specificProblemId: "math-001",
			userBrief: buildUserBrief({ background: "geometry" }),
			variant: "cursor",
		});

		expect(prompt).toContain("Claim exactly this problemId: math-001.");
		expect(prompt).toContain(
			"Do not modify repository source files. Do not open a PR.",
		);
		expect(prompt).toContain("Background or strengths: geometry");
		expect(prompt).toContain("configured research tools");
	});

	test("loads research servers from the example .mcp.json", () => {
		const servers = buildMcpServers({
			mcpUrl: "https://example.test/mcp",
			cwd: join(import.meta.dir, ".."),
			env: {
				OPENALEX_MAILTO: "dev@example.com",
				OPENALEX_API_KEY: "key",
				SEARXNG_URL: "http://127.0.0.1:8080",
			},
		});

		expect(Object.keys(servers).sort()).toEqual([
			"code_sandbox",
			"crossref",
			"fetch",
			"openalex",
			"playwright",
			"searxng",
			"unsolved",
		]);
		expect(servers.unsolved.type).toBe("http");
		expect(servers.code_sandbox).toMatchObject({
			type: "stdio",
			command: "bun",
			args: ["run", "src/sandbox/mcpServer.ts"],
		});
		expect(servers.searxng).toMatchObject({
			type: "stdio",
			command: "bunx",
			env: { SEARXNG_URL: "http://127.0.0.1:8080" },
		});
	});

	test("random pick instructions match the category-shuffle contract", () => {
		const prompt = buildCatalogPrompt({
			agentId: "cursor-agent-sdk-1",
			leaseMinutes: 60,
			pickMode: "random",
			userBrief: "",
			variant: "cursor",
		});
		expect(prompt).toContain("Pick mode: random.");
		expect(prompt).toContain("structuredContent.categories");
		expect(prompt).toContain(
			"Do not bias toward the first item or toward astronomy.",
		);
		expect(prompt).toContain(
			"Do not modify repository source files. Do not open a PR.",
		);
	});
});
