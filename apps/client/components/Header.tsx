import { Box, Heading, Text } from '@chakra-ui/react';

export default function Header() {
  return (
    <Box as="header" textAlign="center" pt="56px" px={6} pb={3} borderBottom="1px solid" borderColor="app.border" maxW="860px" mx="auto" mb={8}>
      <Heading as="h1" fontFamily="heading" fontSize={{ base: "1.5rem", md: "2rem" }} fontWeight="400" color="app.textBright" letterSpacing="-0.3px" lineHeight="1.3">
        Unsolved Problems Explorer
      </Heading>
      <Text color="app.textDim" fontSize="0.88rem" mt={2} pb={5} lineHeight="1.5" letterSpacing="0.2px">
        A curated index of open questions across scientific disciplines,
        sourced from Wikipedia&rsquo;s peer-reviewed problem lists.
      </Text>
    </Box>
  );
}
