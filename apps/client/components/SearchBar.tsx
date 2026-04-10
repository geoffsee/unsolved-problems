import { Box, Input, Button, Flex } from '@chakra-ui/react';

interface SearchBarProps {
  search: string;
  onSearch: (value: string) => void;
  onRandom: () => void;
  showSearch: boolean;
  placeholder?: string;
}

export default function SearchBar({ search, onSearch, onRandom, showSearch, placeholder }: SearchBarProps) {
  return (
    <Box
      position="sticky"
      top={0}
      zIndex={10}
      bg="app.bg"
      px={6}
      pt={2.5}
      pb={3.5}
      maxW="860px"
      mx="auto"
      borderBottom="1px solid"
      borderColor="app.border"
    >
      <Flex gap={2.5} align="center" direction={{ base: "column", md: "row" }}>
        {showSearch && (
          <Input
            flex={1}
            bg="app.bgCard"
            border="1px solid"
            borderColor="app.border"
            borderRadius="sm"
            px={3.5}
            py={2}
            fontSize="0.88rem"
            color="app.text"
            _focus={{ borderColor: "app.accent", boxShadow: "none" }}
            _placeholder={{ color: "app.textDim" }}
            type="text"
            placeholder={placeholder || "Filter..."}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            w="100%"
          />
        )}
        <Button
          variant="outline"
          bg="transparent"
          color="app.accent"
          border="1px solid"
          borderColor="app.border"
          borderRadius="sm"
          px={4.5}
          py={2}
          fontSize="0.85rem"
          fontWeight="normal"
          cursor="pointer"
          whiteSpace="nowrap"
          _hover={{ borderColor: "app.accent", color: "app.accentHover", bg: "transparent" }}
          onClick={onRandom}
          w={{ base: "100%", md: "auto" }}
          h="auto"
        >
          Random problem
        </Button>
      </Flex>
    </Box>
  );
}
