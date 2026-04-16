import { SimpleGrid, Box, Text, Button, Flex } from '@chakra-ui/react';

interface CategoryGridProps {
  categories: Record<string, any>;
  loaded: Record<string, number>;
  onSelect: (key: string) => void;
}

export default function CategoryGrid({ categories, loaded, onSelect }: CategoryGridProps) {
  const keys = Object.keys(categories);
  const cols = 3;
  const remainder = keys.length % cols;
  const fillers = remainder === 0 ? 0 : cols - remainder;

  return (
    <Box maxW="860px" mx="auto" px={6} pb={16}>
      <SimpleGrid
        columns={{ base: 1, md: 2, lg: 3 }}
        spacing={0}
        border="1px solid"
        borderColor="app.border"
        borderRadius="md"
        overflow="hidden"
        bg="app.border"
      >
        {keys.map((key, i) => (
          <Button
            key={key}
            onClick={() => onSelect(key)}
            variant="ghost"
            display="flex"
            alignItems="baseline"
            justifyContent="flex-start"
            gap={3}
            p={5}
            h="auto"
            bg="app.bgCard"
            _hover={{ bg: "app.bgHover" }}
            borderRadius={0}
            border="none"
          >
            <Text
              fontFamily="mono"
              fontSize="0.72rem"
              color="app.textDim"
              minW="22px"
            >
              {String(i + 1).padStart(2, "0")}
            </Text>
            <Flex direction="column" align="flex-start" gap={0.5}>
              <Text
                fontFamily="heading"
                fontWeight="400"
                color="app.textBright"
                fontSize="1rem"
                textTransform="capitalize"
              >
                {key}
              </Text>
              <Text fontSize="0.76rem" color="app.textDim" fontWeight="normal">
                {categories[key].type === "news"
                  ? "Latest breakthroughs"
                  : categories[key].type === "cases"
                  ? loaded[key]
                    ? `${loaded[key]} public listings`
                    : "Official public listings"
                  : loaded[key]
                  ? `${loaded[key]} open problems`
                  : "Select to browse"}
              </Text>
            </Flex>
          </Button>
        ))}
        {Array.from({ length: fillers }).map((_, i) => (
          <Box key={`filler-${i}`} bg="app.bgCard" p={5} />
        ))}
      </SimpleGrid>
    </Box>
  );
}
