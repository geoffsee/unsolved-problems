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

export interface Category {
  page?: string;
  type?: string;
  emoji: string;
  color: string;
}

export const CATEGORIES: Record<string, Category> = {
  mathematics: {
    page: "List_of_unsolved_problems_in_mathematics",
    emoji: "\u{1F9EE}",
    color: "#6C5CE7",
  },
  physics: {
    page: "List_of_unsolved_problems_in_physics",
    emoji: "\u{269B}\uFE0F",
    color: "#0984E3",
  },
  "computer science": {
    page: "List_of_unsolved_problems_in_computer_science",
    emoji: "\u{1F4BB}",
    color: "#00B894",
  },
  biology: {
    page: "List_of_unsolved_problems_in_biology",
    emoji: "\u{1F9EC}",
    color: "#00CEC9",
  },
  chemistry: {
    page: "List_of_unsolved_problems_in_chemistry",
    emoji: "\u{2697}\uFE0F",
    color: "#E17055",
  },
  neuroscience: {
    page: "List_of_unsolved_problems_in_neuroscience",
    emoji: "\u{1F9E0}",
    color: "#E84393",
  },
  philosophy: {
    page: "List_of_philosophical_problems",
    emoji: "\u{1F4AD}",
    color: "#A29BFE",
  },
  astronomy: {
    page: "List_of_unsolved_problems_in_astronomy",
    emoji: "\u{1F52D}",
    color: "#2D3436",
  },
  economics: {
    page: "List_of_unsolved_problems_in_economics",
    emoji: "\u{1F4C8}",
    color: "#636E72",
  },
  "frontier research": {
    type: "news",
    emoji: "\u{1F52C}",
    color: "#8a9bb5",
  },
};