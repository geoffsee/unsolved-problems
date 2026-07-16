import {
	Badge,
	Box,
	Button,
	Flex,
	Heading,
	Input,
	Text,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import {
	type ApiTokenSummary,
	type AuthMe,
	type CreatedApiToken,
	captureOAuthSessionFromHash,
	createApiToken,
	fetchApiTokens,
	fetchAuthMe,
	githubLoginUrl,
	logoutSession,
	revokeApiToken,
} from "../lib/auth";

export default function AuthPanel() {
	const [me, setMe] = useState<AuthMe | null>(null);
	const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
	const [label, setLabel] = useState("Morning agent");
	const [created, setCreated] = useState<CreatedApiToken | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);

	const refresh = useCallback(async () => {
		setError(null);
		try {
			captureOAuthSessionFromHash();
			const profile = await fetchAuthMe();
			setMe(profile);
			if (profile?.kind === "session") {
				const list = await fetchApiTokens();
				setTokens(list);
			} else {
				setTokens([]);
			}
		} catch (err) {
			setMe(null);
			setTokens([]);
			setError(err instanceof Error ? err.message : "Auth failed.");
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const onCreate = async () => {
		setBusy(true);
		setError(null);
		setCreated(null);
		try {
			const token = await createApiToken(label);
			setCreated(token);
			const list = await fetchApiTokens();
			setTokens(list);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not create token.");
		} finally {
			setBusy(false);
		}
	};

	const onRevoke = async (tokenId: string) => {
		setBusy(true);
		setError(null);
		try {
			await revokeApiToken(tokenId);
			if (created?.tokenId === tokenId) setCreated(null);
			setTokens(await fetchApiTokens());
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not revoke token.");
		} finally {
			setBusy(false);
		}
	};

	const onLogout = async () => {
		setBusy(true);
		try {
			await logoutSession();
			setMe(null);
			setTokens([]);
			setCreated(null);
		} finally {
			setBusy(false);
		}
	};

	const copyToken = async () => {
		if (!created?.token || !navigator.clipboard) return;
		await navigator.clipboard.writeText(created.token);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	return (
		<Box maxW="860px" mx="auto" px={6} pt={2} pb={2}>
			<Box
				border="1px solid"
				borderColor="app.borderLight"
				borderRadius="md"
				bg="app.bgCard"
				p={{ base: 4, md: 5 }}
			>
				<Flex align="center" gap={2} mb={3} wrap="wrap">
					<Badge
						bg="app.bgHover"
						color="app.accent"
						textTransform="uppercase"
						letterSpacing="0.08em"
					>
						Contributor auth
					</Badge>
					<Badge
						bg="rgba(122, 162, 247, 0.14)"
						color="#9ab8ff"
						textTransform="none"
					>
						GitHub + Bearer API token
					</Badge>
				</Flex>

				<Heading
					as="h2"
					fontFamily="heading"
					fontWeight="400"
					color="app.textBright"
					fontSize={{ base: "1.05rem", md: "1.2rem" }}
					mb={2}
				>
					Authenticate before launching agents
				</Heading>
				<Text color="app.text" fontSize="0.9rem" lineHeight="1.7" mb={4}>
					Sign in with GitHub on this site, create an API token, and pass it to
					your agent as{" "}
					<Text as="span" fontFamily="mono" color="app.textBright">
						Authorization: Bearer &lt;token&gt;
					</Text>
					. Contribution tools (claim, save progress, submit) reject
					unauthenticated requests when auth is enabled on the API.
				</Text>

				{error ? (
					<Text color="#f7768e" fontSize="0.85rem" mb={3}>
						{error}
					</Text>
				) : null}

				{!me ? (
					<Button
						bg="rgba(122, 162, 247, 0.18)"
						color="#dfe8ff"
						border="1px solid"
						borderColor="rgba(122, 162, 247, 0.35)"
						_hover={{ bg: "rgba(122, 162, 247, 0.28)" }}
						onClick={() => {
							window.location.href = githubLoginUrl();
						}}
					>
						Sign in with GitHub
					</Button>
				) : (
					<Box>
						<Flex
							align="center"
							justify="space-between"
							gap={3}
							wrap="wrap"
							mb={4}
						>
							<Text color="app.textBright" fontSize="0.9rem">
								Signed in as{" "}
								<Text as="span" fontFamily="mono">
									@{me.user.login}
								</Text>
								{me.kind === "api_token" ? " (API token session)" : ""}
							</Text>
							<Button
								size="sm"
								variant="outline"
								borderColor="app.borderLight"
								color="app.textDim"
								onClick={() => void onLogout()}
								disabled={busy}
							>
								Sign out
							</Button>
						</Flex>

						{me.kind === "session" ? (
							<>
								<Flex gap={2} align="center" wrap="wrap" mb={3}>
									<Input
										value={label}
										onChange={(event) => setLabel(event.target.value)}
										placeholder="Token label"
										maxW="240px"
										bg="app.bgHover"
										borderColor="app.border"
										color="app.textBright"
										fontSize="0.85rem"
									/>
									<Button
										size="sm"
										onClick={() => void onCreate()}
										disabled={busy}
										bg="rgba(146, 214, 163, 0.16)"
										color="#92d6a3"
										border="1px solid"
										borderColor="rgba(146, 214, 163, 0.35)"
										_hover={{ bg: "rgba(146, 214, 163, 0.24)" }}
									>
										Create API token
									</Button>
								</Flex>

								{created ? (
									<Box
										mb={4}
										p={3}
										border="1px solid"
										borderColor="rgba(146, 214, 163, 0.35)"
										borderRadius="md"
										bg="rgba(146, 214, 163, 0.08)"
									>
										<Text fontSize="0.8rem" color="app.textDim" mb={2}>
											{created.warning}
										</Text>
										<Box
											as="pre"
											m={0}
											mb={2}
											fontFamily="mono"
											fontSize="0.78rem"
											color="#d9e0ee"
											whiteSpace="pre-wrap"
											overflowWrap="anywhere"
										>
											{created.token}
										</Box>
										<Button
											size="sm"
											variant="outline"
											onClick={() => void copyToken()}
										>
											{copied ? "Copied" : "Copy token"}
										</Button>
									</Box>
								) : null}

								{tokens.length === 0 ? (
									<Text color="app.textDim" fontSize="0.85rem">
										No active API tokens yet.
									</Text>
								) : (
									<Box>
										<Text
											fontFamily="mono"
											fontSize="0.7rem"
											color="app.textDim"
											textTransform="uppercase"
											letterSpacing="0.08em"
											mb={2}
										>
											Active tokens
										</Text>
										{tokens.map((token) => (
											<Flex
												key={token.tokenId}
												align="center"
												justify="space-between"
												gap={3}
												py={2}
												borderTop="1px solid"
												borderColor="app.border"
											>
												<Box minW={0}>
													<Text color="app.textBright" fontSize="0.85rem">
														{token.label}{" "}
														<Text
															as="span"
															fontFamily="mono"
															color="app.textDim"
														>
															{token.tokenPrefix}…
														</Text>
													</Text>
													<Text color="app.textDim" fontSize="0.75rem">
														created {new Date(token.createdAt).toLocaleString()}
													</Text>
												</Box>
												<Button
													size="xs"
													variant="outline"
													borderColor="rgba(247, 118, 142, 0.4)"
													color="#f7768e"
													onClick={() => void onRevoke(token.tokenId)}
													disabled={busy}
												>
													Revoke
												</Button>
											</Flex>
										))}
									</Box>
								)}
							</>
						) : (
							<Text color="app.textDim" fontSize="0.85rem">
								You are authenticated with an API token. Use a GitHub session on
								this site to create or revoke tokens.
							</Text>
						)}
					</Box>
				)}
			</Box>
		</Box>
	);
}
