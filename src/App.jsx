import { useState, useEffect, useCallback } from "react";
import { ThemeProvider, createGlobalStyle } from "styled-components";
import theme from "./theme";
import { CATEGORIES, fetchProblems } from "./wiki";
import CategoryGrid from "./components/CategoryGrid";
import ProblemsView from "./components/ProblemsView";
import RandomModal from "./components/RandomModal";
import Header from "./components/Header";
import SearchBar from "./components/SearchBar";
import NewsFeed from "./components/NewsFeed";
import { fetchFrontierNews } from "./gdelt";

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: ${({ theme }) => theme.fonts.body};
    background: ${({ theme }) => theme.colors.bg};
    color: ${({ theme }) => theme.colors.text};
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  ::selection {
    background: ${({ theme }) => theme.colors.accent};
    color: white;
  }

  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 4px;
  }
`;

// Cache fetched results so we don't re-fetch on navigation
const cache = {};

function App() {
  const [activeCategory, setActiveCategory] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [showRandom, setShowRandom] = useState(false);
  const [randomPool, setRandomPool] = useState([]);
  const [randomProblem, setRandomProblem] = useState(null);
  const [loadedCategories, setLoadedCategories] = useState({});
  const [news, setNews] = useState([]);

  const selectCategory = useCallback(async (key) => {
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
      } catch (e) {
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
        [key]: data.reduce((n, s) => n + s.problems.length, 0),
      }));
    } catch (e) {
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
    let pool = [];
    const keys = Object.keys(CATEGORIES);

    for (const key of keys) {
      if (cache[key]) {
        for (const sec of cache[key]) {
          for (const p of sec.problems) {
            pool.push({ category: key, section: sec.heading, text: p });
          }
        }
      }
    }

    if (pool.length > 0) {
      setRandomPool(pool);
      setRandomProblem(pool[Math.floor(Math.random() * pool.length)]);
      return;
    }

    // Fetch a few quick categories
    const quickCats = ["computer science", "physics", "mathematics"];
    for (const key of quickCats) {
      if (!cache[key]) {
        try {
          const data = await fetchProblems(key);
          cache[key] = data;
          for (const sec of data) {
            for (const p of sec.problems) {
              pool.push({ category: key, section: sec.heading, text: p });
            }
          }
        } catch {
          // skip
        }
      }
    }
    setRandomPool(pool);
    if (pool.length > 0) {
      setRandomProblem(pool[Math.floor(Math.random() * pool.length)]);
    }
  }, []);

  const nextRandom = () => {
    if (randomPool.length === 0) return;
    setRandomProblem(
      randomPool[Math.floor(Math.random() * randomPool.length)]
    );
  };

  // Filtered sections based on search
  const filteredSections = sections
    .map((sec) => ({
      ...sec,
      problems: sec.problems.filter((p) =>
        p.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((sec) => sec.problems.length > 0);

  const totalProblems = sections.reduce(
    (n, s) => n + s.problems.length,
    0
  );

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <Header />
      <SearchBar
        search={search}
        onSearch={setSearch}
        onRandom={pickRandom}
        showSearch={!!activeCategory}
        placeholder={
          activeCategory && CATEGORIES[activeCategory].type === "news"
            ? "Filter news..."
            : "Filter problems..."
        }
      />

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

      {showRandom && (
        <RandomModal
          problem={randomProblem}
          onNext={nextRandom}
          onClose={() => setShowRandom(false)}
        />
      )}
    </ThemeProvider>
  );
}

export default App;
