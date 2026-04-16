export function normalizeProblemText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function slugifyProblemPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function stableProblemHash(value: string) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeProblemId(category: string, section: string, text: string) {
  const material = `${category}::${section}::${normalizeProblemText(text)}`;
  return `${slugifyProblemPart(category)}-${slugifyProblemPart(section)}-${stableProblemHash(material)}`;
}
