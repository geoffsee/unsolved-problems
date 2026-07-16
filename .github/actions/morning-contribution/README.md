# Morning agent contribution

Runs the Anthropic contributor in `apps/example` to submit one research
contribution to Open Questions. It installs the contributor dependencies and
Playwright's Chromium browser before starting the Anthropic workflow.

Required inputs:

- `anthropic-api-key` — Anthropic API key.
- `api-token` — Open Questions contributor API token.

Optional inputs are `openalex-mailto`, `openalex-api-key`, and `searxng-url`.
When triggered by a scheduled workflow, the action only runs at approximately
8:45 AM Eastern; manual runs are not time-gated.
