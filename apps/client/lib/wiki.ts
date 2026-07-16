export interface Section {
	heading: string;
	problems: string[];
}

export interface EnrichmentProblem {
	summary: string;
	significance: string;
	field?: string;
	yearProposed?: string;
}

let enrichments: Record<string, EnrichmentProblem> = {};

export function setEnrichments(data: Record<string, EnrichmentProblem>) {
	enrichments = data;
}

export function getEnrichment(problemText: string): EnrichmentProblem | null {
	const key = problemText.slice(0, 120);
	return enrichments[key] || null;
}
