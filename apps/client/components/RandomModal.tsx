import {
  DialogRoot,
  DialogBackdrop,
  DialogPositioner,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogBody,
  DialogCloseTrigger,
  Button,
  Text,
  Box,
  Flex,
  Badge,
  Spinner,
} from '@chakra-ui/react';
import { getEnrichment } from '../lib/wiki';
import type { LiveProblemState } from '../lib/agentResearch';

interface Problem {
  id: string;
  category: string;
  section: string;
  text: string;
}

interface RandomModalProps {
  problem: Problem | null;
  isOpen: boolean;
  onNext: () => void;
  onClose: () => void;
  liveProblemState: LiveProblemState | null;
}

export default function RandomModal({ problem, isOpen, onNext, onClose, liveProblemState }: RandomModalProps) {
  const enrichment = problem ? getEnrichment(problem.text) : null;

  return (
    <DialogRoot open={isOpen} onOpenChange={(e) => !e.open && onClose()} placement="center" size="xl">
      <DialogBackdrop bg="blackAlpha.700" backdropFilter="blur(2px)" />
      <DialogPositioner>
        <DialogContent bg="app.bgCard" border="1px solid" borderColor="app.border" borderRadius="md" p={4}>
          <DialogCloseTrigger color="app.textDim" />
          <DialogBody pt={6}>
            {!problem ? (
              <Flex justify="center" align="center" py={10}>
                <Spinner color="app.accent" size="lg" />
                <Text ml={3} color="app.textDim">Loading&hellip;</Text>
              </Flex>
            ) : (
              <Box>
                <Text
                  fontFamily="mono"
                  fontSize="0.7rem"
                  color="app.textDim"
                  textTransform="uppercase"
                  letterSpacing="1px"
                  mb={3}
                >
                  Random unsolved problem
                </Text>
                <Text
                  fontFamily="heading"
                  fontSize="1.1rem"
                  color="app.textBright"
                  textTransform="capitalize"
                  mb={0.5}
                >
                  {problem.category}
                </Text>
                <Text
                  fontSize="0.8rem"
                  color="app.textDim"
                  mb={4}
                  pb={3}
                  borderBottom="1px solid"
                  borderColor="app.border"
                >
                  {problem.section}
                </Text>
                <Text fontSize="0.95rem" lineHeight="1.7" color="app.text">
                  {problem.text}
                </Text>

                {liveProblemState && (liveProblemState.activeClaim || liveProblemState.researchCount > 0 || liveProblemState.hasSubmissions) && (
                  <Box mt={4} p={3} bg="app.bgSection" border="1px solid" borderColor="app.border" borderRadius="sm">
                    <Flex gap={2} wrap="wrap" mb={liveProblemState.activeClaim ? 2 : 0}>
                      {liveProblemState.activeClaim && (
                        <Badge bg="orange.100" color="orange.800" textTransform="none">
                          Agent working: {liveProblemState.activeClaim.agentId}
                        </Badge>
                      )}
                      {liveProblemState.researchCount > 0 && (
                        <Badge bg="blue.100" color="blue.800" textTransform="none">
                          {liveProblemState.researchCount} research {liveProblemState.researchCount === 1 ? "entry" : "entries"}
                        </Badge>
                      )}
                      {liveProblemState.hasSubmissions && (
                        <Badge bg="green.100" color="green.800" textTransform="none">
                          Prior submission
                        </Badge>
                      )}
                    </Flex>
                    {liveProblemState.lastResearchAt && (
                      <Text fontSize="0.76rem" color="app.textDim">
                        Last research update: {new Date(liveProblemState.lastResearchAt).toLocaleString()}
                      </Text>
                    )}
                  </Box>
                )}

                {enrichment && (
                  <Box mt={6} pt={4} borderTop="1px solid" borderColor="app.border">
                    <Text mb={2} fontSize="0.84rem" lineHeight="1.6" color="app.text">
                      {enrichment.summary}
                    </Text>
                    <Text mb={3} fontSize="0.84rem" lineHeight="1.6" color="app.text">
                      {enrichment.significance}
                    </Text>
                    <Flex gap={2} mb={2}>
                      {enrichment.field && (
                        <Badge
                          variant="subtle"
                          bg="app.bgHover"
                          color="app.textDim"
                          px={2}
                          py={0.5}
                          borderRadius="full"
                          fontSize="0.7rem"
                          fontFamily="mono"
                          textTransform="none"
                        >
                          {enrichment.field}
                        </Badge>
                      )}
                      {enrichment.yearProposed && (
                        <Badge
                          variant="subtle"
                          bg="app.bgHover"
                          color="app.textDim"
                          px={2}
                          py={0.5}
                          borderRadius="full"
                          fontSize="0.7rem"
                          fontFamily="mono"
                          textTransform="none"
                        >
                          {enrichment.yearProposed}
                        </Badge>
                      )}
                    </Flex>
                    <Text
                      fontFamily="mono"
                      fontSize="0.62rem"
                      color="app.textDim"
                      textTransform="uppercase"
                      letterSpacing="0.5px"
                    >
                      AI-generated
                    </Text>
                  </Box>
                )}
              </Box>
            )}
          </DialogBody>

          <DialogFooter gap={3}>
            <Button
              flex={1}
              variant="outline"
              borderColor="app.accent"
              color="app.accent"
              _hover={{ bg: "rgba(138, 155, 181, 0.08)", borderColor: "app.accentHover", color: "app.accentHover" }}
              onClick={onNext}
              fontSize="0.84rem"
            >
              Next
            </Button>
            <Button
              flex={1}
              variant="outline"
              borderColor="app.border"
              color="app.textDim"
              _hover={{ bg: "app.bgHover", borderColor: "app.borderLight", color: "app.text" }}
              onClick={onClose}
              fontSize="0.84rem"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
  );
}
