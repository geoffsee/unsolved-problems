import { useState } from "react";
import { Badge, Box, Button, Flex, Heading, Text } from "@chakra-ui/react";

const launcherScript = [
  'export OPENAI_API_KEY="your_api_key_here"',
  'curl -fsSL "https://raw.githubusercontent.com/geoffsee/unsolved-problems/master/apps/example/claim-problem-agent.sh" | bash',
].join("\n");

export default function AgentLaunchCard() {
  const [copied, setCopied] = useState(false);

  const copyScript = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(launcherScript);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Box maxW="860px" mx="auto" px={6} pt={6}>
      <Box
        position="relative"
        overflow="hidden"
        border="1px solid"
        borderColor="app.borderLight"
        bg="linear-gradient(180deg, rgba(30,30,38,0.96) 0%, rgba(18,18,24,0.98) 100%)"
        boxShadow="0 24px 60px rgba(0, 0, 0, 0.3)"
      >
        <Box
          position="absolute"
          inset={0}
          bg="radial-gradient(circle at top right, rgba(138,155,181,0.2), transparent 40%)"
          pointerEvents="none"
        />
        <Flex
          position="relative"
          direction={{ base: "column", lg: "row" }}
          align={{ base: "stretch", lg: "center" }}
          justify="space-between"
          gap={5}
          p={{ base: 4, md: 5 }}
        >
          <Box flex="1 1 0">
            <Flex align="center" gap={2} mb={3} wrap="wrap">
              <Badge bg="app.bgHover" color="app.accent" textTransform="uppercase" letterSpacing="0.08em">
                Agent Launch
              </Badge>
              <Badge bg="rgba(127, 255, 172, 0.12)" color="#92d6a3" textTransform="none">
                MCP wired
              </Badge>
            </Flex>
            <Heading
              as="h2"
              fontFamily="heading"
              fontWeight="400"
              color="app.textBright"
              fontSize={{ base: "1.2rem", md: "1.45rem" }}
              lineHeight="1.2"
              mb={2}
            >
              Send a CLI agent after one of these problems
            </Heading>
            <Text color="app.text" fontSize="0.92rem" lineHeight="1.7" maxW="33rem">
              This shell bootstrap installs a minimal local runner, connects it to the deployed MCP server, claims an
              available problem, and writes back an initial research note so partial work does not disappear.
            </Text>
          </Box>

          <Box
            flex="0 1 420px"
            border="1px solid"
            borderColor="rgba(255,255,255,0.08)"
            bg="#0b0d11"
            minW={0}
          >
            <Flex align="center" justify="space-between" px={3.5} py={2.5} borderBottom="1px solid" borderColor="rgba(255,255,255,0.08)">
              <Flex gap={1.5}>
                <Box w={2.5} h={2.5} borderRadius="full" bg="#f7768e" />
                <Box w={2.5} h={2.5} borderRadius="full" bg="#e0af68" />
                <Box w={2.5} h={2.5} borderRadius="full" bg="#9ece6a" />
              </Flex>
              <Text fontFamily="mono" fontSize="0.7rem" color="app.textDim">
                shell
              </Text>
            </Flex>
            <Box as="pre" m={0} px={4} py={4} overflowX="auto" fontFamily="mono" fontSize="0.76rem" lineHeight="1.8" color="#d9e0ee">
              <Text as="code" whiteSpace="pre" display="block">
                <Text as="span" color="#7aa2f7">
                  ${" "}
                </Text>
                export OPENAI_API_KEY=
                <Text as="span" color="#9ece6a">
                  "your_api_key_here"
                </Text>
                {"\n"}
                <Text as="span" color="#7aa2f7">
                  ${" "}
                </Text>
                curl -fsSL{" "}
                <Text as="span" color="#e0af68">
                  "https://raw.githubusercontent.com/geoffsee/unsolved-problems/master/apps/example/claim-problem-agent.sh"
                </Text>{" "}
                | bash
              </Text>
            </Box>
            <Flex align="center" justify="space-between" px={4} pb={4} gap={3} wrap="wrap">
              <Text color="app.textDim" fontSize="0.72rem">
                Uses the OpenAI Agents SDK example under <Text as="span" fontFamily="mono">apps/example</Text>.
              </Text>
              <Button
                size="sm"
                variant="outline"
                bg="transparent"
                color={copied ? "#92d6a3" : "app.accent"}
                borderColor={copied ? "#92d6a3" : "app.borderLight"}
                _hover={{ bg: "transparent", borderColor: "app.accent", color: "app.accentHover" }}
                onClick={copyScript}
              >
                {copied ? "Copied" : "Copy Script"}
              </Button>
            </Flex>
          </Box>
        </Flex>
      </Box>
    </Box>
  );
}
