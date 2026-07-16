import { describe, expect, test } from "bun:test";
import { hasCachedProblems } from "./main";

describe("nightly data cache", () => {
	test("detects an existing problems file", () => {
		expect(
			hasCachedProblems(new URL("./main.ts", import.meta.url).pathname),
		).toBe(true);
	});

	test("does not treat a missing file as cached", () => {
		expect(hasCachedProblems("/tmp/open-questions-missing-problems.json")).toBe(
			false,
		);
	});

	test("does not reuse a cached file for a malformed or mismatched manifest", () => {
		const problemsPath = new URL("./main.ts", import.meta.url).pathname;
		expect(hasCachedProblems(problemsPath, problemsPath)).toBe(false);
	});
});
