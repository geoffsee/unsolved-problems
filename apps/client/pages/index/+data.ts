import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export function data() {
  const problemsPath = resolve("public/data/problems.json");
  const enrichmentsPath = resolve("public/data/enrichments.json");
  const newsPath = resolve("public/data/news.json");

  let categories: Record<string, any[]> = {};
  let enrichments: Record<string, any> = {};
  let news: any[] = [];

  if (existsSync(problemsPath)) {
    const raw = JSON.parse(readFileSync(problemsPath, "utf-8"));
    categories = raw.categories || {};
  }

  if (existsSync(enrichmentsPath)) {
    const raw = JSON.parse(readFileSync(enrichmentsPath, "utf-8"));
    enrichments = raw.problems || {};
  }

  if (existsSync(newsPath)) {
    const raw = JSON.parse(readFileSync(newsPath, "utf-8"));
    news = raw.articles || [];
  }

  return { categories, enrichments, news };
}