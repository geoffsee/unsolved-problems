import { useState, useCallback, useEffect } from "react";
import { useData } from "vike-react/useData";
import { CATEGORIES, setEnrichments, type Section } from "../../lib/wiki";
import type { CaseCategoryData } from "../../lib/cases";
import CategoryGrid from "../../components/CategoryGrid";
import ProblemsView from "../../components/ProblemsView";
import RandomModal from "../../components/RandomModal";
import AboutModal from "../../components/AboutModal";
import Header from "../../components/Header";
import SearchBar from "../../components/SearchBar";
import NewsFeed from "../../components/NewsFeed";
import CaseFeed from "../../components/CaseFeed";
import AgentLaunchCard from "../../components/AgentLaunchCard";
import { Box } from "@chakra-ui/react";
import { fetchQueueSnapshot, type LiveProblemState, type QueueSnapshot } from "../../lib/agentResearch";
import { makeProblemId } from "../../lib/problemIds";

export default function Page() {
  const { categories, enrichments, news: preloadedNews, cases: preloadedCases } = useData<{
    categories: Record<string, Section[]>;
    enrichments: Record<string, any>;
    news: any[];
    cases: Record<string, CaseCategoryData>;
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
  for (const [key, feed] of Object.entries(preloadedCases)) {
    loadedCategories[key] = feed.items.length;
  }

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showRandom, setShowRandom] = useState(false);
  const [randomProblem, setRandomProblem] = useState<any | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot | null>(null);

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
      if (CATEGORIES[k]?.type) continue;
      for (const sec of secs) {
        for (const p of sec.problems) {
          pool.push({ id: makeProblemId(k, sec.heading, p), category: k, section: sec.heading, text: p });
        }
      }
    }

    if (pool.length > 0) {
      setRandomProblem(pool[Math.floor(Math.random() * pool.length)]);
    }
  }, [categories]);

  useEffect(() => {
    const controller = new AbortController();

    fetchQueueSnapshot(controller.signal)
      .then(setQueueSnapshot)
      .catch(() => {});

    return () => controller.abort();
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

  const activeType = activeCategory ? CATEGORIES[activeCategory]?.type : null;
  const activeCases = activeCategory && activeType === "cases" ? preloadedCases[activeCategory] : null;
  const liveProblemStateById: Record<string, LiveProblemState> = {};

  if (queueSnapshot) {
    for (const [problemId, researchCount] of Object.entries(queueSnapshot.researchCountsByProblemId || {})) {
      liveProblemStateById[problemId] = {
        activeClaim: null,
        researchCount,
        lastResearchAt: queueSnapshot.lastResearchAtByProblemId?.[problemId] ?? null,
        hasSubmissions: false,
      };
    }

    for (const submission of queueSnapshot.submissions || []) {
      const existing = liveProblemStateById[submission.problemId];
      liveProblemStateById[submission.problemId] = {
        activeClaim: existing?.activeClaim ?? null,
        researchCount: existing?.researchCount ?? 0,
        lastResearchAt: existing?.lastResearchAt ?? null,
        hasSubmissions: true,
      };
    }

    for (const claim of queueSnapshot.activeClaims || []) {
      const existing = liveProblemStateById[claim.problemId];
      liveProblemStateById[claim.problemId] = {
        activeClaim: claim,
        researchCount: existing?.researchCount ?? 0,
        lastResearchAt: existing?.lastResearchAt ?? null,
        hasSubmissions: existing?.hasSubmissions ?? false,
      };
    }
  }

  return (
    <Box minH="100vh" bg="app.bg" color="app.text">
      <Header />

      <SearchBar
        search={search}
        onSearch={setSearch}
        onRandom={pickRandom}
        onAbout={() => setShowAbout(true)}
        showSearch={!!activeCategory}
        placeholder={activeCategory ? `Search in ${activeCategory}...` : "Filter..."}
      />

      <Box pt={8}>
        {!activeCategory ? (
          <>
            <CategoryGrid
              categories={CATEGORIES}
              loaded={loadedCategories}
              onSelect={selectCategory}
            />
            <AgentLaunchCard />
          </>
        ) : activeType === "news" ? (
          <NewsFeed
            news={preloadedNews}
            loading={false}
            error={null}
            search={search}
            onBack={goBack}
          />
        ) : activeType === "cases" && activeCases ? (
          <CaseFeed
            feed={activeCases}
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
            liveProblemStateById={liveProblemStateById}
          />
        )}
      </Box>

      <RandomModal
        problem={randomProblem}
        isOpen={showRandom}
        onNext={pickRandom}
        onClose={() => setShowRandom(false)}
        liveProblemState={randomProblem ? liveProblemStateById[randomProblem.id] ?? null : null}
      />

      <AboutModal
        isOpen={showAbout}
        onClose={() => setShowAbout(false)}
        totalProblems={Object.values(categories).flat().reduce((n, s) => n + s.problems.length, 0)}
        totalCategories={Object.keys(categories).length}
        enrichedCount={Object.keys(enrichments).length}
      />
    </Box>
  );
}
