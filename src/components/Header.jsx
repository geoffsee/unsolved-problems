import styled from "styled-components";

const Wrapper = styled.header`
  text-align: center;
  padding: 56px 24px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  max-width: 860px;
  margin: 0 auto 32px;
`;

const Title = styled.h1`
  font-family: ${({ theme }) => theme.fonts.heading};
  font-size: 2rem;
  font-weight: 400;
  color: ${({ theme }) => theme.colors.textBright};
  letter-spacing: -0.3px;
  line-height: 1.3;

  @media (max-width: ${({ theme }) => theme.breakpoints.mobile}) {
    font-size: 1.5rem;
  }
`;

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 0.88rem;
  margin-top: 8px;
  padding-bottom: 20px;
  line-height: 1.5;
  letter-spacing: 0.2px;
`;

export default function Header() {
  return (
    <Wrapper>
      <Title>Unsolved Problems Explorer</Title>
      <Subtitle>
        A curated index of open questions across scientific disciplines,
        sourced from Wikipedia&rsquo;s peer-reviewed problem lists.
      </Subtitle>
    </Wrapper>
  );
}
