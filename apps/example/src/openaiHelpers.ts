import { z } from "zod";

export const SelectionSchema = z.object({
	problemId: z.string(),
	reason: z.string(),
});

export const ResearchCheckpointSchema = z.object({
	kind: z.enum([
		"note",
		"reference",
		"hypothesis",
		"failed_attempt",
		"candidate_approach",
	]),
	title: z.string(),
	content: z.string(),
	sourceUrl: z
		.string()
		.refine((value) => {
			try {
				const url = new URL(value);
				return url.protocol === "http:" || url.protocol === "https:";
			} catch {
				return false;
			}
		}, "sourceUrl must be an http(s) URL")
		.nullable(),
});

export function getText(content: Array<{ type: string; text?: string }>) {
	return content
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}

export function parseCandidateIds(text: string) {
	return text
		.split("\n")
		.map(
			(line) =>
				line.match(
					/^\d+\.\s+([^\s]+)\s+\[(available|claimed|submitted)\]/,
				)?.[1],
		)
		.filter((value): value is string => Boolean(value));
}

export function pickRandomProblemId(candidateIds: string[]): string {
	if (candidateIds.length === 0) {
		throw new Error("The MCP server did not return any available problem IDs.");
	}

	return candidateIds[Math.floor(Math.random() * candidateIds.length)];
}

export function resolveChosenProblemId(input: {
	pickMode: string;
	specificProblemId?: string | null;
	candidateIds: string[];
}): { chosenProblemId: string; reason: string } {
	if (input.pickMode === "specific") {
		if (!input.specificProblemId) {
			throw new Error(
				"OPEN_QUESTIONS_PROBLEM_ID is required when OPEN_QUESTIONS_PICK_MODE=specific.",
			);
		}

		return {
			chosenProblemId: input.specificProblemId,
			reason: "Selected explicitly by the launcher.",
		};
	}

	if (input.candidateIds.length === 0) {
		throw new Error("The MCP server did not return any available problem IDs.");
	}

	if (input.pickMode === "random") {
		return {
			chosenProblemId: pickRandomProblemId(input.candidateIds),
			reason: "Selected randomly from the live available shortlist.",
		};
	}

	throw new Error(
		`OpenAI selector agent is required for pick mode: ${input.pickMode}`,
	);
}
