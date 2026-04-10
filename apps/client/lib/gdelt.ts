export async function fetchFrontierNews() {
  let data: any;
  try {
    const res = await fetch('/data/news.json.gz');
    if (!res.ok) throw new Error('gz not found');
    const ds = new DecompressionStream('gzip');
    const decompressed = res.body!.pipeThrough(ds);
    data = await new Response(decompressed).json();
  } catch {
    const res = await fetch('/data/news.json');
    if (!res.ok) throw new Error("News data not available. Run `npm run fetch-news` to generate it.");
    data = await res.json();
  }
  return data.articles || [];
}
