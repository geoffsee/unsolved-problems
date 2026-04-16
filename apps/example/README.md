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
UNSOLVED_PICK_MODE=agent
UNSOLVED_PROBLEM_ID=astronomy-black-holes-88e8d227
```

`UNSOLVED_PICK_MODE` supports:

1. `agent`
2. `random`
3. `specific`

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

If you run the bootstrap in an interactive terminal, it will prompt you to:

1. describe the outcome, background, constraints, and context you want the agent to use
2. pick a random available problem
3. choose from a live shortlist
4. enter a specific problem ID
