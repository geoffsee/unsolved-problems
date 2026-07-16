import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "@cursor/sdk";

export function resolveEnvValue(
	raw: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
		return env[name] ?? "";
	});
}

export function loadResearchMcpServers(input: {
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): Record<string, McpServerConfig> {
	const env = input.env ?? process.env;
	const mcpPath = join(input.cwd, ".mcp.json");
	if (!existsSync(mcpPath)) {
		return {};
	}

	const parsed = JSON.parse(readFileSync(mcpPath, "utf8")) as {
		mcpServers?: Record<
			string,
			{
				command?: string;
				args?: string[];
				env?: Record<string, string>;
				cwd?: string;
				url?: string;
				type?: string;
				headers?: Record<string, string>;
			}
		>;
	};

	const servers: Record<string, McpServerConfig> = {};
	for (const [name, config] of Object.entries(parsed.mcpServers ?? {})) {
		if (config.url) {
			servers[name] = {
				type: config.type === "sse" ? "sse" : "http",
				url: resolveEnvValue(config.url, env),
				...(config.headers
					? {
							headers: Object.fromEntries(
								Object.entries(config.headers).map(([key, value]) => [
									key,
									resolveEnvValue(value, env),
								]),
							),
						}
					: {}),
			};
			continue;
		}

		if (!config.command) {
			continue;
		}

		servers[name] = {
			type: "stdio",
			command: config.command,
			args: config.args,
			cwd: config.cwd ? resolveEnvValue(config.cwd, env) : input.cwd,
			...(config.env
				? {
						env: Object.fromEntries(
							Object.entries(config.env).map(([key, value]) => [
								key,
								resolveEnvValue(value, env),
							]),
						),
					}
				: {}),
		};
	}

	return servers;
}

export function buildMcpServers(input: {
	mcpUrl: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): Record<string, McpServerConfig> {
	return {
		unsolved: {
			type: "http",
			url: input.mcpUrl,
			headers: {
				Accept: "application/json, text/event-stream",
			},
		},
		...loadResearchMcpServers({ cwd: input.cwd, env: input.env }),
	};
}
