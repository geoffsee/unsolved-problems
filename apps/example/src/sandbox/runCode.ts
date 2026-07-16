import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export const SANDBOX_LANGUAGES = [
	"python",
	"javascript",
	"typescript",
] as const;

export type SandboxLanguage = (typeof SANDBOX_LANGUAGES)[number];

export type RunSandboxCodeInput = {
	language: SandboxLanguage;
	code: string;
	/** Optional extra files relative to the sandbox workspace root. */
	files?: Record<string, string>;
	/** Optional CLI args passed to the program. */
	args?: string[];
	/** Wall-clock timeout in milliseconds (default 30_000, max 120_000). */
	timeoutMs?: number;
};

export type RunSandboxCodeResult = {
	ok: boolean;
	language: SandboxLanguage;
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	durationMs: number;
	workspace: string;
	command: string[];
	error?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CODE_BYTES = 200_000;
const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 20;
const MAX_OUTPUT_CHARS = 80_000;

const SECRET_ENV_PATTERN =
	/(key|token|secret|password|credential|authorization|private)/i;

export function clampTimeoutMs(timeoutMs?: number): number {
	if (timeoutMs === undefined || Number.isNaN(timeoutMs)) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Math.min(Math.max(1, Math.floor(timeoutMs)), MAX_TIMEOUT_MS);
}

export function truncateOutput(
	text: string,
	maxChars = MAX_OUTPUT_CHARS,
): string {
	if (text.length <= maxChars) return text;
	const omitted = text.length - maxChars;
	return `${text.slice(0, maxChars)}\n...[truncated ${omitted} chars]`;
}

export function buildSandboxEnv(
	workspace: string,
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const pathValue = env.PATH ?? env.Path ?? "/usr/bin:/bin:/usr/local/bin";
	// Minimal environment only — never forward host secrets/API tokens.
	return {
		PATH: pathValue,
		HOME: workspace,
		TMPDIR: join(workspace, ".tmp"),
		TEMP: join(workspace, ".tmp"),
		TMP: join(workspace, ".tmp"),
		LANG: env.LANG ?? "C.UTF-8",
		LC_ALL: env.LC_ALL ?? "C.UTF-8",
		BUN_INSTALL: env.BUN_INSTALL,
		npm_config_cache: join(workspace, ".npm-cache"),
		PYTHONPYCACHEPREFIX: join(workspace, ".pycache"),
		PYTHONDONTWRITEBYTECODE: "1",
		NODE_OPTIONS: "",
	};
}

/** Exposed for tests that assert credential stripping stays intentional. */
export function isBlockedSandboxEnvKey(key: string): boolean {
	return (
		SECRET_ENV_PATTERN.test(key) ||
		key === "OPENAI_API_KEY" ||
		key === "ANTHROPIC_API_KEY" ||
		key === "CURSOR_API_KEY" ||
		key === "OPEN_QUESTIONS_API_TOKEN" ||
		key === "GITHUB_TOKEN" ||
		key === "GH_TOKEN"
	);
}

function assertSafeRelativePath(relativePath: string): string {
	const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
	if (!normalized || normalized.includes("\0")) {
		throw new Error(`Invalid sandbox file path: ${relativePath}`);
	}
	if (normalized.split("/").some((part) => part === ".." || part === "")) {
		throw new Error(`Sandbox file path escapes workspace: ${relativePath}`);
	}
	return normalized;
}

function resolveInsideWorkspace(
	workspace: string,
	relativePath: string,
): string {
	const safeRelative = assertSafeRelativePath(relativePath);
	const absolute = resolve(workspace, safeRelative);
	const root = resolve(workspace) + sep;
	if (absolute !== resolve(workspace) && !absolute.startsWith(root)) {
		throw new Error(`Sandbox file path escapes workspace: ${relativePath}`);
	}
	return absolute;
}

function writeWorkspaceFiles(
	workspace: string,
	files: Record<string, string> | undefined,
): void {
	if (!files) return;
	const entries = Object.entries(files);
	if (entries.length > MAX_FILES) {
		throw new Error(`Too many files (max ${MAX_FILES}).`);
	}
	for (const [relativePath, contents] of entries) {
		if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES) {
			throw new Error(`File too large: ${relativePath}`);
		}
		const absolute = resolveInsideWorkspace(workspace, relativePath);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, contents, "utf8");
	}
}

function entrypointForLanguage(language: SandboxLanguage): string {
	switch (language) {
		case "python":
			return "main.py";
		case "javascript":
			return "main.mjs";
		case "typescript":
			return "main.ts";
	}
}

function resolveCommand(
	language: SandboxLanguage,
	entrypoint: string,
	args: string[],
): { command: string; argv: string[] } {
	switch (language) {
		case "python":
			return { command: "python3", argv: [entrypoint, ...args] };
		case "javascript":
			// Prefer bun when present; fall back to node.
			return process.env.SANDBOX_JS_RUNTIME === "node"
				? { command: "node", argv: [entrypoint, ...args] }
				: { command: "bun", argv: ["run", entrypoint, ...args] };
		case "typescript":
			return { command: "bun", argv: ["run", entrypoint, ...args] };
	}
}

