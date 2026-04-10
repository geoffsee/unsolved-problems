import { useState, useCallback } from "react";
import { CATEGORIES, fetchProblems, type Category } from "../../lib/wiki";
import { fetchFrontierNews } from "../../lib/gdelt";
import CategoryGrid from "../../components/CategoryGrid";
import ProblemsView from "../../components/ProblemsView";
import RandomModal from "../../components/RandomModal";
import Header from "../../components/Header";
import SearchBar from "../../components/SearchBar";
import NewsFeed from "../../components/NewsFeed";
import { Box } from "@chakra-ui/react";

interface Section {
  heading: string;
  problems: string[];
}

// Cache fetched results so we don't re-fetch on navigation
const cache: Record<string, Section[]> = {};

export default function Page() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showRandom, setShowRandom] = useState(false);
  const [randomProblem, setRandomProblem] = useState<any | null>(null);
  const [loadedCategories, setLoadedCategories] = useState<Record<string, number>>({});
  const [news, setNews] = useState<any[]>([]);

  const selectCategory = useCallback(async (key: string) => {
    setActiveCategory(key);
    setSearch("");
    setError(null);
    setNews([]);

    if (CATEGORIES[key].type === "news") {
      setLoading(true);
      setSections([]);
      try {
        const data = await fetchFrontierNews();
        setNews(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (cache[key]) {
      setSections(cache[key]);
      return;
    }

    setLoading(true);
    setSections([]);
    try {
      const data = await fetchProblems(key);
      cache[key] = data;
      setSections(data);
      setLoadedCategories((prev) => ({
        ...prev,
        [key]: data.reduce((n: number, s: Section) => n + s.problems.length, 0),
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const goBack = () => {
    setActiveCategory(null);
    setSections([]);
    setSearch("");
    setError(null);
  };

  const pickRandom = useCallback(async () => {
    setShowRandom(true);
    setRandomProblem(null);

    // Build pool from cache, fetch missing categories
    let pool: any[] = [];
    const keys = Object.keys(CATEGORIES);

    for (const k of keys) {
      if (CATEGORIES[k].type === "news") continue;
      if (!cache[k]) {
        try {
          const data = await fetchProblems(k);
          cache[k] = data;
          setLoadedCategories((prev) => ({
            ...prev,
            [k]: data.reduce((n: number, s: any) => n + s.problems.length, 0),
          }));
        } catch {
          continue;
        }
      }
      cache[k].forEach((sec: any) => {
        sec.problems.forEach((p: string) => {
          pool.push({ category: k, section: sec.heading, text: p });
        });
      });
    }

    if (pool.length > 0) {
      const randomIdx = Math.floor(Math.random() * pool.length);
      setRandomProblem(pool[randomIdx]);
    }
  }, []);

  const filteredSections = sections
    .map((sec) => ({
      ...sec,
      problems: sec.problems.filter((p: string) =>
        p.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((sec) => sec.problems.length > 0);

  const totalProblems = sections.reduce((n, s) => n + s.problems.length, 0);

  return (
    <Box minH="100vh" bg="app.bg" color="app.text">
      <Header />
      
      <SearchBar
        search={search}
        onSearch={setSearch}
        onRandom={pickRandom}
        showSearch={!!activeCategory && CATEGORIES[activeCategory].type !== "news"}
        placeholder={activeCategory ? `Search in ${activeCategory}...` : "Filter..."}
      />

      <Box pt={8}>
        {!activeCategory ? (
          <CategoryGrid
            categories={CATEGORIES}
            loaded={loadedCategories}
            onSelect={selectCategory}
          />
        ) : CATEGORIES[activeCategory].type === "news" ? (
          <NewsFeed
            news={news}
            loading={loading}
            error={error}
            search={search}
            onBack={goBack}
          />
        ) : (
          <ProblemsView
            categoryKey={activeCategory}
            category={CATEGORIES[activeCategory]}
            sections={filteredSections}
            totalProblems={totalProblems}
            loading={loading}
            error={error}
            search={search}
            onBack={goBack}
          />
        )}
      </Box>

      <RandomModal
        problem={randomProblem}
        isOpen={showRandom}
        onNext={pickRandom}
        onClose={() => setShowRandom(false)}
      />
    </Box>
  );
}
