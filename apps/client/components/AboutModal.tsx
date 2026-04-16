import {
  DialogRoot,
  DialogBackdrop,
  DialogPositioner,
  DialogContent,
  DialogBody,
  DialogCloseTrigger,
  Text,
  Box,
  Link,
} from "@chakra-ui/react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalProblems: number;
  totalCategories: number;
  enrichedCount: number;
}

export default function AboutModal({ isOpen, onClose, totalProblems, totalCategories, enrichedCount }: AboutModalProps) {
  return (
    <DialogRoot open={isOpen} onOpenChange={(e) => !e.open && onClose()} placement="center" size="lg">
      <DialogBackdrop bg="blackAlpha.700" backdropFilter="blur(2px)" />
      <DialogPositioner>
        <DialogContent bg="app.bgCard" border="1px solid" borderColor="app.border" borderRadius="md" p={6}>
          <DialogCloseTrigger color="app.textDim" />
          <DialogBody>
            <Text
              fontFamily="mono"
              fontSize="0.7rem"
              color="app.textDim"
              textTransform="uppercase"
              letterSpacing="1px"
              mb={4}
            >
              About this project
            </Text>

            <Text fontSize="0.92rem" lineHeight="1.7" color="app.text" mb={4}>
              This site indexes <strong style={{ color: "var(--chakra-colors-app-textBright)" }}>{totalProblems.toLocaleString()}</strong> unsolved
              problems across <strong style={{ color: "var(--chakra-colors-app-textBright)" }}>{totalCategories}</strong> scientific disciplines,
              sourced directly from Wikipedia's peer-reviewed problem lists.
            </Text>

            <Text fontSize="0.92rem" lineHeight="1.7" color="app.text" mb={4}>
              It also tracks frontier research headlines and official FBI ViCAP public listings for missing persons and
              unsolved homicides. These case listings reflect what agencies publish publicly and are not a comprehensive
              national registry.
            </Text>

            <Text fontSize="0.92rem" lineHeight="1.7" color="app.text" mb={4}>
              {enrichedCount.toLocaleString()} problems include AI-generated summaries, significance descriptions,
              and metadata produced by Claude. These enrichments are marked accordingly.
            </Text>

            <Box
              mt={4}
              pt={4}
              borderTop="1px solid"
              borderColor="app.border"
              fontSize="0.82rem"
              lineHeight="1.7"
              color="app.textDim"
            >
              <Text mb={1}>Data refreshes nightly from Wikipedia, Perigon, and FBI ViCAP.</Text>
              <Text>
                Source on{" "}
                <Link
                  href="https://github.com/geoffsee/unsolved-problems"
                  isExternal
                  color="app.accent"
                  textDecoration="underline"
                  _hover={{ color: "app.accentHover" }}
                >
                  GitHub
                </Link>
              </Text>
            </Box>
          </DialogBody>
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
  );
}
