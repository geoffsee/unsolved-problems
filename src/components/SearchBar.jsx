import styled from "styled-components";

const Bar = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  background: ${({ theme }) => theme.colors.bg};
  padding: 10px 24px 14px;
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  gap: 10px;
  align-items: center;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  @media (max-width: ${({ theme }) => theme.breakpoints.mobile}) {
    flex-direction: column;
  }
`;

const Input = styled.input`
  flex: 1;
  background: ${({ theme }) => theme.colors.bgCard};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 9px 14px;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.fonts.body};
  outline: none;
  transition: border-color 0.2s;
  width: 100%;

  &:focus {
    border-color: ${({ theme }) => theme.colors.accent};
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.textDim};
  }
`;

const RandomButton = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.accent};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 9px 18px;
  font-size: 0.85rem;
  font-family: ${({ theme }) => theme.fonts.body};
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.2s, color 0.2s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.accent};
    color: ${({ theme }) => theme.colors.accentHover};
  }

  @media (max-width: ${({ theme }) => theme.breakpoints.mobile}) {
    width: 100%;
  }
`;

export default function SearchBar({ search, onSearch, onRandom, showSearch, placeholder }) {
  return (
    <Bar>
      {showSearch && (
        <Input
          type="text"
          placeholder={placeholder || "Filter..."}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      )}
      <RandomButton onClick={onRandom}>Random problem</RandomButton>
    </Bar>
  );
}
