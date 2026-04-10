import { Box, Flex, Text, Link, Heading, SimpleGrid, Button } from '@chakra-ui/react';

interface NewsSource {
  domain: string;
  url: string;
}

interface NewsItem {
  title: string;
  sources: NewsSource[];
  seendate: string;
}

interface NewsFeedProps {
  news: NewsItem[];
  loading: boolean;
  error: string | null;
  search: string;
  onBack: () => void;
}

export default function NewsFeed({ news, loading, error, search, onBack }: NewsFeedProps) {
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const filteredNews = news.filter((item) => {
    const q = search.toLowerCase();
    return item.title.toLowerCase().includes(q) ||
      item.sources.some((s) => s.domain.toLowerCase().includes(q));
  });

  return (
    <Box maxW="860px" mx="auto" px={6} pb="80px">
      <Flex align="baseline" gap={4} mb={6} wrap="wrap" direction={{ base: "column", md: "row" }}>
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
          Frontier Research News
        </Heading>
      </Flex>
      
      {loading && <Text color="app.textDim">Fetching latest breakthroughs...</Text>}
      {error && <Text color="app.error">{error}</Text>}
      
      {!loading && !error && (
        <Flex direction="column" gap={6}>
          {filteredNews.length === 0 ? (
            <Text color="app.textDim">{news.length === 0 ? "No recent news found." : "No matching news found."}</Text>
          ) : (
            filteredNews.map((item, i) => (
              <Box key={i} pb={6} borderBottom="1px solid" borderColor="app.border">
                <Link
                  href={item.sources[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  fontSize="1.1rem"
                  color="app.textBright"
                  display="block"
                  mb={2}
                  lineHeight="1.4"
                  _hover={{ color: "app.accent", textDecoration: "none" }}
                >
                  {item.title}
                </Link>
                <Box fontSize="0.8rem" color="app.textDim" mb={2}>
                  <Text as="span">{formatDate(item.seendate)}</Text>
                </Box>
                <Flex wrap="wrap" gap={1.5} mt={2.5}>
                  {item.sources.map((s) => (
                    <Link
                      key={s.domain}
                      href={s.url}
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
                      {s.domain}
                    </Link>
                  ))}
                </Flex>
              </Box>
            ))
          )}
        </Flex>
      )}
    </Box>
  );
}
