import { resolve } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

const DAYLIGHT_SCHEDULE = "45 12 * * *";
const STANDARD_SCHEDULE = "45 13 * * *";

export function easternTime(date = new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
		hour12: false,
	}).formatToParts(date);
	const timeZoneName = parts.find(
		(part) => part.type === "timeZoneName",
	)?.value;
	return {
		hour: Number(parts.find((part) => part.type === "hour")?.value),
		minute: Number(parts.find((part) => part.type === "minute")?.value),
		isDaylightSavingTime: timeZoneName === "EDT",
	};
}

export function shouldRunScheduled(
	date = new Date(),
	scheduledCron?: string,
): boolean {
	const time = easternTime(date);
	if (scheduledCron === DAYLIGHT_SCHEDULE) {
		return time.isDaylightSavingTime;
	}
	if (scheduledCron === STANDARD_SCHEDULE) {
		return !time.isDaylightSavingTime;
	}

	// Keep the old behavior for callers that do not provide the triggering
	// cron. Scheduled GitHub runs pass the cron so delayed starts are accepted.
	return time.hour === 8 && time.minute >= 40 && time.minute <= 55;
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
		const scheduledCron = core.getInput("scheduled-cron");
		if (
			process.env.GITHUB_EVENT_NAME === "schedule" &&
			!shouldRunScheduled(new Date(), scheduledCron)
		) {
			const time = easternTime();
			if (scheduledCron) {
				const activeSchedule = time.isDaylightSavingTime
					? DAYLIGHT_SCHEDULE
					: STANDARD_SCHEDULE;
				core.info(
					`Skipping: ${scheduledCron} is not the active Eastern schedule (${activeSchedule}).`,
				);
			} else {
				core.info(
					`Skipping: Eastern time is ${time.hour}:${String(time.minute).padStart(2, "0")} (want ~08:45).`,
				);
			}
			return;
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