function runProcess(input: {
	command: string;
	argv: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
}): Promise<{
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	durationMs: number;
}> {
	const started = Date.now();
	return new Promise((resolvePromise) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const child = spawn(input.command, input.argv, {
			cwd: input.cwd,
			env: input.env,
			stdio: ["ignore", "pipe", "pipe"],
			// Detach so the whole process group can be killed on timeout.
			detached: process.platform !== "win32",
		});

		const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolvePromise({
				exitCode,
				signal,
				timedOut,
				stdout: truncateOutput(stdout),
				stderr: truncateOutput(stderr),
				durationMs: Date.now() - started,
			});
		};

		const timer = setTimeout(() => {
			timedOut = true;
			try {
				if (child.pid && process.platform !== "win32") {
					process.kill(-child.pid, "SIGKILL");
				} else {
					child.kill("SIGKILL");
				}
			} catch {
				child.kill("SIGKILL");
			}
		}, input.timeoutMs);

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			if (stdout.length < MAX_OUTPUT_CHARS * 2) {
				stdout += chunk;
			}
		});
		child.stderr?.on("data", (chunk: string) => {
			if (stderr.length < MAX_OUTPUT_CHARS * 2) {
				stderr += chunk;
			}
		});
		child.on("error", (error) => {
			stderr = stderr ? `${stderr}\n${error.message}` : error.message;
			finish(1, null);
		});
		child.on("close", (code, signal) => {
			finish(code, signal);
		});
	});
}

export async function runSandboxCode(
	input: RunSandboxCodeInput,
): Promise<RunSandboxCodeResult> {
	const language = input.language;
	if (!SANDBOX_LANGUAGES.includes(language)) {
		return {
			ok: false,
			language,
			exitCode: null,
			signal: null,
			timedOut: false,
			stdout: "",
			stderr: "",
			durationMs: 0,
			workspace: "",
			command: [],
			error: `Unsupported language: ${String(language)}`,
		};
	}

	if (Buffer.byteLength(input.code, "utf8") > MAX_CODE_BYTES) {
		return {
			ok: false,
			language,
			exitCode: null,
			signal: null,
			timedOut: false,
			stdout: "",
			stderr: "",
			durationMs: 0,
			workspace: "",
			command: [],
			error: `Code exceeds max size of ${MAX_CODE_BYTES} bytes.`,
		};
	}

	const timeoutMs = clampTimeoutMs(input.timeoutMs);
	const workspace = mkdtempSync(join(tmpdir(), "unsolved-sandbox-"));
	const tmpPath = join(workspace, ".tmp");
	mkdirSync(tmpPath, { recursive: true });

	const entrypoint = entrypointForLanguage(language);
	const commandSpec = resolveCommand(language, entrypoint, input.args ?? []);
	const command = [commandSpec.command, ...commandSpec.argv];

	try {
		writeWorkspaceFiles(workspace, input.files);
		writeFileSync(join(workspace, entrypoint), input.code, "utf8");

		const env = buildSandboxEnv(workspace);
		const result = await runProcess({
			command: commandSpec.command,
			argv: commandSpec.argv,
			cwd: workspace,
			env,
			timeoutMs,
		});

		const error = result.timedOut
			? `Timed out after ${timeoutMs}ms.`
			: result.exitCode === 0
				? undefined
				: result.stderr.trim() ||
					`Process exited with code ${result.exitCode ?? "null"}.`;

		return {
			ok: !result.timedOut && result.exitCode === 0,
			language,
			exitCode: result.exitCode,
			signal: result.signal,
			timedOut: result.timedOut,
			stdout: result.stdout,
			stderr: result.stderr,
			durationMs: result.durationMs,
			workspace,
			command,
			error,
		};
	} catch (error) {
		return {
			ok: false,
			language,
			exitCode: null,
			signal: null,
			timedOut: false,
			stdout: "",
			stderr: "",
			durationMs: 0,
			workspace,
			command,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

export function formatSandboxResult(result: RunSandboxCodeResult): string {
	const lines = [
		`ok: ${result.ok}`,
		`language: ${result.language}`,
		`exitCode: ${result.exitCode ?? "null"}`,
		`timedOut: ${result.timedOut}`,
		`durationMs: ${result.durationMs}`,
		`command: ${result.command.join(" ")}`,
	];
	if (result.error) {
		lines.push(`error: ${result.error}`);
	}
	lines.push("stdout:", result.stdout || "(empty)");
	lines.push("stderr:", result.stderr || "(empty)");
	return lines.join("\n");
}

export const RUN_CODE_TOOL_DESCRIPTION = [
	"Run a short program in an isolated temporary workspace to test an idea,",
	"check a calculation, or prototype a candidate approach.",
	"Supported languages: python, javascript, typescript.",
	"The process has a clean environment (no API keys), a hard wall-clock timeout,",
	"and is deleted after the run. Prefer small, self-contained snippets.",
	"Do not use this to access the host repository, network credentials, or secrets.",
].join(" ");
