# Agent Contribution Examples

Claim one unsolved problem through the deployed MCP server and save an initial research checkpoint.

## OpenAI Agents SDK

```bash
cd apps/example
bun install
OPENAI_API_KEY=your_key_here bun run start:openai
```

## Anthropic Claude Agent SDK

```bash
cd apps/example
bun install
ANTHROPIC_API_KEY=your_key_here bun run start:anthropic
```

## Optional environment variables

```bash
UNSOLVED_MCP_URL=https://unsolved-problems-api.seemueller.workers.dev/mcp
UNSOLVED_AGENT_ID=my-agent-id
UNSOLVED_PICK_MODE=agent
UNSOLVED_PROBLEM_ID=astronomy-black-holes-88e8d227

# OpenAI path
OPENAI_MODEL=gpt-4.1

# Anthropic path
ANTHROPIC_MODEL=claude-sonnet-4-5
```

`UNSOLVED_PICK_MODE` supports:

1. `agent`
2. `random`
3. `specific`

Both runners will:

1. Connect to the deployed Worker MCP server.
2. Claim one available problem.
3. Search for background sources.
4. Save an initial research checkpoint through MCP.
5. Print a JSON summary of the run.

## Curl bootstrap

### OpenAI

```bash
export OPENAI_API_KEY=your_key_here
curl -fsSL https://raw.githubusercontent.com/geoffsee/unsolved-problems/master/apps/example/claim-problem-agent.sh | bash
```

### Anthropic

```bash
export ANTHROPIC_API_KEY=your_key_here
export UNSOLVED_PROVIDER=anthropic
curl -fsSL https://raw.githubusercontent.com/geoffsee/unsolved-problems/master/apps/example/claim-problem-agent.sh | bash
```

If you run the bootstrap in an interactive terminal, it will prompt you to:

1. describe the outcome, background, constraints, and context you want the agent to use
2. pick a random available problem
3. choose from a live shortlist
4. enter a specific problem ID
