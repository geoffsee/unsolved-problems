import { useState } from "react";
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

interface ProblemItemExpandedProps {
  text: string;
  index: number;
}

function ProblemItemExpanded({ text, index }: ProblemItemExpandedProps) {
  const enrichment = getEnrichment(text);
  const [expanded, setExpanded] = useState(false);

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
      cursor={enrichment ? "pointer" : "default"}
      _hover={{
        borderLeftColor: "app.accent",
        bg: "app.bgHover",
      }}
      onClick={() => enrichment && setExpanded(!expanded)}
    >
      <Text as="span" fontFamily="mono" color="app.textDim" fontSize="0.72rem" mr={2.5}>
        {index + 1}.
      </Text>
      {text}
      {expanded && enrichment && (
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
          <Text color="app.textBright" mb={1.5}>
            {enrichment.summary}
          </Text>
          <Text color="app.text" mb={2}>
            {enrichment.significance}
          </Text>
          <Flex align="center" gap={3} wrap="wrap">
            {enrichment.field && (
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
            {enrichment.yearProposed && (
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
          </Flex>
        </Box>
      )}
    </Box>
  );
}

interface SectionProps {
  heading: string;
  problems: string[];
  defaultOpen: boolean;
}

function Section({ heading, problems, defaultOpen }: SectionProps) {
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
        px={0}
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
            <ProblemItemExpanded key={i} text={p} index={i} />
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
              heading={sec.heading}
              problems={sec.problems}
              defaultOpen={i === 0}
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
