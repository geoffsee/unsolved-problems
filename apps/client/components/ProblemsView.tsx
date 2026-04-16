import { useEffect, useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Button,
  Link,
  Spinner,
  Badge,
} from "@chakra-ui/react";
import { getEnrichment } from "../lib/wiki";
import { fetchProblemResearch, type LiveProblemState, type ResearchEntry } from "../lib/agentResearch";
import { makeProblemId } from "../lib/problemIds";

interface ProblemItemExpandedProps {
  categoryKey: string;
  section: string;
  text: string;
  index: number;
  liveProblemState: LiveProblemState | null;
}

function ProblemItemExpanded({ categoryKey, section, text, index, liveProblemState }: ProblemItemExpandedProps) {
  const enrichment = getEnrichment(text);
  const [expanded, setExpanded] = useState(false);
  const [researchEntries, setResearchEntries] = useState<ResearchEntry[] | null>(null);
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const problemId = makeProblemId(categoryKey, section, text);
  const canExpand = Boolean(enrichment || liveProblemState?.activeClaim || liveProblemState?.researchCount || liveProblemState?.hasSubmissions);

  useEffect(() => {
    if (!expanded || researchEntries || loadingResearch) return;

    const controller = new AbortController();
    let cancelled = false;
    setLoadingResearch(true);
    setResearchError(null);

    fetchProblemResearch(problemId, controller.signal)
      .then((entries) => {
        if (cancelled) return;
        setResearchEntries(entries);
      })
      .catch((error) => {
        if (cancelled || error instanceof DOMException && error.name === "AbortError") return;
        setResearchError("Research history is unavailable right now.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingResearch(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [expanded, problemId, researchEntries]);

  return (
    <Box
      as="li"
      px={4}
      py={2.5}
      fontSize="0.88rem"
      lineHeight="1.65"
      color="app.text"
      borderLeft="2px solid"
      borderLeftColor={expanded && enrichment ? "app.accent" : "transparent"}
      transition="all 0.15s"
      cursor={canExpand ? "pointer" : "default"}
      _hover={{
        borderLeftColor: "app.accent",
        bg: "app.bgHover",
      }}
      onClick={() => canExpand && setExpanded(!expanded)}
    >
      <Flex align="center" gap={2} wrap="wrap">
        <Text as="span" fontFamily="mono" color="app.textDim" fontSize="0.72rem" mr={0.5}>
          {index + 1}.
        </Text>
        <Text as="span">{text}</Text>
        {liveProblemState?.activeClaim && (
          <Badge bg="orange.100" color="orange.800" textTransform="none">
            Agent working
          </Badge>
        )}
        {(liveProblemState?.researchCount ?? 0) > 0 && (
          <Badge bg="blue.100" color="blue.800" textTransform="none">
            {liveProblemState?.researchCount} notes
          </Badge>
        )}
        {liveProblemState?.hasSubmissions && (
          <Badge bg="green.100" color="green.800" textTransform="none">
            Prior submission
          </Badge>
        )}
      </Flex>
      {expanded && (
        <Box
          mt={2.5}
          p={3.5}
          bg="app.bgSection"
          border="1px solid"
          borderColor="app.border"
          borderRadius="sm"
          fontSize="0.82rem"
          lineHeight="1.6"
        >
          {enrichment && (
            <>
              <Text color="app.textBright" mb={1.5}>
                {enrichment.summary}
              </Text>
              <Text color="app.text" mb={2}>
                {enrichment.significance}
              </Text>
            </>
          )}
          {liveProblemState && (liveProblemState.activeClaim || liveProblemState.researchCount > 0 || liveProblemState.hasSubmissions) && (
            <Box mb={3}>
              <Flex align="center" gap={2} wrap="wrap" mb={liveProblemState.activeClaim ? 1.5 : 0}>
                {liveProblemState.activeClaim && (
                  <Badge bg="orange.100" color="orange.800" textTransform="none">
                    Claimed by {liveProblemState.activeClaim.agentId}
                  </Badge>
                )}
                {(liveProblemState.researchCount ?? 0) > 0 && (
                  <Badge bg="blue.100" color="blue.800" textTransform="none">
                    {liveProblemState.researchCount} research entries
                  </Badge>
                )}
                {liveProblemState.hasSubmissions && (
                  <Badge bg="green.100" color="green.800" textTransform="none">
                    Candidate solution exists
                  </Badge>
                )}
              </Flex>
              {liveProblemState.lastResearchAt && (
                <Text color="app.textDim" fontSize="0.72rem">
                  Last research update: {new Date(liveProblemState.lastResearchAt).toLocaleString()}
                </Text>
              )}
            </Box>
          )}
          {(loadingResearch || researchError || (researchEntries && researchEntries.length > 0)) && (
            <Box mb={3} p={3} bg="app.bgCard" border="1px solid" borderColor="app.border">
              <Text color="app.textBright" fontSize="0.76rem" mb={2} textTransform="uppercase" letterSpacing="0.5px">
                Agent Research
              </Text>
              {loadingResearch && (
                <Text color="app.textDim" fontSize="0.78rem">
                  Loading research history...
                </Text>
              )}
              {researchError && (
                <Text color="app.textDim" fontSize="0.78rem">
                  {researchError}
                </Text>
              )}
              {researchEntries && researchEntries.length > 0 && (
                <Box>
                  {researchEntries.slice(-3).reverse().map((entry) => (
                    <Box key={entry.entryId} mb={2.5} pb={2.5} borderBottom="1px solid" borderColor="app.border">
                      <Flex gap={2} wrap="wrap" mb={1}>
                        <Badge bg="app.bgHover" color="app.textDim" textTransform="none" fontFamily="mono">
                          {entry.kind}
                        </Badge>
                        <Badge bg="app.bgHover" color="app.textDim" textTransform="none">
                          {entry.agentId}
                        </Badge>
                      </Flex>
                      {entry.title && (
                        <Text color="app.textBright" fontSize="0.8rem" mb={1}>
                          {entry.title}
                        </Text>
                      )}
                      <Text color="app.text" fontSize="0.78rem" mb={1}>
                        {entry.content}
                      </Text>
                      <Text color="app.textDim" fontSize="0.7rem">
                        {new Date(entry.createdAt).toLocaleString()}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
          <Flex align="center" gap={3} wrap="wrap">
            {enrichment?.field && (
              <Badge
                variant="subtle"
                bg="app.bgHover"
                color="app.textDim"
                px={2}
                py={0.5}
                borderRadius="full"
                fontSize="0.7rem"
                fontFamily="mono"
                textTransform="none"
              >
                {enrichment.field}
              </Badge>
            )}
            {enrichment?.yearProposed && (
              <Badge
                variant="subtle"
                bg="app.bgHover"
                color="app.textDim"
                px={2}
                py={0.5}
                borderRadius="full"
                fontSize="0.7rem"
                fontFamily="mono"
                textTransform="none"
              >
                {enrichment.yearProposed}
              </Badge>
            )}
            {enrichment && (
              <Text
                as="span"
                fontFamily="mono"
                fontSize="0.62rem"
                color="app.textDim"
                ml="auto"
                letterSpacing="0.5px"
                textTransform="uppercase"
              >
                AI-generated
              </Text>
            )}
          </Flex>
        </Box>
      )}
    </Box>
  );
}

interface SectionProps {
  categoryKey: string;
  heading: string;
  problems: string[];
  defaultOpen: boolean;
  liveProblemStateById: Record<string, LiveProblemState>;
}

function Section({ categoryKey, heading, problems, defaultOpen, liveProblemStateById }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box mb={2}>
      <Button
        variant="ghost"
        w="100%"
        justifyContent="flex-start"
        textAlign="left"
        borderBottom="1px solid"
        borderColor="app.border"
        py={3}
        px={3}
        h="auto"
        color="app.textBright"
        fontFamily="heading"
        fontSize="0.95rem"
        fontWeight="400"
        borderRadius={0}
        onClick={() => setOpen(!open)}
        _hover={{ color: "app.accentHover", bg: "transparent" }}
        display="flex"
        alignItems="center"
        gap={2}
      >
        <Text
          as="span"
          fontSize="0.6rem"
          color="app.textDim"
          transition="transform 0.2s"
          transform={open ? "rotate(90deg)" : "rotate(0)"}
        >
          &#9654;
        </Text>
        {heading}
        <Text
          as="span"
          ml="auto"
          fontFamily="mono"
          fontSize="0.72rem"
          color="app.textDim"
        >
          {problems.length}
        </Text>
      </Button>
      {open && (
        <Box as="ol" listStyleType="none" py={2}>
          {problems.map((p, i) => (
            <ProblemItemExpanded
              key={i}
              categoryKey={categoryKey}
              section={heading}
              text={p}
              index={i}
              liveProblemState={liveProblemStateById[makeProblemId(categoryKey, heading, p)] ?? null}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface ProblemsViewProps {
  categoryKey: string;
  category: any;
  sections: any[];
  totalProblems: number;
  loading: boolean;
  error: string | null;
  search: string;
  onBack: () => void;
  liveProblemStateById: Record<string, LiveProblemState>;
}

export default function ProblemsView({
  categoryKey,
  category,
  sections,
  totalProblems,
  loading,
  error,
  search,
  onBack,
  liveProblemStateById,
}: ProblemsViewProps) {
  const wikiUrl = `https://en.wikipedia.org/wiki/${category.page}`;

  return (
    <Box maxW="860px" mx="auto" px={6} pb="80px">
      <Flex align="baseline" gap={4} mb={1.5} wrap="wrap" direction={{ base: "column", md: "row" }}>
        <Button
          variant="link"
          onClick={onBack}
          color="app.accent"
          fontSize="0.84rem"
          textDecoration="underline"
          _hover={{ color: "app.accentHover" }}
        >
          &larr; All disciplines
        </Button>
        <Heading as="h2" fontFamily="heading" fontSize="1.35rem" fontWeight="400" color="app.textBright" textTransform="capitalize" flex={1}>
          {categoryKey}
        </Heading>
        <Link href={wikiUrl} isExternal fontSize="0.78rem" color="app.textDim" textDecoration="underline" _hover={{ color: "app.accent" }}>
          Source
        </Link>
      </Flex>

      {loading && (
        <Flex direction="column" align="center" py="60px">
          <Spinner color="app.accent" size="md" mb={3.5} />
          <Text color="app.textDim" fontSize="0.9rem">Loading from Wikipedia&hellip;</Text>
        </Flex>
      )}

      {error && (
        <Box textAlign="center" py={10} color="app.error" fontSize="0.9rem">
          {error}
        </Box>
      )}

      {!loading && !error && sections.length > 0 && (
        <>
          <Box fontSize="0.8rem" color="app.textDim" mb={6} pb={4} borderBottom="1px solid" borderColor="app.border">
            {totalProblems} problems &middot; {sections.length} sections
            {search && ` \u00B7 filtered`}
          </Box>
          {sections.map((sec, i) => (
            <Section
              key={sec.heading}
              categoryKey={categoryKey}
              heading={sec.heading}
              problems={sec.problems}
              defaultOpen={i === 0}
              liveProblemStateById={liveProblemStateById}
            />
          ))}
        </>
      )}

      {!loading && !error && sections.length === 0 && search && (
        <Box textAlign="center" py="60px" color="app.textDim" fontSize="0.9rem">
          No results for &ldquo;{search}&rdquo;
        </Box>
      )}
    </Box>
  );
}
