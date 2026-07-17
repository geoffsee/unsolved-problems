import { describe, expect, test } from "bun:test";
import { shouldRunScheduled } from "./main";

describe("morning contribution schedule", () => {
	test("accepts a delayed daylight-saving run from the EDT cron", () => {
		expect(
			shouldRunScheduled(new Date("2026-07-17T13:12:00Z"), "45 12 * * *"),
		).toBe(true);
	});

	test("skips the standard-time cron during daylight saving time", () => {
		expect(
			shouldRunScheduled(new Date("2026-07-17T14:16:00Z"), "45 13 * * *"),
		).toBe(false);
	});

	test("accepts a delayed standard-time run from the EST cron", () => {
		expect(
			shouldRunScheduled(new Date("2026-01-16T14:12:00Z"), "45 13 * * *"),
		).toBe(true);
	});

	test("skips the daylight-saving cron during standard time", () => {
		expect(
			shouldRunScheduled(new Date("2026-01-16T13:12:00Z"), "45 12 * * *"),
		).toBe(false);
	});
});
