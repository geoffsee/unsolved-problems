const WIKI_API = "https://en.wikipedia.org/w/api.php";

interface Section {
  heading: string;
  problems: string[];
}

interface PreloadedData {
  fetchedAt: string;
  categories: Record<string, Section[]>;
}

async function fetchGzJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url + '.gz');
    if (!res.ok) return null;
    const ds = new DecompressionStream('gzip');
    const decompressed = res.body!.pipeThrough(ds);
    const text = await new Response(decompressed).json();
    return text as T;
  } catch {
    // Fallback to uncompressed
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }
}

// Pre-fetched data loaded at build time (populated by scripts/fetch-data.mjs)
let preloaded: PreloadedData | null = null;
const preloadPromise = typeof window !== 'undefined'
  ? fetchGzJson<PreloadedData>('/data/problems.json')
      .then((d) => { preloaded = d; })
  : Promise.resolve();

interface EnrichmentProblem {
  summary: string;
  significance: string;
  field?: string;
  yearProposed?: string;
}

interface EnrichmentData {
  fetchedAt: string;
  problems: Record<string, EnrichmentProblem>;
}

// AI-generated enrichments (populated by scripts/enrich-data.mjs)
let enrichments: EnrichmentData | null = null;
if (typeof window !== 'undefined') {
  fetchGzJson<EnrichmentData>('/data/enrichments.json')
    .then((d) => { enrichments = d; });
}

export function getEnrichment(problemText: string): EnrichmentProblem | null {
  if (!enrichments?.problems) return null;
  const key = problemText.slice(0, 120);
  return enrichments.problems[key] || null;
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

async function wikiRequest(params: Record<string, string>) {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*"); // CORS
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  return res.json();
}

function htmlToListItems(html: string) {
  if (typeof window === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items: string[] = [];
  const seen = new Set();

  for (const li of doc.querySelectorAll("li")) {
    // Skip items inside references/footnotes
    if (li.closest(".reflist, .references, .mw-references-wrap")) continue;

    // Remove sup/citation elements
    for (const sup of li.querySelectorAll("sup, .reference, .mw-cite-backlink")) {
      sup.remove();
    }

    let text = li.textContent?.trim() || "";

    // Skip citation footnotes
    if (/^\^/.test(text)) continue;
    // Skip very short items
    if (text.length < 15) continue;
    // Clean LaTeX artifacts
    text = text.replace(/\{\\displaystyle\s*([^}]*)\}/g, "$1");
    text = text.replace(/\\displaystyle\s*/g, "");
    // Collapse whitespace
    text = text.replace(/\s+/g, " ");

    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }
  return items;
}

const SKIP_HEADINGS = new Set([
  "see also", "references", "external links", "notes",
  "further reading", "footnotes", "citations", "bibliography",
]);

export async function fetchProblems(categoryKey: string): Promise<Section[]> {
  const cat = CATEGORIES[categoryKey];
  if (!cat) throw new Error(`Unknown category: ${categoryKey}`);

  // Try pre-fetched data first
  await preloadPromise;
  if (preloaded?.categories?.[categoryKey]?.length && preloaded.categories[categoryKey].length > 0) {
    return preloaded.categories[categoryKey];
  }

  // Fall back to live Wikipedia API
  const sectionsData = await wikiRequest({
    action: "parse",
    page: cat.page!,
    prop: "sections",
  });
  const sections = sectionsData.parse?.sections || [];

  const result: Section[] = [];

  for (const sec of sections) {
    const heading = sec.line?.replace(/<[^>]+>/g, "").trim();
    const headingLower = heading.toLowerCase();
    if (SKIP_HEADINGS.has(headingLower)) continue;
    if (headingLower.includes("solved")) continue;
    if (parseInt(sec.toclevel) > 2) continue;

    const htmlData = await wikiRequest({
      action: "parse",
      page: cat.page,
      prop: "text",
      section: sec.index,
    });
    const html = htmlData.parse?.text?.["*"] || "";
    const problems = htmlToListItems(html);

    if (problems.length > 0) {
      result.push({ heading, problems });
    }
  }

  return result;
}
