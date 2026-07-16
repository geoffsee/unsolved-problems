import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

export function hasCachedProblems(path: string): boolean {
	return existsSync(path);
}

async function command(cwd: string, args: string[]) {
	const exitCode = await exec.exec("bun", args, { cwd });
	if (exitCode !== 0)
		throw new Error(`bun ${args.join(" ")} exited ${exitCode}`);
}

export async function run(): Promise<void> {
	try {
		const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
		const client = resolve(root, "apps/client");
		await command(client, ["install"]);
		await command(client, ["x", "playwright", "install", "chromium"]);

		if (hasCachedProblems(resolve(client, "public/data/problems.json"))) {
			core.info("Using cached problems.json");
		} else {
			await command(client, ["run", "fetch-data"]);
		}
		await command(client, ["run", "fetch-news"]);
		await command(client, ["run", "fetch-cases"]);
		try {
			await command(client, ["run", "enrich-data"]);
		} catch (error) {
			core.warning(`Problem enrichment failed: ${String(error)}`);
		}
		await command(client, ["run", "build"]);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}
