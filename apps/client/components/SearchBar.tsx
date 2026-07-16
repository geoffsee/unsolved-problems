import {
	Box,
	Button,
	type ButtonProps,
	Flex,
	Input,
	type InputProps,
} from "@chakra-ui/react";
import githubUrl from "../assets/github.svg";

interface SearchBarProps {
	search: string;
	onSearch: (value: string) => void;
	onRandom: () => void;
	onAbout: () => void;
	onContributions: () => void;
	showSearch: boolean;
	placeholder?: string;
}

const commonButtonStyles: ButtonProps = {
	variant: "outline",
	bg: "transparent",
	color: "app.text",
	border: "1px solid",
	borderColor: "app.border",
	borderRadius: "sm",
	px: 4.5,
	py: 2,
	fontSize: "0.85rem",
	fontWeight: "normal",
	cursor: "pointer",
	whiteSpace: "nowrap",
	_hover: { borderColor: "app.accent", color: "app.accent", bg: "transparent" },
	w: { base: "100%", md: "auto" },
	h: "auto",
};

const commonInputStyles: InputProps = {
	flex: 1,
	bg: "app.bgCard",
	border: "1px solid",
	borderColor: "app.border",
	borderRadius: "sm",
	px: 3.5,
	py: 2,
	fontSize: "0.88rem",
	color: "app.text",
	_focus: { borderColor: "app.accent", boxShadow: "none" },
	_placeholder: { color: "app.textDim" },
	w: "75%",
	marginTop: "2rem",
};

function RandomButton(props: { onClick: () => void }) {
	return (
		<Button {...commonButtonStyles} onClick={props.onClick}>
			Random
		</Button>
	);
}

function ViewSourceButton(props: { onClick: () => void }) {
	return (
		<Button
			{...commonButtonStyles}
			onClick={props.onClick}
			asChild
			aria-label="Source on GitHub"
			display="inline-flex"
			alignItems="center"
			gap="4px"
		>
			<a
				href="https://github.com/geoffsee/open-questions"
				target="_blank"
				rel="noopener noreferrer"
			>
				<img
					src={githubUrl}
					alt="GitHub"
					width={16}
					height={16}
					style={{ filter: "brightness(0) invert(1)" }}
				/>
				View Source
			</a>
		</Button>
	);
}

function AgentContributionsButton(props: { onClick: () => void }) {
	return (
		<Button {...commonButtonStyles} onClick={props.onClick}>
			Research Activity
		</Button>
	);
}

function AboutButton(props: { onClick: () => void }) {
	return (
		<Button {...commonButtonStyles} onClick={props.onClick}>
			About
		</Button>
	);
}

function SearchInput(props: {
	placeholder: string | undefined;
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
	return (
		<Input
			{...commonInputStyles}
			type="text"
			placeholder={props.placeholder || "Filter..."}
			value={props.value}
			onChange={props.onChange}
		/>
	);
}

export default function SearchBar({
	search,
	onSearch,
	onRandom,
	onAbout,
	onContributions,
	showSearch,
	placeholder,
}: SearchBarProps) {
	return (
		<Box
			position="sticky"
			top={0}
			zIndex={10}
			bg="app.bg"
			px={6}
			py={5}
			maxW="860px"
			mx="auto"
		>
			<Flex gap={2.5} align="center" direction="column">
				<Flex
					gap={2.5}
					align="center"
					justify="center"
					direction={{ base: "column", md: "row" }}
					w="100%"
				>
					<AboutButton onClick={onAbout} />
					<ViewSourceButton onClick={onAbout} />
					<RandomButton onClick={onRandom} />
					<AgentContributionsButton onClick={onContributions} />
				</Flex>
				{showSearch && (
					<SearchInput
						placeholder={placeholder}
						value={search}
						onChange={(e) => onSearch(e.target.value)}
					/>
				)}
			</Flex>
		</Box>
	);
}
