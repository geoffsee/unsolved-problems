import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Minimal state backend used by the Bun runtime and by tests. */
export interface StateStore<T> {
	read(): T;
	write(state: T): void;
}

export class MemoryStateStore<T> implements StateStore<T> {
	constructor(
		private state: T,
		private readonly clone: (state: T) => T,
	) {}

	read(): T {
		return this.clone(this.state);
	}

	write(state: T): void {
		this.state = this.clone(state);
	}
}

/**
 * Bun/Node persistence backend. Invalid or unavailable files safely fall back
 * to the last in-memory value so the API can continue serving requests.
 */
export class JsonFileStateStore<T> implements StateStore<T> {
	private readonly memory: MemoryStateStore<T>;

	constructor(
		private readonly path: string | null,
		initialState: T,
		private readonly clone: (state: T) => T,
	) {
		this.memory = new MemoryStateStore(initialState, clone);
	}

	read(): T {
		if (this.path && existsSync(this.path)) {
			try {
				const state = JSON.parse(readFileSync(this.path, "utf-8")) as T;
				this.memory.write(state);
				return this.clone(state);
			} catch {
				// Fall through to the most recent valid in-memory state.
			}
		}
		return this.memory.read();
	}

	write(state: T): void {
		this.memory.write(state);
		if (!this.path) return;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, JSON.stringify(state, null, 2));
		} catch {
			// The memory backend remains usable when the filesystem is read-only.
		}
	}
}
