import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildMcpServers,
	loadResearchMcpServers,
	resolveEnvValue,
} from "./cursorMcp";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function tempProject(mcpJson?: unknown) {
	const dir = mkdtempSync(join(tmpdir(), "cursor-mcp-"));
	tempDirs.push(dir);
	if (mcpJson !== undefined) {
		writeFileSync(join(dir, ".mcp.json"), JSON.stringify(mcpJson));
	}
	return dir;
}

function envPlaceholder(name: string) {
	return `\${${name}}`;
}

describe("cursor resolveEnvValue", () => {
	test("substitutes env placeholders", () => {
		expect(
			resolveEnvValue(`https://x/${envPlaceholder("TOKEN")}/v1`, {
				TOKEN: "abc",
			}),
		).toBe("https://x/abc/v1");
	});

	test("replaces missing env values with empty strings", () => {
		expect(resolveEnvValue(envPlaceholder("MISSING"), {})).toBe("");
	});
});

describe("cursor loadResearchMcpServers", () => {
	test("returns an empty map when .mcp.json is absent", () => {
		const cwd = tempProject();
		expect(loadResearchMcpServers({ cwd })).toEqual({});
	});

	test("loads stdio and http servers with env substitution", () => {
		const cwd = tempProject({
			mcpServers: {
				searxng: {
					command: "bunx",
					args: ["mcp-searxng"],
					env: { SEARXNG_URL: envPlaceholder("SEARXNG_URL") },
				},
				remote: {
					type: "sse",
					url: `https://example.com/${envPlaceholder("PATH")}`,
					headers: {
						Authorization: `Bearer ${envPlaceholder("TOKEN")}`,
					},
				},
				skipped: {
					args: ["no-command"],
				},
			},
		});

		const servers = loadResearchMcpServers({
			cwd,
			env: {
				SEARXNG_URL: "http://127.0.0.1:8080",
				PATH: "mcp",
				TOKEN: "secret",
			},
		});

		expect(servers.searxng).toEqual({
			type: "stdio",
			command: "bunx",
			args: ["mcp-searxng"],
			cwd,
			env: { SEARXNG_URL: "http://127.0.0.1:8080" },
		});
		expect(servers.remote).toEqual({
			type: "sse",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer secret" },
		});
		expect(servers.skipped).toBeUndefined();
	});
});

describe("cursor buildMcpServers", () => {
	test("always includes the unsolved http server", () => {
		const cwd = tempProject({
			mcpServers: {
				fetch: {
					command: "uvx",
					args: ["mcp-server-fetch"],
				},
			},
		});

		const servers = buildMcpServers({
			mcpUrl: "https://example.test/mcp",
			cwd,
		});

		expect(servers.unsolved).toEqual({
			type: "http",
			url: "https://example.test/mcp",
			headers: {
				Accept: "application/json, text/event-stream",
			},
		});
		expect(servers.fetch?.type).toBe("stdio");
	});
});
