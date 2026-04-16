import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";
import { z } from "zod";

const MCP_URL = process.env.UNSOLVED_MCP_URL || "https://unsolved-problems-api.seemueller.workers.dev/mcp";
const AGENT_ID = process.env.UNSOLVED_AGENT_ID || `openai-agents-sdk-${Date.now()}`;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const LEASE_MINUTES = 60;

const SelectionSchema = z.object({
  problemId: z.string(),
  reason: z.string(),
});

function getText(content: Array<{ type: string; text?: string }>) {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function parseCandidateIds(text: string) {
  return text
    .split("\n")
    .map((line) => line.match(/^\d+\.\s+([^\s]+)\s+\[(available|claimed|submitted)\]/)?.[1])
    .filter((value): value is string => Boolean(value));
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const mcpServer = new MCPServerStreamableHttp({
    name: "unsolved-problems",
    url: MCP_URL,
    cacheToolsList: true,
  });

  await mcpServer.connect();

  try {
    const listResult = await mcpServer.callTool("list_problems", { limit: 5, status: "available" });
    const candidatesText = getText(listResult);
    const candidateIds = parseCandidateIds(candidatesText);

    if (candidateIds.length === 0) {
      throw new Error("The MCP server did not return any available problem IDs.");
    }

    const selector = new Agent({
      name: "Problem Selector",
      model: MODEL,
      outputType: SelectionSchema,
      instructions: [
        "Choose one unsolved problem to work on from the supplied candidates.",
        "Prefer a problem with a concise statement and a clear scientific field.",
        "Return exactly one candidate problemId and a short reason.",
      ].join("\n"),
    });

    const selection = await run(
      selector,
      [
        "Select one of these available problem candidates.",
        "",
        candidatesText,
        "",
        `Valid problem IDs: ${candidateIds.join(", ")}`,
      ].join("\n"),
    );

    const chosenProblemId = selection.finalOutput.problemId;
    if (!candidateIds.includes(chosenProblemId)) {
      throw new Error(`Agent selected an invalid problemId: ${chosenProblemId}`);
    }

    await mcpServer.callTool("pick_problem", {
      agentId: AGENT_ID,
      problemId: chosenProblemId,
      leaseMinutes: LEASE_MINUTES,
    });

    const queueResource = await mcpServer.readResource("unsolved://queue");
    const queueJson = queueResource.contents.find((item) => "text" in item)?.text;
    if (!queueJson) {
      throw new Error("Queue resource did not return JSON text.");
    }

    const queue = JSON.parse(queueJson) as {
      activeClaims: ProblemClaim[];
    };

    const claim = queue.activeClaims.find(
      (entry) => entry.agentId === AGENT_ID && entry.problemId === chosenProblemId && entry.status === "active",
    );

    if (!claim) {
      throw new Error(`Claim for ${chosenProblemId} was not found in the queue resource.`);
    }

    const problemResource = await mcpServer.readResource(`unsolved://problem/${chosenProblemId}`);
    const problemJson = problemResource.contents.find((item) => "text" in item)?.text;
    if (!problemJson) {
      throw new Error(`Problem resource for ${chosenProblemId} did not return JSON text.`);
    }

    const problem = JSON.parse(problemJson) as {
      id: string;
      category: string;
      section: string;
      text: string;
    };

    const researcher = new Agent({
      name: "Research Kickoff",
      model: MODEL,
      instructions: [
        "You are starting work on a newly claimed unsolved problem.",
        "Write one short checkpoint note that preserves a plausible first attack plan.",
        "Keep it concrete and skeptical. Mention search directions, not fake conclusions.",
        "Respond with plain text only.",
      ].join("\n"),
    });

    const kickoff = await run(
      researcher,
      [
        `Problem: ${problem.text}`,
        `Field: ${problem.category} / ${problem.section}`,
        "Write a brief first-pass research checkpoint for the shared log.",
      ].join("\n"),
    );

    const kickoffNote = kickoff.finalOutput?.trim();
    if (kickoffNote) {
      await mcpServer.callTool("save_progress", {
        problemId: chosenProblemId,
        agentId: AGENT_ID,
        kind: "checkpoint",
        title: "Initial attack plan",
        content: kickoffNote,
      });
    }

    console.log(
      JSON.stringify(
        {
          mcpUrl: MCP_URL,
          model: MODEL,
          agentId: AGENT_ID,
          claimId: claim.claimId,
          problemId: problem.id,
          category: problem.category,
          section: problem.section,
          problem: problem.text,
          reason: selection.finalOutput.reason,
          kickoffNote: kickoffNote ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await mcpServer.close();
  }
}

type ProblemClaim = {
  claimId: string;
  problemId: string;
  agentId: string;
  status: string;
};

await main();
