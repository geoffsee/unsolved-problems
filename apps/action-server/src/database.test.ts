import { afterEach, describe, expect, test } from "bun:test";
import { RunDatabase } from "./database";

const databases: RunDatabase[] = [];

afterEach(async () => {
	await Promise.all(
		databases.splice(0).map((database) => database.sql.close()),
	);
});

describe("RunDatabase", () => {
	test("claims a scheduled minute only once", async () => {
		const database = new RunDatabase("sqlite://:memory:");
		databases.push(database);
		await database.migrate();
		expect(
			await database.claimSchedule("nightly", "0 3 * * *", "2026-07-16T03:00"),
		).toBe(true);
		expect(
			await database.claimSchedule("nightly", "0 3 * * *", "2026-07-16T03:00"),
		).toBe(false);
	});
});
