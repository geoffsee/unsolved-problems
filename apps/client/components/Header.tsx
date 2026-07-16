import { Box, Heading, Text } from "@chakra-ui/react";

export default function Header() {
	return (
		<Box
			as="header"
			textAlign="center"
			pt="56px"
			px={6}
			pb={3}
			maxW="860px"
			mx="auto"
			mb={0}
		>
			<Heading
				as="h1"
				fontFamily="heading"
				fontSize={{ base: "1.5rem", md: "2rem" }}
				fontWeight="400"
				color="app.textBright"
				letterSpacing="-0.3px"
				lineHeight="1.3"
			>
				open-questions
			</Heading>
			<Text
				color="app.textDim"
				fontSize="0.88rem"
				mt={2}
				pb={5}
				lineHeight="1.5"
				letterSpacing="0.2px"
			>
				<Text as="span" color="app.textBright" fontWeight="300">
					Open questions: Autonomously curated and enriched.
				</Text>
				<br />

				<Text
					fontSize={"2xs"}
					as="span"
					mt={"1rem"}
					color="app.textBright"
					fontWeight="100"
				>
					Open source | Updates daily at midnight
				</Text>
			</Text>
		</Box>
	);
}
