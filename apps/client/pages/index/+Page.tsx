import { useState, useCallback, useEffect } from "react";
import { useData } from "vike-react/useData";
import { CATEGORIES, setEnrichments, type Section, type Category } from "../../lib/wiki";
import CategoryGrid from "../../components/CategoryGrid";
import ProblemsView from "../../components/ProblemsView";
import RandomModal from "../../components/RandomModal";
import Header from "../../components/Header";
import SearchBar from "../../components/SearchBar";
import NewsFeed from "../../components/NewsFeed";
import { Box } from "@chakra-ui/react";

export default function Page() {
  const { categories, enrichments, news: preloadedNews } = useData<{
    categories: Record<string, Section[]>;
    enrichments: Record<string, any>;
    news: any[];
  }>();

  // Initialize enrichments from prerendered data
  useEffect(() => {
    setEnrichments(enrichments);
  }, [enrichments]);

  // Compute problem counts from prerendered data
  const loadedCategories: Record<string, number> = {};
  for (const [key, sections] of Object.entries(categories)) {
    loadedCategories[key] = sections.reduce((n, s) => n + s.problems.length, 0);
  }

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showRandom, setShowRandom] = useState(false);
  const [randomProblem, setRandomProblem] = useState<any | null>(null);

  const sections = activeCategory && categories[activeCategory]
    ? categories[activeCategory]
    : [];

  const selectCategory = useCallback((key: string) => {
    setActiveCategory(key);
    setSearch("");
  }, []);

  const goBack = () => {
    setActiveCategory(null);
    setSearch("");
  };

  const pickRandom = useCallback(() => {
    setShowRandom(true);

    const pool: any[] = [];
    for (const [k, secs] of Object.entries(categories)) {
      if (CATEGORIES[k]?.type === "news") continue;
      for (const sec of secs) {
        for (const p of sec.problems) {
          pool.push({ category: k, section: sec.heading, text: p });
        }
      }
    }

    if (pool.length > 0) {
      setRandomProblem(pool[Math.floor(Math.random() * pool.length)]);
    }
  }, [categories]);

  const filteredSections = sections
    .map((sec) => ({
      ...sec,
      problems: sec.problems.filter((p: string) =>
        p.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((sec) => sec.problems.length > 0);

  const totalProblems = sections.reduce((n, s) => n + s.problems.length, 0);

  const isNews = activeCategory && CATEGORIES[activeCategory]?.type === "news";

  return (
    <Box minH="100vh" bg="app.bg" color="app.text">
      <Header />

      <SearchBar
        search={search}
        onSearch={setSearch}
        onRandom={pickRandom}
        showSearch={!!activeCategory && !isNews}
        placeholder={activeCategory ? `Search in ${activeCategory}...` : "Filter..."}
      />

      <Box pt={8}>
        {!activeCategory ? (
          <CategoryGrid
            categories={CATEGORIES}
            loaded={loadedCategories}
            onSelect={selectCategory}
          />
        ) : isNews ? (
          <NewsFeed
            news={preloadedNews}
            loading={false}
            error={null}
            search={search}
            onBack={goBack}
          />
        ) : (
          <ProblemsView
            categoryKey={activeCategory}
            category={CATEGORIES[activeCategory]}
            sections={filteredSections}
            totalProblems={totalProblems}
            loading={false}
            error={null}
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