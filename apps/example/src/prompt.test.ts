import { describe, expect, test } from "bun:test";
import {
	buildCatalogPrompt,
	buildPickInstructions,
	buildUserBrief,
} from "./prompt";

describe("buildUserBrief", () => {
	test("returns empty string when no fields are set", () => {
		expect(buildUserBrief({})).toBe("");
	});

	test("joins provided fields with labels", () => {
		expect(
			buildUserBrief({
				goal: "find a reference",
				background: "physics",
				constraints: "keep it short",
				context: "prefer reviews",
			}),
		).toBe(
			[
				"Desired outcome: find a reference",
				"Background or strengths: physics",
				"Constraints or preferences: keep it short",
				"Extra context: prefer reviews",
			].join("\n"),
		);
	});
});

describe("buildPickInstructions", () => {
	test("requires a problem id for specific mode", () => {
		expect(() =>
			buildPickInstructions({ pickMode: "specific", specificProblemId: null }),
		).toThrow("UNSOLVED_PROBLEM_ID is required");
	});

	test("names the exact problem in specific mode", () => {
		const text = buildPickInstructions({
			pickMode: "specific",
			specificProblemId: "math-001",
		});
		expect(text).toContain("Pick mode: specific.");
		expect(text).toContain("Claim exactly this problemId: math-001.");
	});

	test("asks for a uniform random choice", () => {
		const text = buildPickInstructions({ pickMode: "random" });
		expect(text).toContain("Pick mode: random.");
		expect(text).toContain("structuredContent.categories");
		expect(text).toContain("Choose one category uniformly at random");
		expect(text).toContain("limit=25");
		expect(text).toContain("uniformly at random");
	});

	test("defaults to agent selection guidance", () => {
		const text = buildPickInstructions({ pickMode: "agent" });
		expect(text).toContain("Pick mode: agent.");
		expect(text).toContain("limit=5");
	});
});

describe("buildCatalogPrompt", () => {
	const base = {
		agentId: "agent-1",
		leaseMinutes: 60,
		pickMode: "agent" as const,
		userBrief: "Desired outcome: useful note",
	};

	test("builds the anthropic catalog workflow", () => {
		const prompt = buildCatalogPrompt({ ...base, variant: "anthropic" });
		expect(prompt).toContain("You are agent agent-1");
		expect(prompt).toContain(
			"Use only the unsolved MCP tools for catalog work.",
		);
		expect(prompt).toContain("leaseMinutes=60");
		expect(prompt).toContain("User brief:\nDesired outcome: useful note");
		expect(prompt).toContain("code_sandbox run_code tool");
		expect(prompt).toContain("call run_code in the sandbox");
		expect(prompt).not.toContain("Do not open a PR.");
	});

	test("builds the cursor catalog workflow with local-edit guardrails", () => {
		const prompt = buildCatalogPrompt({ ...base, variant: "cursor" });
		expect(prompt).toContain("Use the unsolved MCP tools for catalog work.");
		expect(prompt).toContain(
			"Do not modify repository source files. Do not open a PR.",
		);
		expect(prompt).toContain("configured research tools");
		expect(prompt).toContain("code_sandbox MCP run_code tool");
		expect(prompt).toContain("whether sandbox code was run");
		expect(prompt).toContain("save_progress succeeded");
	});

	test("includes specific pick instructions when requested", () => {
		const prompt = buildCatalogPrompt({
			...base,
			pickMode: "specific",
			specificProblemId: "bio-42",
			variant: "anthropic",
			userBrief: "",
		});
		expect(prompt).toContain("Claim exactly this problemId: bio-42.");
		expect(prompt).toContain("User brief: none supplied.");
	});

	test("embeds random category-shuffle guidance for anthropic", () => {
		const prompt = buildCatalogPrompt({
			...base,
			pickMode: "random",
			variant: "anthropic",
		});
		expect(prompt).toContain("structuredContent.categories");
		expect(prompt).toContain("Choose one category uniformly at random");
		expect(prompt).toContain(
			"Do not bias toward the first item or toward astronomy.",
		);
		expect(prompt).toContain("Call pick_problem with agentId=agent-1");
		expect(prompt).toContain("save_progress exactly once");
		expect(prompt).toContain("Do not call submit_solution or release_problem.");
		expect(prompt).toContain("if you ran sandbox code");
	});
});
