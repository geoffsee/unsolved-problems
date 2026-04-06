import styled from "styled-components";
import { getEnrichment } from "../wiki";

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.bgCard};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: 32px;
  max-width: 540px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
`;

const Label = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 0.7rem;
  color: ${({ theme }) => theme.colors.textDim};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
`;

const Category = styled.div`
  font-family: ${({ theme }) => theme.fonts.heading};
  font-size: 1rem;
  color: ${({ theme }) => theme.colors.textBright};
  text-transform: capitalize;
  margin-bottom: 2px;
`;

const SectionName = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textDim};
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ProblemText = styled.div`
  font-size: 0.92rem;
  line-height: 1.7;
  color: ${({ theme }) => theme.colors.text};
`;

const Actions = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 28px;
`;

const Btn = styled.button`
  flex: 1;
  padding: 9px;
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 0.84rem;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.body};
  transition: border-color 0.15s, color 0.15s;
`;

const BtnNext = styled(Btn)`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.accent};

  &:hover {
    color: ${({ theme }) => theme.colors.accentHover};
    border-color: ${({ theme }) => theme.colors.accentHover};
  }
`;

const BtnClose = styled(Btn)`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textDim};

  &:hover {
    color: ${({ theme }) => theme.colors.text};
    border-color: ${({ theme }) => theme.colors.borderLight};
  }
`;

const EnrichmentBlock = styled.div`
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  font-size: 0.84rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.text};
`;

const EnrichmentField = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 0.7rem;
  color: ${({ theme }) => theme.colors.textDim};
  background: ${({ theme }) => theme.colors.bgHover};
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radii.pill};
  margin-right: 8px;
`;

const AiNote = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 0.62rem;
  color: ${({ theme }) => theme.colors.textDim};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 10px;
`;

const LoadingText = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textDim};
  padding: 20px 0;
  font-size: 0.88rem;
`;

export default function RandomModal({ problem, onNext, onClose }) {
  return (
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        {!problem ? (
          <LoadingText>Loading&hellip;</LoadingText>
        ) : (
          <>
            <Label>Random unsolved problem</Label>
            <Category>{problem.category}</Category>
            <SectionName>{problem.section}</SectionName>
            <ProblemText>{problem.text}</ProblemText>
            {(() => {
              const enrichment = getEnrichment(problem.text);
              if (!enrichment) return null;
              return (
                <EnrichmentBlock>
                  <div style={{ marginBottom: 6 }}>{enrichment.summary}</div>
                  <div style={{ marginBottom: 8 }}>{enrichment.significance}</div>
                  <div>
                    {enrichment.field && <EnrichmentField>{enrichment.field}</EnrichmentField>}
                    {enrichment.yearProposed && <EnrichmentField>{enrichment.yearProposed}</EnrichmentField>}
                  </div>
                  <AiNote>AI-generated</AiNote>
                </EnrichmentBlock>
              );
            })()}
            <Actions>
              <BtnNext onClick={onNext}>Next</BtnNext>
              <BtnClose onClick={onClose}>Close</BtnClose>
            </Actions>
          </>
        )}
      </Modal>
    </Overlay>
  );
}
