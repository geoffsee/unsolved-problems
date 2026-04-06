import { useState } from "react";
import styled from "styled-components";

const Wrapper = styled.div`
  max-width: 860px;
  margin: 0 auto;
  padding: 0 24px 80px;
`;

const TopBar = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 6px;
  flex-wrap: wrap;

  @media (max-width: ${({ theme }) => theme.breakpoints.mobile}) {
    flex-direction: column;
    gap: 8px;
  }
`;

const BackButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  color: ${({ theme }) => theme.colors.accent};
  cursor: pointer;
  font-size: 0.84rem;
  font-family: ${({ theme }) => theme.fonts.body};
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.accentHover};
  }
`;

const Title = styled.h2`
  font-family: ${({ theme }) => theme.fonts.heading};
  font-size: 1.35rem;
  font-weight: 400;
  color: ${({ theme }) => theme.colors.textBright};
  text-transform: capitalize;
  flex: 1;
`;

const SourceLink = styled.a`
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textDim};
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.accent};
  }
`;

const Stats = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textDim};
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const SectionBlock = styled.div`
  margin-bottom: 8px;
`;

const SectionToggle = styled.button`
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding: 12px 0;
  color: ${({ theme }) => theme.colors.textBright};
  font-family: ${({ theme }) => theme.fonts.heading};
  font-size: 0.95rem;
  font-weight: 400;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.accentHover};
  }
`;

const Arrow = styled.span`
  font-size: 0.6rem;
  color: ${({ theme }) => theme.colors.textDim};
  transition: transform 0.2s;
  transform: ${({ $open }) => ($open ? "rotate(90deg)" : "rotate(0)")};
`;

const Count = styled.span`
  margin-left: auto;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textDim};
`;

const ProblemList = styled.ol`
  list-style: none;
  padding: 8px 0 16px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ProblemItem = styled.li`
  padding: 10px 16px;
  font-size: 0.88rem;
  line-height: 1.65;
  color: ${({ theme }) => theme.colors.text};
  border-left: 2px solid transparent;
  transition: border-color 0.15s, background 0.15s;

  &:hover {
    border-left-color: ${({ theme }) => theme.colors.accent};
    background: ${({ theme }) => theme.colors.bgHover};
  }
`;

const ProblemNumber = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 0.72rem;
  margin-right: 10px;
`;

const Loading = styled.div`
  text-align: center;
  padding: 60px 0;
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 0.9rem;
`;

const Spinner = styled.div`
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.accent};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 14px;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const Error = styled.div`
  text-align: center;
  padding: 40px 0;
  color: ${({ theme }) => theme.colors.error};
  font-size: 0.9rem;
`;

function Section({ heading, problems, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <SectionBlock>
      <SectionToggle onClick={() => setOpen(!open)}>
        <Arrow $open={open}>&#9654;</Arrow>
        {heading}
        <Count>{problems.length}</Count>
      </SectionToggle>
      {open && (
        <ProblemList>
          {problems.map((p, i) => (
            <ProblemItem key={i}>
              <ProblemNumber>{i + 1}.</ProblemNumber>
              {p}
            </ProblemItem>
          ))}
        </ProblemList>
      )}
    </SectionBlock>
  );
}

export default function ProblemsView({
  categoryKey,
  category,
  sections,
  totalProblems,
  loading,
  error,
  search,
  onBack,
}) {
  const wikiUrl = `https://en.wikipedia.org/wiki/${category.page}`;

  return (
    <Wrapper>
      <TopBar>
        <BackButton onClick={onBack}>&larr; All disciplines</BackButton>
        <Title>{categoryKey}</Title>
        <SourceLink href={wikiUrl} target="_blank" rel="noopener">
          Source
        </SourceLink>
      </TopBar>

      {loading && (
        <Loading>
          <Spinner />
          <div>Loading from Wikipedia&hellip;</div>
        </Loading>
      )}

      {error && <Error>{error}</Error>}

      {!loading && !error && sections.length > 0 && (
        <>
          <Stats>
            {totalProblems} problems &middot; {sections.length} sections
            {search && ` \u00B7 filtered`}
          </Stats>
          {sections.map((sec, i) => (
            <Section
              key={sec.heading}
              heading={sec.heading}
              problems={sec.problems}
              defaultOpen={i === 0}
            />
          ))}
        </>
      )}

      {!loading && !error && sections.length === 0 && search && (
        <Loading>No results for &ldquo;{search}&rdquo;</Loading>
      )}
    </Wrapper>
  );
}
