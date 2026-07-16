import { expect, test } from "bun:test";
import { BunSqliteStateStore } from "./bun-sqlite-store";

test("BunSqliteStateStore persists independent named states", () => {
	const path = ":memory:";
	const clone = (state: { value: number }) => ({ ...state });
	const store = new BunSqliteStateStore(path, "queue", { value: 0 }, clone);

	expect(store.read()).toEqual({ value: 0 });
	store.write({ value: 42 });
	expect(store.read()).toEqual({ value: 42 });
	store.close();
});
