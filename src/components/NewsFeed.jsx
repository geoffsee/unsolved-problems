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
  margin-bottom: 24px;
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

const NewsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const NewsItem = styled.div`
  padding-bottom: 24px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const NewsTitle = styled.a`
  font-family: ${({ theme }) => theme.fonts.heading};
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.textBright};
  text-decoration: none;
  display: block;
  margin-bottom: 8px;
  line-height: 1.4;

  &:hover {
    color: ${({ theme }) => theme.colors.accent};
  }
`;

const NewsMeta = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textDim};
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const Sources = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
`;

const SourcePill = styled.a`
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-family: ${({ theme }) => theme.fonts.body};
  font-weight: 500;
  color: ${({ theme }) => theme.colors.accent};
  border: 1px solid ${({ theme }) => theme.colors.border};
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.accent}15;
    border-color: ${({ theme }) => theme.colors.accent};
  }
`;

const DateStr = styled.span``;

const LoadingText = styled.p`
  color: ${({ theme }) => theme.colors.textDim};
  font-family: ${({ theme }) => theme.fonts.body};
`;

const ErrorText = styled.p`
  color: ${({ theme }) => theme.colors.error};
  font-family: ${({ theme }) => theme.fonts.body};
`;

export default function NewsFeed({ news, loading, error, search, onBack }) {
  const formatDate = (dateStr) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const filteredNews = news.filter((item) => {
    const q = search.toLowerCase();
    return item.title.toLowerCase().includes(q) ||
      item.sources.some((s) => s.domain.toLowerCase().includes(q));
  });

  return (
    <Wrapper>
      <TopBar>
        <BackButton onClick={onBack}>&larr; Back to Categories</BackButton>
        <Title>Frontier Research News</Title>
      </TopBar>
      
      {loading && <LoadingText>Fetching latest breakthroughs...</LoadingText>}
      {error && <ErrorText>{error}</ErrorText>}
      
      {!loading && !error && (
        <NewsList>
          {filteredNews.length === 0 ? (
            <LoadingText>{news.length === 0 ? "No recent news found." : "No matching news found."}</LoadingText>
          ) : (
            filteredNews.map((item, i) => (
              <NewsItem key={i}>
                <NewsTitle href={item.sources[0].url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </NewsTitle>
                <NewsMeta>
                  <DateStr>{formatDate(item.seendate)}</DateStr>
                </NewsMeta>
                <Sources>
                  {item.sources.map((s) => (
                    <SourcePill key={s.domain} href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.domain}
                    </SourcePill>
                  ))}
                </Sources>
              </NewsItem>
            ))
          )}
        </NewsList>
      )}
    </Wrapper>
  );
}
