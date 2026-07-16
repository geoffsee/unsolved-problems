import { describe, expect, test } from "bun:test";
import { ALLOWED_MCP_TOOLS } from "./anthropic";
import { buildCatalogPrompt, buildUserBrief } from "./prompt";

describe("anthropic example", () => {
	test("exposes the expected MCP allowlist", () => {
		expect(ALLOWED_MCP_TOOLS).toContain("mcp__unsolved__list_problems");
		expect(ALLOWED_MCP_TOOLS).toContain("mcp__unsolved__pick_problem");
		expect(ALLOWED_MCP_TOOLS).toContain("mcp__unsolved__save_progress");
		expect(ALLOWED_MCP_TOOLS).toContain("mcp__code_sandbox__run_code");
		expect(ALLOWED_MCP_TOOLS).toContain("mcp__searxng");
		expect(ALLOWED_MCP_TOOLS).toContain("mcp__playwright");
	});

	test("catalog prompt matches the anthropic workflow contract", () => {
		const prompt = buildCatalogPrompt({
			agentId: "claude-agent-sdk-1",
			leaseMinutes: 60,
			pickMode: "random",
			userBrief: buildUserBrief({ goal: "claim one problem" }),
			variant: "anthropic",
		});

		expect(prompt).toContain("Pick mode: random.");
		expect(prompt).toContain(
			"Use only the unsolved MCP tools for catalog work.",
		);
		expect(prompt).toContain(
			"Call pick_problem with agentId=claude-agent-sdk-1",
		);
		expect(prompt).toContain("Desired outcome: claim one problem");
		expect(prompt).toContain("structuredContent.categories");
		expect(prompt).toContain("Choose one category uniformly at random");
		expect(prompt).not.toContain("Do not open a PR.");
	});

	test("specific pick path names the exact problem id", () => {
		const prompt = buildCatalogPrompt({
			agentId: "claude-agent-sdk-1",
			leaseMinutes: 30,
			pickMode: "specific",
			specificProblemId: "math-001",
			userBrief: "",
			variant: "anthropic",
		});
		expect(prompt).toContain("Claim exactly this problemId: math-001.");
		expect(prompt).toContain("leaseMinutes=30");
	});

	test("allowlist covers claim lifecycle tools used by the runner", () => {
		expect(ALLOWED_MCP_TOOLS).toEqual(
			expect.arrayContaining([
				"mcp__unsolved__list_problems",
				"mcp__unsolved__pick_problem",
				"mcp__unsolved__save_progress",
				"mcp__unsolved__list_claims",
				"mcp__code_sandbox__run_code",
			]),
		);
	});
});
