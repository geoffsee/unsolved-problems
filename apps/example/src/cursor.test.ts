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
			"crossref",
			"fetch",
			"openalex",
			"playwright",
			"searxng",
			"unsolved",
		]);
		expect(servers.unsolved.type).toBe("http");
		expect(servers.searxng).toMatchObject({
			type: "stdio",
			command: "bunx",
			env: { SEARXNG_URL: "http://127.0.0.1:8080" },
		});
	});
});
