import { describe, expect, test } from "bun:test";
import { shouldRunScheduled } from "./main";

describe("morning contribution schedule", () => {
	test("runs during the 8:40–8:55 Eastern window", () => {
		expect(shouldRunScheduled(new Date("2026-07-16T12:45:00Z"))).toBe(true);
	});

	test("skips outside the scheduled window", () => {
		expect(shouldRunScheduled(new Date("2026-07-16T13:00:00Z"))).toBe(false);
	});
});
