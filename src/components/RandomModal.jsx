import styled from "styled-components";

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
