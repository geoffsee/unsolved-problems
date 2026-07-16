# Nightly data build

Refreshes the client data feeds and builds the static client. The action
installs dependencies and Chromium, reuses a cached `problems.json` when one
exists, fetches problems, news, and cases, attempts data enrichment, and then
runs the client build.

Enrichment failures are reported as warnings so they do not prevent the final
client build; failures in the other steps fail the action.
