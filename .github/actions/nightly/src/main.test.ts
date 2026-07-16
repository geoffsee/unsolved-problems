import { describe, expect, test } from "bun:test";
import { hasCachedProblems, publishCachedProblems } from "./main";

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

	test("publishes a validated cached problems file to the configured API", async () => {
		const calls: Array<{ command: string; args: string[] }> = [];
		const execute = async (command: string, args: string[]) => {
			calls.push({ command, args });
			return 0;
		};

		await publishCachedProblems(
			"/workspace/apps/client",
			"/workspace/apps/client/public/data/manifest.json",
			"/workspace/apps/client/public/data/problems.json",
			execute,
		);

		expect(calls).toEqual([
			{
				command: "/workspace/apps/client/dist/publish-cli",
				args: [
					"--manifest",
					"/workspace/apps/client/public/data/manifest.json",
					"/workspace/apps/client/public/data/problems.json",
				],
			},
		]);
	});
});
