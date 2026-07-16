import { describe, expect, test } from "bun:test";
import {
	getText,
	parseCandidateIds,
	pickRandomProblemId,
	ResearchCheckpointSchema,
	resolveChosenProblemId,
	SelectionSchema,
} from "./openaiHelpers";

describe("openai getText", () => {
	test("joins text blocks and ignores non-text items", () => {
		expect(
			getText([
				{ type: "text", text: "hello" },
				{ type: "image" },
				{ type: "text", text: "world" },
			]),
		).toBe("hello\nworld");
	});
});

describe("openai parseCandidateIds", () => {
	test("extracts available, claimed, and submitted ids", () => {
		const text = [
			"1. math-001 [available] Riemann hypothesis",
			"2. bio-002 [claimed] protein folding",
			"3. phys-003 [submitted] dark matter",
			"noise line",
			"4. bad [unknown] should skip",
		].join("\n");

		expect(parseCandidateIds(text)).toEqual([
			"math-001",
			"bio-002",
			"phys-003",
		]);
	});

	test("returns an empty list when nothing matches", () => {
		expect(parseCandidateIds("no problems here")).toEqual([]);
	});
});

describe("openai resolveChosenProblemId", () => {
	test("uses the explicit problem id in specific mode", () => {
		expect(
			resolveChosenProblemId({
				pickMode: "specific",
				specificProblemId: "math-001",
				candidateIds: ["other"],
			}),
		).toEqual({
			chosenProblemId: "math-001",
			reason: "Selected explicitly by the launcher.",
		});
	});

	test("rejects specific mode without an id", () => {
		expect(() =>
			resolveChosenProblemId({
				pickMode: "specific",
				specificProblemId: null,
				candidateIds: [],
			}),
		).toThrow("UNSOLVED_PROBLEM_ID is required");
	});

	test("picks randomly from candidates", () => {
		const candidates = ["a", "b", "c"];
		const chosen = resolveChosenProblemId({
			pickMode: "random",
			candidateIds: candidates,
		});
		expect(candidates).toContain(chosen.chosenProblemId);
		expect(chosen.reason).toContain("randomly");
	});

	test("rejects empty candidate lists for random mode", () => {
		expect(() =>
			resolveChosenProblemId({ pickMode: "random", candidateIds: [] }),
		).toThrow("did not return any available problem IDs");
	});

	test("requires the selector agent for other modes", () => {
		expect(() =>
			resolveChosenProblemId({
				pickMode: "agent",
				candidateIds: ["math-001"],
			}),
		).toThrow("OpenAI selector agent is required");
	});
});

describe("openai pickRandomProblemId", () => {
	test("throws when there are no candidates", () => {
		expect(() => pickRandomProblemId([])).toThrow(
			"did not return any available problem IDs",
		);
	});
});

describe("openai schemas", () => {
	test("accepts a valid selection", () => {
		expect(
			SelectionSchema.parse({
				problemId: "math-001",
				reason: "clear statement",
			}),
		).toEqual({
			problemId: "math-001",
			reason: "clear statement",
		});
	});

	test("accepts a research checkpoint with https source", () => {
		expect(
			ResearchCheckpointSchema.parse({
				kind: "reference",
				title: "Survey",
				content: "Useful review.",
				sourceUrl: "https://example.com/paper",
			}).sourceUrl,
		).toBe("https://example.com/paper");
	});

	test("rejects non-http source urls", () => {
		expect(() =>
			ResearchCheckpointSchema.parse({
				kind: "reference",
				title: "Survey",
				content: "Useful review.",
				sourceUrl: "ftp://example.com/paper",
			}),
		).toThrow();
	});

	test("allows a null source url", () => {
		expect(
			ResearchCheckpointSchema.parse({
				kind: "note",
				title: "No source",
				content: "No credible source found.",
				sourceUrl: null,
			}).kind,
		).toBe("note");
	});
});
