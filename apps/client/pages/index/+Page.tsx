import { Box } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "vike-react/useData";
import AboutModal from "../../components/AboutModal";
import AgentLaunchCard from "../../components/AgentLaunchCard";
import AuthPanel from "../../components/AuthPanel";
import CaseFeed from "../../components/CaseFeed";
import CategoryGrid from "../../components/CategoryGrid";
import ContributionsFeed, {
	type ContributionProblem,
} from "../../components/ContributionsFeed";
import Header from "../../components/Header";
import NewsFeed from "../../components/NewsFeed";
import ProblemsView from "../../components/ProblemsView";
import RandomModal from "../../components/RandomModal";
import SearchBar from "../../components/SearchBar";
import {
	fetchQueueSnapshot,
	type LiveProblemState,
	type QueueSnapshot,
} from "../../lib/agentResearch";
import type { CaseCategoryData } from "../../lib/cases";
import type {
	CategoryManifest,
	CategoryManifestEntry,
	NewsCategoryData,
} from "../../lib/manifest";
import { makeProblemId } from "../../lib/problemIds";
import {
	type EnrichmentProblem,
	type Section,
	setEnrichments,
} from "../../lib/wiki";

interface RandomProblem {
	id: string;
	category: string;
	section: string;
	text: string;
}

