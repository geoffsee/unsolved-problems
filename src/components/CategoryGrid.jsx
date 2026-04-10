import styled from "styled-components";

const GridWrapper = styled.div`
  max-width: 860px;
  margin: 0 auto;
  padding: 0 24px 64px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1px;
  background: ${({ theme }) => theme.colors.border};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.md};
  overflow: hidden;

  @media (max-width: ${({ theme }) => theme.breakpoints.mobile}) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.button`
  background: ${({ theme }) => theme.colors.bgCard};
  border: none;
  padding: 20px 22px;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;
  display: flex;
  align-items: baseline;
  gap: 14px;
  font-family: inherit;

  &:hover {
    background: ${({ theme }) => theme.colors.bgHover};
  }
`;

const Number = styled.span`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textDim};
  min-width: 22px;
`;

const Info = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Name = styled.span`
  font-family: ${({ theme }) => theme.fonts.heading};
  font-weight: 400;
  color: ${({ theme }) => theme.colors.textBright};
  font-size: 1rem;
  text-transform: capitalize;
`;

const Status = styled.span`
  font-size: 0.76rem;
  color: ${({ theme }) => theme.colors.textDim};
`;

export default function CategoryGrid({ categories, loaded, onSelect }) {
  const keys = Object.keys(categories);
  return (
    <GridWrapper>
      <Grid>
        {keys.map((key, i) => (
          <Card key={key} onClick={() => onSelect(key)}>
            <Number>{String(i + 1).padStart(2, "0")}</Number>
            <Info>
              <Name>{key}</Name>
              <Status>
                {categories[key].type === "news"
                  ? "Latest breakthroughs"
                  : loaded[key]
                  ? `${loaded[key]} open problems`
                  : "Select to browse"}
              </Status>
            </Info>
          </Card>
        ))}
      </Grid>
    </GridWrapper>
  );
}
