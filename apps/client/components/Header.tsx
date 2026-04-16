import {Box, Heading, Text} from '@chakra-ui/react';

export default function Header() {
    return (
        <Box as="header" textAlign="center" pt="56px" px={6} pb={3} borderBottom="1px solid" borderColor="app.border"
             maxW="860px" mx="auto" mb={0}>
            <Heading as="h1" fontFamily="heading" fontSize={{base: "1.5rem", md: "2rem"}} fontWeight="400"
                     color="app.textBright" letterSpacing="-0.3px" lineHeight="1.3">
                Catalog of the Unsolved
            </Heading>
            <Text color="app.textDim" fontSize="0.88rem" mt={2} pb={5} lineHeight="1.5" letterSpacing="0.2px">
                A curated index of open questions across scientific disciplines, with frontier research tracking and
                official FBI ViCAP case listings. Updates daily at midnight.
            </Text>
        </Box>
    );
}
