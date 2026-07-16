import { describe, expect, test } from "bun:test";
import {
	parseCandidateIds,
	ResearchCheckpointSchema,
	resolveChosenProblemId,
} from "./openaiHelpers";
import { buildUserBrief } from "./prompt";

describe("openai example", () => {
	test("parses MCP shortlist text the launcher expects", () => {
		expect(
			parseCandidateIds(
				[
					"1. math-001 [available] open problem A",
					"2. bio-002 [available] open problem B",
				].join("\n"),
			),
		).toEqual(["math-001", "bio-002"]);
	});

	test("supports specific and random pick modes without calling the model", () => {
		expect(
			resolveChosenProblemId({
				pickMode: "specific",
				specificProblemId: "math-001",
				candidateIds: [],
			}).chosenProblemId,
		).toBe("math-001");

		const random = resolveChosenProblemId({
			pickMode: "random",
			candidateIds: ["math-001", "bio-002"],
		});
		expect(["math-001", "bio-002"]).toContain(random.chosenProblemId);
	});

	test("validates research checkpoints used by the kickoff agent", () => {
		const checkpoint = ResearchCheckpointSchema.parse({
			kind: "hypothesis",
			title: "Working guess",
			content: "Claim, support, limitation, next test.",
			sourceUrl: null,
		});
		expect(checkpoint.kind).toBe("hypothesis");
	});

	test("builds the same user brief shape as the other examples", () => {
		expect(buildUserBrief({ goal: "start research" })).toBe(
			"Desired outcome: start research",
		);
	});
});
