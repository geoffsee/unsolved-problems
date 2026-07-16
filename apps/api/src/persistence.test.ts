import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileStateStore, MemoryStateStore } from "./persistence";

type State = { count: number };
const clone = (state: State): State => ({ ...state });
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("StateStore", () => {
	test("memory stores isolate state from caller mutations", () => {
		const store = new MemoryStateStore({ count: 1 }, clone);
		const state = store.read();
		state.count = 9;
		expect(store.read()).toEqual({ count: 1 });
	});

	test("JSON file stores survive a new Bun store instance", () => {
		const dir = mkdtempSync(join(tmpdir(), "open-questions-store-"));
		dirs.push(dir);
		const path = join(dir, "nested", "state.json");

		new JsonFileStateStore(path, { count: 0 }, clone).write({ count: 7 });
		const reopened = new JsonFileStateStore(path, { count: 0 }, clone);

		expect(reopened.read()).toEqual({ count: 7 });
	});

	test("JSON file stores fall back when persisted data is invalid", () => {
		const store = new JsonFileStateStore<State>(null, { count: 3 }, clone);
		expect(store.read()).toEqual({ count: 3 });
	});
});
