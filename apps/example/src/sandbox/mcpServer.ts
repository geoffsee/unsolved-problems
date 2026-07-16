/**
 * Stdio MCP server exposing run_code for Cursor (and other stdio MCP clients).
 *
 * Usage:
 *   bun run src/sandbox/mcpServer.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RUN_CODE_TOOL_NAME, SANDBOX_MCP_SERVER_NAME } from "./constants";
import {
	formatSandboxResult,
	RUN_CODE_TOOL_DESCRIPTION,
	runSandboxCode,
	SANDBOX_LANGUAGES,
} from "./runCode";

const languageSchema = z.enum(SANDBOX_LANGUAGES);

async function main() {
	const server = new McpServer({
		name: SANDBOX_MCP_SERVER_NAME,
		version: "1.0.0",
	});

	server.registerTool(
		RUN_CODE_TOOL_NAME,
		{
			description: RUN_CODE_TOOL_DESCRIPTION,
			inputSchema: {
				language: languageSchema.describe(
					"Runtime to use: python, javascript, or typescript.",
				),
				code: z
					.string()
					.min(1)
					.describe("Full program source to execute as the entrypoint."),
				files: z
					.record(z.string(), z.string())
					.optional()
					.describe(
						"Optional extra files to materialize in the sandbox workspace (relative paths only).",
					),
				args: z
					.array(z.string())
					.optional()
					.describe(
						"Optional argv passed to the program after the entrypoint.",
					),
				timeoutMs: z
					.number()
					.int()
					.positive()
					.max(120_000)
					.optional()
					.describe(
						"Wall-clock timeout in milliseconds (default 30000, max 120000).",
					),
			},
		},
		async (args) => {
			const result = await runSandboxCode({
				language: args.language,
				code: args.code,
				files: args.files,
				args: args.args,
				timeoutMs: args.timeoutMs,
			});
			return {
				content: [{ type: "text" as const, text: formatSandboxResult(result) }],
				isError: !result.ok,
			};
		},
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