export default function Page() {
	const {
		manifest,
		categories,
		enrichments,
		news: preloadedNews,
		cases: preloadedCases,
	} = useData<{
		manifest: CategoryManifest;
		categories: Record<string, Section[]>;
		enrichments: Record<string, EnrichmentProblem>;
		news: Record<string, NewsCategoryData>;
		cases: Record<string, CaseCategoryData>;
	}>();

	// Initialize enrichments from prerendered data
	useEffect(() => {
		setEnrichments(enrichments);
	}, [enrichments]);

	// Compute problem counts from prerendered data
	const loadedCategories: Record<string, number> = {};
	for (const [key, entry] of Object.entries(manifest.categories)) {
		if (entry.type === "problems") {
			loadedCategories[key] = (categories[key] || []).reduce(
				(n, s) => n + s.problems.length,
				0,
			);
		} else if (entry.type === "news") {
			loadedCategories[key] =
				preloadedNews[key]?.totalArticles ??
				preloadedNews[key]?.articles.length ??
				0;
		} else {
			loadedCategories[key] = preloadedCases[key]?.total ?? 0;
		}
	}

	const [activeCategory, setActiveCategory] = useState<string | null>(null);
	const [showContributions, setShowContributions] = useState(false);
	const [focusedProblemId, setFocusedProblemId] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [showRandom, setShowRandom] = useState(false);
	const [randomProblem, setRandomProblem] = useState<RandomProblem | null>(
		null,
	);
	const [showAbout, setShowAbout] = useState(false);
	const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot | null>(
		null,
	);
	const [queueLoading, setQueueLoading] = useState(true);
	const [queueError, setQueueError] = useState<string | null>(null);
	const [queueRefreshKey, setQueueRefreshKey] = useState(0);

	const contributionProblemsById = useMemo(() => {
		const lookup: Record<string, ContributionProblem> = {};

		for (const [category, categorySections] of Object.entries(categories)) {
			for (const section of categorySections) {
				for (const text of section.problems) {
					const id = makeProblemId(category, section.heading, text);
					lookup[id] = { id, category, section: section.heading, text };
				}
			}
		}

		return lookup;
	}, [categories]);
	const categoryLabels = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(manifest.categories).map(([key, category]) => [
					key,
					category.label,
				]),
			),
		[manifest],
	);

	const sections =
		activeCategory && categories[activeCategory]
			? categories[activeCategory]
			: [];

	const selectCategory = useCallback((key: string) => {
		setActiveCategory(key);
		setShowContributions(false);
		setFocusedProblemId(null);
		setSearch("");
	}, []);

	const goBack = () => {
		setActiveCategory(null);
		setShowContributions(false);
		setFocusedProblemId(null);
		setSearch("");
	};

	const showResearchActivity = useCallback(() => {
		setShowContributions(true);
		setActiveCategory(null);
		setFocusedProblemId(null);
		setSearch("");
	}, []);

	const viewContributionProblem = useCallback(
		(problem: ContributionProblem) => {
			setActiveCategory(problem.category);
			setShowContributions(false);
			setFocusedProblemId(problem.id);
			setSearch("");
		},
		[],
	);

	const updateSearch = useCallback((value: string) => {
		setFocusedProblemId(null);
		setSearch(value);
	}, []);

	const pickRandom = useCallback(() => {
		const pool: RandomProblem[] = [];
		for (const [k, secs] of Object.entries(categories)) {
			if (manifest.categories[k]?.type !== "problems") continue;
			for (const sec of secs) {
				for (const p of sec.problems) {
					pool.push({
						id: makeProblemId(k, sec.heading, p),
						category: k,
						section: sec.heading,
						text: p,
					});
				}
			}
		}

		if (pool.length === 0) {
			setRandomProblem(null);
			setShowRandom(false);
			return;
		}

		setRandomProblem(pool[Math.floor(Math.random() * pool.length)] ?? null);
		setShowRandom(true);
	}, [categories, manifest]);

	useEffect(() => {
		void queueRefreshKey;
		const controller = new AbortController();

		setQueueLoading(true);
		setQueueError(null);
		fetchQueueSnapshot(controller.signal)
			.then(setQueueSnapshot)
			.catch((error) => {
				if (error instanceof DOMException && error.name === "AbortError")
					return;
				setQueueError(
					"The live contribution service did not respond. The catalog itself is still available.",
				);
			})
			.finally(() => {
				if (!controller.signal.aborted) setQueueLoading(false);
			});

		return () => controller.abort();
	}, [queueRefreshKey]);

	const filteredSections = sections
		.map((sec) => ({
			...sec,
			problems: sec.problems.filter((p: string) =>
				p.toLowerCase().includes(search.toLowerCase()),
			),
		}))
		.filter((sec) => sec.problems.length > 0);

	const totalProblems = sections.reduce((n, s) => n + s.problems.length, 0);

	const activeEntry: CategoryManifestEntry | null = activeCategory
		? (manifest.categories[activeCategory] ?? null)
		: null;
	const activeType = activeEntry?.type ?? null;
	const activeCases =
		activeCategory && activeType === "cases"
			? preloadedCases[activeCategory]
			: null;
	const liveProblemStateById: Record<string, LiveProblemState> = {};

	if (queueSnapshot) {
		for (const [problemId, researchCount] of Object.entries(
			queueSnapshot.researchCountsByProblemId || {},
		)) {
			liveProblemStateById[problemId] = {
				activeClaim: null,
				researchCount,
				lastResearchAt:
					queueSnapshot.lastResearchAtByProblemId?.[problemId] ?? null,
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
				onSearch={updateSearch}
				onRandom={pickRandom}
				onAbout={() => setShowAbout(true)}
				onContributions={showResearchActivity}
				showSearch={!!activeCategory || showContributions}
				placeholder={
					activeCategory
						? `Search in ${activeEntry?.label ?? activeCategory}...`
						: showContributions
							? "Search questions, findings, agents, or sources..."
							: "Filter..."
				}
			/>

			<Box pt={8}>
				{showContributions ? (
					<ContributionsFeed
						submissions={queueSnapshot?.submissions || []}
						researchEntries={queueSnapshot?.recentResearchEntries || []}
						researchCountsByProblemId={
							queueSnapshot?.researchCountsByProblemId || {}
						}
						lastResearchAtByProblemId={
							queueSnapshot?.lastResearchAtByProblemId || {}
						}
						activeClaims={queueSnapshot?.activeClaims || []}
						problemsById={contributionProblemsById}
						categoryLabels={categoryLabels}
						search={search}
						loading={queueLoading}
						error={queueError}
						onRetry={() => setQueueRefreshKey((value) => value + 1)}
						onBack={goBack}
						onViewProblem={viewContributionProblem}
					/>
				) : !activeCategory ? (
					<>
						<CategoryGrid
							categories={manifest.categories}
							loaded={loadedCategories}
							onSelect={selectCategory}
						/>
						<AuthPanel />
						<AgentLaunchCard />
					</>
				) : activeType === "news" && activeEntry ? (
					<NewsFeed
						feed={preloadedNews[activeCategory]}
						category={activeEntry}
						loading={false}
						error={null}
						search={search}
						onBack={goBack}
					/>
				) : activeType === "cases" && activeCases && activeEntry ? (
					<CaseFeed
						feed={activeCases}
						category={activeEntry}
						search={search}
						onBack={goBack}
					/>
				) : activeType === "problems" && activeEntry ? (
					<ProblemsView
						categoryKey={activeCategory}
						category={activeEntry}
						sections={filteredSections}
						totalProblems={totalProblems}
						loading={false}
						error={null}
						search={search}
						onBack={goBack}
						liveProblemStateById={liveProblemStateById}
						focusedProblemId={focusedProblemId}
					/>
				) : (
					<Box maxW="860px" mx="auto" px={6} pb="80px" color="app.error">
						This category is not present in the active catalog manifest.
					</Box>
				)}
			</Box>

			<RandomModal
				problem={randomProblem}
				categoryLabel={
					randomProblem
						? manifest.categories[randomProblem.category]?.label
						: undefined
				}
				isOpen={showRandom}
				onNext={pickRandom}
				onClose={() => setShowRandom(false)}
				liveProblemState={
					randomProblem
						? (liveProblemStateById[randomProblem.id] ?? null)
						: null
				}
			/>

			<AboutModal
				isOpen={showAbout}
				onClose={() => setShowAbout(false)}
				totalProblems={Object.values(categories)
					.flat()
					.reduce((n, s) => n + s.problems.length, 0)}
				manifest={manifest}
				enrichedCount={Object.keys(enrichments).length}
			/>
		</Box>
	);
}
