export interface CaseItem {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  sourceName: string;
  sourceSection: string;
  sourceUrl: string;
  reportedDate: string | null;
  location: string | null;
  facts: Record<string, string>;
  details: string | null;
  remarks: string | null;
}

export interface CaseCategoryData {
  label: string;
  sourceName: string;
  sourceSection: string;
  sourceUrl: string;
  disclaimer: string;
  total: number;
  fresh: boolean;
  attemptedAt: string;
  lastSuccessfulFetchAt: string | null;
  lastError: string | null;
  items: CaseItem[];
}
