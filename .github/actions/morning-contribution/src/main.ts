import { resolve } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

export function easternTime() {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(new Date());
	return {
		hour: Number(parts.find((part) => part.type === "hour")?.value),
		minute: Number(parts.find((part) => part.type === "minute")?.value),
	};
}

export function shouldRunScheduled(date = new Date()): boolean {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(date);
	const hour = Number(parts.find((part) => part.type === "hour")?.value);
	const minute = Number(parts.find((part) => part.type === "minute")?.value);
	return hour === 8 && minute >= 40 && minute <= 55;
}

function environment(): Record<string, string> {
	const values: Record<string, string | undefined> = {
		...process.env,
		ANTHROPIC_API_KEY: core.getInput("anthropic-api-key", { required: true }),
		OPEN_QUESTIONS_API_TOKEN: core.getInput("api-token", { required: true }),
		OPEN_QUESTIONS_MCP_URL:
			"https://unsolved-problems-api.seemueller.workers.dev/mcp",
		OPEN_QUESTIONS_AGENT_ID: "github-actions-morning",
		OPEN_QUESTIONS_PICK_MODE: "random",
		ANTHROPIC_MODEL: "claude-sonnet-4-5",
		OPENALEX_MAILTO: core.getInput("openalex-mailto"),
		OPENALEX_API_KEY: core.getInput("openalex-api-key"),
		SEARXNG_URL: core.getInput("searxng-url"),
	};
	return Object.fromEntries(
		Object.entries(values).filter((entry): entry is [string, string] =>
			Boolean(entry[1]),
		),
	);
}

async function command(command: string, args: string[], cwd: string) {
	const exitCode = await exec.exec(command, args, { cwd, env: environment() });
	if (exitCode !== 0) throw new Error(`${command} exited ${exitCode}`);
}

export async function run(): Promise<void> {
	try {
		if (process.env.GITHUB_EVENT_NAME === "schedule" && !shouldRunScheduled()) {
			const time = easternTime();
			if (time.hour !== 8 || time.minute < 40 || time.minute > 55) {
				core.info(
					`Skipping: Eastern time is ${time.hour}:${String(time.minute).padStart(2, "0")} (want ~08:45).`,
				);
				return;
			}
		}
		const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
		const contributor = resolve(root, "apps/example");
		await command("bun", ["install"], contributor);
		await command(
			"bunx",
			["playwright", "install", "--with-deps", "chromium"],
			contributor,
		);
		await command("bun", ["run", "start:anthropic"], contributor);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}
