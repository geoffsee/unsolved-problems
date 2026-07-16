import { describe, expect, test } from "bun:test";
import { actionEnvironment } from "./runner";
import { cronMatches, readWorkflow } from "./workflows";

describe("cronMatches", () => {
	test("matches GitHub's five-field UTC schedules", () => {
		const date = new Date("2026-07-16T03:00:00Z");
		expect(cronMatches("0 3 * * *", date)).toBe(true);
		expect(cronMatches("45 12,13 * * *", date)).toBe(false);
	});

	test("supports ranges and steps", () => {
		const date = new Date("2026-07-16T12:30:00Z");
		expect(cronMatches("*/15 9-17 * * 1-5", date)).toBe(true);
	});
});

test("reads workflow schedules and steps", async () => {
	const workflow = await readWorkflow(
		new URL("../../../.github/workflows/nightly.yml", import.meta.url).pathname,
	);
	expect(workflow.id).toBe("nightly");
	expect(workflow.crons).toEqual(["0 3 * * *"]);
	expect(workflow.jobs.build?.steps.length).toBeGreaterThan(0);
});

test("maps workflow secrets and inputs into local-action environment names", () => {
	const environment = actionEnvironment(
		"/repo",
		{
			id: "action",
			name: "action",
			env: { TOKEN: `\${{ secrets.TOKEN }}` },
			with: { "api-key": `\${{ secrets.API_KEY }}` },
		},
		{ TOKEN: "token-value", API_KEY: "key-value" },
	);
	expect(environment.TOKEN).toBe("token-value");
	expect(environment["INPUT_API-KEY"]).toBe("key-value");
});
