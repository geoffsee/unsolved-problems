import { describe, expect, test } from "bun:test";
import {
	buildSandboxEnv,
	clampTimeoutMs,
	formatSandboxResult,
	isBlockedSandboxEnvKey,
	runSandboxCode,
	truncateOutput,
} from "./runCode";

describe("clampTimeoutMs", () => {
	test("defaults and clamps", () => {
		expect(clampTimeoutMs()).toBe(30_000);
		expect(clampTimeoutMs(500)).toBe(500);
		expect(clampTimeoutMs(999_999)).toBe(120_000);
		expect(clampTimeoutMs(0)).toBe(1);
	});
});

describe("truncateOutput", () => {
	test("leaves short text alone", () => {
		expect(truncateOutput("hello", 10)).toBe("hello");
	});

	test("truncates long text with a marker", () => {
		const text = "a".repeat(20);
		const out = truncateOutput(text, 10);
		expect(out.startsWith("aaaaaaaaaa")).toBe(true);
		expect(out).toContain("truncated");
	});
});

describe("buildSandboxEnv / secret blocking", () => {
	test("does not forward API keys", () => {
		const env = buildSandboxEnv("/tmp/ws", {
			PATH: "/bin",
			OPENAI_API_KEY: "sk-test",
			ANTHROPIC_API_KEY: "ant-test",
			UNSOLVED_API_TOKEN: "up_live_x",
			MY_SECRET_TOKEN: "nope",
		});
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.UNSOLVED_API_TOKEN).toBeUndefined();
		expect(env.MY_SECRET_TOKEN).toBeUndefined();
		expect(env.PATH).toBe("/bin");
		expect(env.HOME).toBe("/tmp/ws");
	});

	test("classifies credential-like keys as blocked", () => {
		expect(isBlockedSandboxEnvKey("OPENAI_API_KEY")).toBe(true);
		expect(isBlockedSandboxEnvKey("DATABASE_PASSWORD")).toBe(true);
		expect(isBlockedSandboxEnvKey("PATH")).toBe(false);
	});
});

describe("runSandboxCode", () => {
	test("runs python and captures stdout", async () => {
		const result = await runSandboxCode({
			language: "python",
			code: "print(2 + 2)\n",
		});
		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("4");
		expect(result.timedOut).toBe(false);
	});

	test("runs javascript via bun", async () => {
		const result = await runSandboxCode({
			language: "javascript",
			code: "console.log(['a','b'].join('-'))\n",
		});
		expect(result.ok).toBe(true);
		expect(result.stdout.trim()).toBe("a-b");
	});

	test("runs typescript via bun", async () => {
		const result = await runSandboxCode({
			language: "typescript",
			code: "const n: number = 21\nconsole.log(n * 2)\n",
		});
		expect(result.ok).toBe(true);
		expect(result.stdout.trim()).toBe("42");
	});

	test("surfaces non-zero exits as failures", async () => {
		const result = await runSandboxCode({
			language: "python",
			code: "import sys\nsys.exit(7)\n",
		});
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(7);
	});

	test("rejects path traversal in extra files", async () => {
		const result = await runSandboxCode({
			language: "python",
			code: "print('hi')\n",
			files: { "../escape.txt": "nope" },
		});
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(
			/escapes workspace|Invalid sandbox file path/i,
		);
	});

	test("loads optional extra files inside the workspace", async () => {
		const result = await runSandboxCode({
			language: "python",
			code: "from pathlib import Path\nprint(Path('data/note.txt').read_text())\n",
			files: { "data/note.txt": "hello-sandbox" },
		});
		expect(result.ok).toBe(true);
		expect(result.stdout.trim()).toBe("hello-sandbox");
	});

	test("times out runaway processes", async () => {
		const result = await runSandboxCode({
			language: "python",
			code: "import time\ntime.sleep(10)\n",
			timeoutMs: 400,
		});
		expect(result.ok).toBe(false);
		expect(result.timedOut).toBe(true);
		expect(result.error).toMatch(/Timed out/i);
	}, 15_000);

	test("formatSandboxResult includes streams", () => {
		const text = formatSandboxResult({
			ok: true,
			language: "python",
			exitCode: 0,
			signal: null,
			timedOut: false,
			stdout: "out",
			stderr: "",
			durationMs: 12,
			workspace: "/tmp/x",
			command: ["python3", "main.py"],
		});
		expect(text).toContain("ok: true");
		expect(text).toContain("stdout:");
		expect(text).toContain("out");
	});
});
