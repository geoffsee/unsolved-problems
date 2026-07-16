import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMatchingProblemCategories(
	manifest: unknown,
	data: unknown,
): boolean {
	if (!isRecord(manifest) || manifest.version !== 1) return false;
	if (!isRecord(manifest.categories) || !isRecord(data)) return false;
	if (!isRecord(data.categories)) return false;

	const expected = Object.entries(manifest.categories)
		.filter(
			([, category]) => isRecord(category) && category.type === "problems",
		)
		.map(([category]) => category)
		.sort();
	const actual = Object.keys(data.categories).sort();
	if (
		expected.length !== actual.length ||
		expected.some((category, index) => category !== actual[index])
	) {
		return false;
	}

	return Object.values(data.categories).every(
		(sections) =>
			Array.isArray(sections) &&
			sections.every(
				(section) =>
					isRecord(section) &&
					typeof section.heading === "string" &&
					Array.isArray(section.problems) &&
					section.problems.every((problem) => typeof problem === "string"),
			),
	);
}

export function hasCachedProblems(
	path: string,
	manifestPath?: string,
): boolean {
	if (!existsSync(path)) return false;
	if (!manifestPath) return true;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
		const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return hasMatchingProblemCategories(manifest, data);
	} catch {
		return false;
	}
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
		const configuredManifest =
			process.env.PUBLISH_MANIFEST ||
			process.env.OPEN_QUESTIONS_MANIFEST ||
			process.env.CATALOG_MANIFEST;
		const manifestPath = configuredManifest
			? isAbsolute(configuredManifest)
				? configuredManifest
				: resolve(client, configuredManifest)
			: resolve(client, "public/data/manifest.json");
		await command(client, ["install"]);
		await command(client, ["x", "playwright", "install", "chromium"]);

		if (
			hasCachedProblems(
				resolve(client, "public/data/problems.json"),
				manifestPath,
			)
		) {
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
