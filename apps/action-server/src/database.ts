import { SQL } from "bun";

export interface RunRecord {
	id: string;
	workflow: string | null;
	action_path: string;
	trigger: string;
	status: string;
	exit_code: number | null;
	log: string;
	created_at: string;
	finished_at: string | null;
}

export class RunDatabase {
	readonly sql: SQL;

	constructor(url: string) {
		this.sql = new SQL(url);
	}

	async migrate() {
		await this.sql`
			CREATE TABLE IF NOT EXISTS action_runs (
				id TEXT PRIMARY KEY,
				workflow TEXT,
				action_path TEXT NOT NULL,
				trigger TEXT NOT NULL,
				status TEXT NOT NULL,
				exit_code INTEGER,
				log TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				finished_at TEXT
			)
		`;
		await this.sql`
			CREATE TABLE IF NOT EXISTS schedule_claims (
				workflow TEXT NOT NULL,
				cron TEXT NOT NULL,
				minute TEXT NOT NULL,
				PRIMARY KEY (workflow, cron, minute)
			)
		`;
	}

	async create(run: Omit<RunRecord, "exit_code" | "log" | "finished_at">) {
		await this.sql`
			INSERT INTO action_runs (id, workflow, action_path, trigger, status, created_at)
			VALUES (${run.id}, ${run.workflow}, ${run.action_path}, ${run.trigger}, ${run.status}, ${run.created_at})
		`;
	}

	async finish(id: string, exitCode: number, log: string) {
		await this.sql`
			UPDATE action_runs
			SET status = ${exitCode === 0 ? "succeeded" : "failed"},
				exit_code = ${exitCode}, log = ${log}, finished_at = ${new Date().toISOString()}
			WHERE id = ${id}
		`;
	}

	async get(id: string): Promise<RunRecord | null> {
		const rows = await this.sql<
			RunRecord[]
		>`SELECT * FROM action_runs WHERE id = ${id}`;
		return rows[0] ?? null;
	}

	async list(limit = 50): Promise<RunRecord[]> {
		return this.sql<RunRecord[]>`
			SELECT * FROM action_runs ORDER BY created_at DESC LIMIT ${limit}
		`;
	}

	async claimSchedule(workflow: string, cron: string, minute: string) {
		const rows = await this.sql`
			INSERT OR IGNORE INTO schedule_claims (workflow, cron, minute)
			VALUES (${workflow}, ${cron}, ${minute})
			RETURNING workflow
		`;
		return rows.length === 1;
	}
}
