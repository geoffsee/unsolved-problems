type McpServer = {
	command?: string;
	args?: string[];
};

const configPath = Bun.argv[2] || "apps/example/.mcp.json";
const config = (await Bun.file(configPath).json()) as {
	mcpServers?: Record<string, McpServer>;
};

for (const [name, server] of Object.entries(config.mcpServers || {})) {
	if (server.command !== "bunx") continue;
	const packageSpec = server.args?.find((arg) => !arg.startsWith("-"));
	if (!packageSpec)
		throw new Error(`MCP server ${name} has no Bun package in args`);

	console.log(`Preinstalling MCP server ${name}: ${packageSpec}`);
	const process = Bun.spawn(["bunx", "--bun", packageSpec, "--help"], {
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await process.exited) !== 0) {
		throw new Error(`Failed to preinstall MCP server ${name}`);
	}
}
