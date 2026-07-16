import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ActionOptions, WorkflowStep } from "./types";

export interface ActionInvocation extends ActionOptions {
	actionPath: string;
	env?: Record<string, string>;
	inputs?: Record<string, unknown>;
}

function within(root: string, path: string) {
	const value = relative(root, path);
	return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function dotenvValue(value: unknown) {
	return JSON.stringify(String(value ?? ""));
}

function workflowValue(value: unknown, extra: Record<string, string>) {
	if (typeof value !== "string") return String(value ?? "");
	const expression = value.match(
		/^\$\{\{\s*(?:secrets|env)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/,
	);
	return expression ? (extra[expression[1] as string] ?? "") : value;
}

export function actionEnvironment(
	root: string,
	step: WorkflowStep | undefined,
	extra: Record<string, string> = {},
) {
	const values: Record<string, string> = {
		LOCAL_ACTION_WORKSPACE: root,
		GITHUB_WORKSPACE: root,
		GITHUB_ACTIONS: "true",
		CI: "true",
		...extra,
	};
	for (const [key, value] of Object.entries(step?.env ?? {})) {
		values[key] = workflowValue(value, extra);
	}
	for (const [key, value] of Object.entries(step?.with ?? {})) {
		values[`INPUT_${key.toUpperCase()}`] = workflowValue(value, extra);
	}
	return values;
}

export async function invokeLocalAction(
	root: string,
	invocation: ActionInvocation,
) {
	const actionPath = resolve(root, invocation.actionPath);
	if (!within(root, actionPath))
		throw new Error("Action path escapes repository root");
	if (
		!(await Bun.file(resolve(actionPath, "action.yml")).exists()) &&
		!(await Bun.file(resolve(actionPath, "action.yaml")).exists())
	) {
		throw new Error(
			`${invocation.actionPath} does not contain action.yml or action.yaml`,
		);
	}
	if (!invocation.entrypoint) throw new Error("A logic entrypoint is required");

	const temporaryDirectory = resolve(root, ".local-action-tmp");
	await mkdir(temporaryDirectory, { recursive: true });
	const dotenvPath = invocation.dotenv
		? resolve(root, invocation.dotenv)
		: resolve(temporaryDirectory, `${crypto.randomUUID()}.env`);
	if (!within(root, dotenvPath))
		throw new Error("Dotenv path escapes repository root");
	if (!invocation.dotenv) {
		const entries = Object.entries(invocation.env ?? {}).map(
			([key, value]) => `${key}=${dotenvValue(value)}`,
		);
		await Bun.write(dotenvPath, `${entries.join("\n")}\n`);
	}

	const executable = Bun.which("local-action");
	if (!executable)
		throw new Error("local-action executable was not found in PATH");
	const args = [
		executable,
		"run",
		actionPath,
		invocation.entrypoint,
		dotenvPath,
	];
	if (invocation.pre) args.push("--pre", invocation.pre);
	if (invocation.post) args.push("--post", invocation.post);

	try {
		const process = Bun.spawn(args, {
			cwd: actionPath,
			env: { ...Bun.env, ...invocation.env },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);
		return { exitCode, log: `${stdout}${stderr}` };
	} finally {
		if (!invocation.dotenv) await rm(dotenvPath, { force: true });
	}
}
