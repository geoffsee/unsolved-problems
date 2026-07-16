import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app, { resetLocalRuntimeStateForTests } from "./main";

const MANIFEST = {
	version: 1,
	categories: {
		geometry: {
			label: "Geometry",
			type: "problems",
			source: { type: "external" },
		},
	},
};

const PROBLEMS = {
	categories: {
		geometry: [
			{ heading: "General", problems: ["Is every shape triangulable?"] },
		],
	},
};

let tempDir: string;
let previousDataDir: string | undefined;
let previousPublishKey: string | undefined;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "open-questions-manifest-"));
	previousDataDir = process.env.PUBLISH_DATA_DIR;
	previousPublishKey = process.env.PUBLISH_KEY;
	process.env.PUBLISH_DATA_DIR = tempDir;
	process.env.PUBLISH_KEY = "test-publish-key";
	resetLocalRuntimeStateForTests();
});

afterEach(() => {
	if (previousDataDir === undefined) delete process.env.PUBLISH_DATA_DIR;
	else process.env.PUBLISH_DATA_DIR = previousDataDir;
	if (previousPublishKey === undefined) delete process.env.PUBLISH_KEY;
	else process.env.PUBLISH_KEY = previousPublishKey;
	resetLocalRuntimeStateForTests();
	rmSync(tempDir, { recursive: true, force: true });
});

async function publish(path: string, data: unknown) {
	return app.fetch(
		new Request("http://localhost/publish", {
			method: "POST",
			headers: {
				authorization: "Bearer test-publish-key",
				"content-type": "application/json",
			},
			body: JSON.stringify({ path, data }),
		}),
	);
}

describe("published manifest and data routes", () => {
	test("publishes and serves a manifest-driven data file", async () => {
		expect((await publish("/data/manifest.json", MANIFEST)).status).toBe(200);
		expect((await publish("/data/problems.json", PROBLEMS)).status).toBe(200);

		const response = await app.fetch(
			new Request("http://localhost/data/problems.json"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(PROBLEMS);
	});

	test("rejects missing and extra categories at publish time", async () => {
		expect((await publish("/data/manifest.json", MANIFEST)).status).toBe(200);
		const response = await publish("/data/problems.json", {
			categories: {
				other: [{ heading: "General", problems: ["Not in the catalog"] }],
			},
		});
		expect(response.status).toBe(400);
		const message = (await response.json()) as { error: string };
		expect(message.error).toContain('missing category "geometry"');
		expect(message.error).toContain('extra category "other"');
	});
});
