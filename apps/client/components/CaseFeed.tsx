import { Box, Flex, Text, Link, Heading, Button, Image } from "@chakra-ui/react";
import type { CaseCategoryData, CaseItem } from "../lib/cases";

interface CaseFeedProps {
  feed: CaseCategoryData;
  search: string;
  onBack: () => void;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function matchesSearch(item: CaseItem, query: string) {
  if (!query) return true;

  const haystack = [
    item.title,
    item.location || "",
    item.reportedDate || "",
    item.details || "",
    item.remarks || "",
    ...Object.entries(item.facts).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

export default function CaseFeed({ feed, search, onBack }: CaseFeedProps) {
  const query = search.toLowerCase().trim();
  const filtered = feed.items.filter((item) => matchesSearch(item, query));

  return (
    <Box maxW="860px" mx="auto" px={6} pb="80px">
      <Flex align="baseline" gap={4} mb={4} wrap="wrap" direction={{ base: "column", md: "row" }}>
        <Button
          variant="link"
          onClick={onBack}
          color="app.accent"
          fontSize="0.84rem"
          textDecoration="underline"
          _hover={{ color: "app.accentHover" }}
        >
          &larr; Back to Categories
        </Button>
        <Heading as="h2" fontSize="1.35rem" fontWeight="400" color="app.textBright" flex="1">
          {feed.label}
        </Heading>
      </Flex>

      <Box mb={6} p={4} bg="app.bgCard" border="1px solid" borderColor="app.border" borderRadius="md">
        <Text fontSize="0.82rem" color="app.textDim" lineHeight="1.7">
          {feed.disclaimer}
        </Text>
        <Text fontSize="0.78rem" color="app.textDim" mt={2}>
          Source:{" "}
          <Link href={feed.sourceUrl} target="_blank" rel="noopener noreferrer" color="app.accent">
            {feed.sourceSection}
          </Link>
          {" • "}
          {feed.total.toLocaleString()} public listings
          {feed.lastSuccessfulFetchAt ? ` • last successful fetch ${formatDate(feed.lastSuccessfulFetchAt)}` : ""}
        </Text>
        {!feed.fresh && feed.lastError && (
          <Text fontSize="0.78rem" color="app.error" mt={2}>
            Using the last known snapshot because the live source fetch failed: {feed.lastError}
          </Text>
        )}
      </Box>

      <Flex direction="column" gap={5}>
        {filtered.length === 0 ? (
          <Text color="app.textDim">
            {feed.items.length === 0 ? "No public listings are available right now." : "No matching cases found."}
          </Text>
        ) : (
          filtered.map((item) => {
            const factEntries = Object.entries(item.facts).slice(0, 4);
            const excerpt = item.details || item.remarks;
            const preview = excerpt && excerpt.length > 420 ? `${excerpt.slice(0, 417).trimEnd()}...` : excerpt;

            return (
              <Flex
                key={item.id}
                gap={4}
                pb={5}
                borderBottom="1px solid"
                borderColor="app.border"
                direction={{ base: "column", md: "row" }}
              >
                {item.imageUrl && (
                  <Image
                    src={item.imageUrl}
                    alt={item.title}
                    objectFit="cover"
                    borderRadius="md"
                    w={{ base: "100%", md: "120px" }}
                    h={{ base: "220px", md: "160px" }}
                    flexShrink={0}
                    bg="app.bgCard"
                  />
                )}

                <Box flex="1">
                  <Link
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    fontSize="1.05rem"
                    color="app.textBright"
                    display="block"
                    mb={2}
                    lineHeight="1.45"
                    _hover={{ color: "app.accent", textDecoration: "none" }}
                  >
                    {item.title}
                  </Link>

                  <Flex wrap="wrap" gap={2} mb={2}>
                    {item.reportedDate && (
                      <Text fontSize="0.76rem" color="app.textDim">
                        {item.reportedDate}
                      </Text>
                    )}
                    {item.location && (
                      <Text fontSize="0.76rem" color="app.textDim">
                        {item.location}
                      </Text>
                    )}
                  </Flex>

                  {preview && (
                    <Text fontSize="0.86rem" color="app.text" lineHeight="1.7" mb={3}>
                      {preview}
                    </Text>
                  )}

                  <Flex wrap="wrap" gap={1.5}>
                    {factEntries.map(([key, value]) => (
                      <Box
                        key={key}
                        px={2.5}
                        py={0.75}
                        borderRadius="full"
                        border="1px solid"
                        borderColor="app.border"
                        fontSize="0.72rem"
                        color="app.textDim"
                      >
                        {key}: {value}
                      </Box>
                    ))}
                    <Link
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      px={2.5}
                      py={0.75}
                      borderRadius="full"
                      fontSize="0.72rem"
                      fontWeight="500"
                      color="app.accent"
                      border="1px solid"
                      borderColor="app.border"
                      _hover={{ bg: "rgba(138, 155, 181, 0.08)", borderColor: "app.accent", textDecoration: "none" }}
                    >
                      {item.sourceName}
                    </Link>
                  </Flex>
                </Box>
              </Flex>
            );
          })
        )}
      </Flex>
    </Box>
  );
}
