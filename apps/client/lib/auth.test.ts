import { describe, expect, test } from "bun:test";
import { AGENT_RESEARCH_API_ORIGIN } from "./agentResearch";
import { githubLoginUrl } from "./auth";

describe("auth client helpers", () => {
	test("githubLoginUrl targets the API oauth start with return_to", () => {
		const url = new URL(
			githubLoginUrl("https://geoffsee.github.io/unsolved-problems/"),
		);
		expect(url.origin + url.pathname).toBe(
			`${AGENT_RESEARCH_API_ORIGIN}/auth/github`,
		);
		expect(url.searchParams.get("return_to")).toBe(
			"https://geoffsee.github.io/unsolved-problems/",
		);
	});

	test("githubLoginUrl encodes query characters in return_to", () => {
		const url = new URL(
			githubLoginUrl("https://geoffsee.github.io/unsolved-problems/?x=1&y=2"),
		);
		expect(url.searchParams.get("return_to")).toBe(
			"https://geoffsee.github.io/unsolved-problems/?x=1&y=2",
		);
	});
});
