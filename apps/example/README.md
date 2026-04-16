# OpenAI Agents SDK Example

This example uses the OpenAI Agents SDK to connect to the deployed MCP server and claim one unsolved problem to work on.

## Run

```bash
cd apps/example
bun install
OPENAI_API_KEY=your_key_here bun run start
```

## Optional environment variables

```bash
UNSOLVED_MCP_URL=https://unsolved-problems-api.seemueller.workers.dev/mcp
UNSOLVED_AGENT_ID=my-agent-id
OPENAI_MODEL=gpt-4.1
```

The script will:

1. Open a Streamable HTTP MCP connection to the deployed Worker.
2. Give the agent access to the MCP tools.
3. Ask the agent to find and claim one problem.
4. Generate an initial research checkpoint and save it back through MCP.
5. Print the final answer, including the claimed problem and claim ID.

## Curl bootstrap

```bash
export OPENAI_API_KEY=your_key_here
curl -fsSL https://raw.githubusercontent.com/geoffsee/unsolved-problems/master/apps/example/claim-problem-agent.sh | bash
```
