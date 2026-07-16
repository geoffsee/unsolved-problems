import { resolve } from "node:path";
import { createApp, readConfig } from "./app";
import { RunDatabase } from "./database";
import { cronMatches, discoverWorkflows } from "./workflows";

const root = resolve(
	process.env.REPOSITORY_ROOT ?? resolve(import.meta.dir, "../../.."),
);
const port = Number.parseInt(process.env.PORT ?? "3030", 10);
const databaseUrl = process.env.DATABASE_URL ?? "sqlite://local-action.sqlite";
const database = new RunDatabase(databaseUrl);
await database.migrate();
const config = await readConfig(root);
const { app, runWorkflow } = createApp({
	root,
	database,
	config,
	token: process.env.API_TOKEN,
});

function scheduledEnvironment(
	workflow: Awaited<ReturnType<typeof discoverWorkflows>>[number],
) {
	const names = new Set<string>();
	for (const job of Object.values(workflow.jobs)) {
		for (const step of job.steps) {
			for (const value of [
				...Object.values(step.env ?? {}),
				...Object.values(step.with ?? {}),
			]) {
				if (typeof value !== "string") continue;
				const match = value.match(
					/^\$\{\{\s*(?:secrets|env)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/,
				);
				if (match?.[1]) names.add(match[1]);
			}
		}
	}
	return Object.fromEntries(
		[...names]
			.map((name) => [name, process.env[name]])
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

async function runDueSchedules(date = new Date()) {
	const minute = date.toISOString().slice(0, 16);
	for (const workflow of await discoverWorkflows(root)) {
		for (const cron of workflow.crons) {
			if (!cronMatches(cron, date)) continue;
			if (!(await database.claimSchedule(workflow.id, cron, minute))) continue;
			await runWorkflow(
				workflow,
				{ env: scheduledEnvironment(workflow) },
				"schedule",
			);
		}
	}
}

await runDueSchedules();
const scheduleTimer = setInterval(() => {
	void runDueSchedules().catch((error) =>
		console.error("Scheduler failed", error),
	);
}, 15_000);

const server = Bun.serve({ port, fetch: app.fetch });
console.log(`Local action server listening on ${server.url}`);

function shutdown() {
	clearInterval(scheduleTimer);
	server.stop();
	void database.sql.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
