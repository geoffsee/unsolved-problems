import { describe, expect, test } from "bun:test";
import { hasCachedProblems } from "./main";

describe("nightly data cache", () => {
	test("detects an existing problems file", () => {
		expect(hasCachedProblems(import.meta.path)).toBe(true);
	});

	test("does not treat a missing file as cached", () => {
		expect(hasCachedProblems("/tmp/open-questions-missing-problems.json")).toBe(
			false,
		);
	});
});
