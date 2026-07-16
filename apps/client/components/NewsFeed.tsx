import { Box, Button, Flex, Heading, Link, Text } from "@chakra-ui/react";
import {
	type CategoryManifestEntry,
	categorySourceUrl,
	type NewsCategoryData,
} from "../lib/manifest";

interface NewsFeedProps {
	feed?: NewsCategoryData;
	category: CategoryManifestEntry | null;
	loading: boolean;
	error: string | null;
	search: string;
	onBack: () => void;
}

export default function NewsFeed({
	feed,
	category,
	loading,
	error,
	search,
	onBack,
}: NewsFeedProps) {
	const news = feed?.articles ?? [];
	const label = category?.label || feed?.label || "News";
	const sourceUrl =
		(category ? categorySourceUrl(category) : null) || feed?.sourceUrl;
	const formatDate = (dateStr: string) => {
		try {
			return new Date(dateStr).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
		} catch {
			return dateStr;
		}
	};

	const filteredNews = news.filter((item) => {
		const q = search.toLowerCase();
		return (
			item.title.toLowerCase().includes(q) ||
			item.sources.some((s) => s.domain.toLowerCase().includes(q))
		);
	});

	return (
		<Box maxW="860px" mx="auto" px={6} pb="80px">
			<Flex
				align="baseline"
				gap={4}
				mb={6}
				wrap="wrap"
				direction={{ base: "column", md: "row" }}
			>
				<Button
					variant="plain"
					onClick={onBack}
					color="app.accent"
					fontSize="0.84rem"
					textDecoration="underline"
					_hover={{ color: "app.textBright" }}
				>
					&larr; Back to Categories
				</Button>
				<Heading
					as="h2"
					fontSize="1.35rem"
					fontWeight="400"
					color="app.textBright"
					flex="1"
				>
					{label}
				</Heading>
				{sourceUrl && (
					<Link
						href={sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						fontSize="0.78rem"
						color="app.textDim"
						textDecoration="underline"
						_hover={{ color: "app.accent" }}
					>
						{category?.presentation?.sourceLabel || "Source"}
					</Link>
				)}
			</Flex>

			{loading && <Text color="app.textDim">Loading {label}...</Text>}
			{error && <Text color="app.error">{error}</Text>}

			{!loading && !error && (
				<Flex direction="column" gap={6}>
					{filteredNews.length === 0 ? (
						<Text color="app.textDim">
							{news.length === 0
								? "No recent news found."
								: "No matching news found."}
						</Text>
					) : (
						filteredNews.map((item) => (
							<Box
								key={`${item.seendate}:${item.title}:${item.sources[0]?.url ?? ""}`}
								pb={6}
								borderBottom="1px solid"
								borderColor="app.border"
							>
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
											_hover={{
												bg: "rgba(138, 155, 181, 0.08)",
												borderColor: "app.accent",
												textDecoration: "none",
											}}
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
