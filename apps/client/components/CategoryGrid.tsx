import { Box, Button, Flex, SimpleGrid, Text } from "@chakra-ui/react";
import type { CategoryManifestEntry } from "../lib/manifest";

interface CategoryGridProps {
	categories: Record<string, CategoryManifestEntry>;
	loaded: Record<string, number>;
	onSelect: (key: string) => void;
}

export default function CategoryGrid({
	categories,
	loaded,
	onSelect,
}: CategoryGridProps) {
	const keys = Object.keys(categories);
	const cols = 3;
	const remainder = keys.length % cols;
	const fillers = remainder === 0 ? 0 : cols - remainder;

	return (
		<Box maxW="860px" mx="auto" px={6} pb={16}>
			<SimpleGrid
				columns={{ base: 1, md: 2, lg: 3 }}
				gap={0}
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
								display="flex"
								alignItems="center"
								gap={2}
							>
								{categories[key].presentation?.emoji && (
									<Text as="span" fontSize="0.95rem">
										{categories[key].presentation?.emoji}
									</Text>
								)}
								{categories[key].label}
							</Text>
							<Text fontSize="0.76rem" color="app.textDim" fontWeight="normal">
								{categories[key].presentation?.description
									? `${categories[key].presentation.description} · `
									: ""}
								{categories[key].type === "news"
									? `${loaded[key] ?? 0} articles`
									: categories[key].type === "cases"
										? `${loaded[key] ?? 0} public listings`
										: `${loaded[key] ?? 0} open problems`}
							</Text>
						</Flex>
					</Button>
				))}
				{["a", "b"].slice(0, fillers).map((id) => (
					<Box key={`filler-${id}`} bg="app.bgCard" p={5} />
				))}
			</SimpleGrid>
		</Box>
	);
}
