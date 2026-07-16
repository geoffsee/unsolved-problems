import { Database } from "bun:sqlite";
import type { StateStore } from "./persistence";

/** Bun-native SQLite implementation for single-container deployments. */
export class BunSqliteStateStore<T> implements StateStore<T> {
	private readonly database: Database;

	constructor(
		path: string,
		private readonly key: string,
		private readonly initialState: T,
		private readonly clone: (state: T) => T,
	) {
		this.database = new Database(path, { create: true });
		this.database.exec(
			"CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
	}

	read(): T {
		const row = this.database
			.query<{ value: string }, [string]>(
				"SELECT value FROM app_state WHERE key = ?1",
			)
			.get(this.key);
		if (!row) return this.clone(this.initialState);
		return this.clone(JSON.parse(row.value) as T);
	}

	write(state: T): void {
		this.database
			.query(
				"INSERT INTO app_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			)
			.run(this.key, JSON.stringify(state));
	}

	close(): void {
		this.database.close();
	}
}
