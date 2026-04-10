export async function fetchFrontierNews() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/news.json`);
  if (!res.ok) throw new Error("News data not available. Run `npm run fetch-news` to generate it.");
  const data = await res.json();
  return data.articles || [];
}
