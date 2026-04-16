#!/usr/bin/env bash
set -euo pipefail

MCP_URL="${UNSOLVED_MCP_URL:-https://unsolved-problems-api.seemueller.workers.dev/mcp}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY must be set before running this script." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  install_dir="${HOME}/.bun"
  echo "Installing Bun into ${install_dir}..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${install_dir}"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun installation failed or is not on PATH." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

base_url="https://raw.githubusercontent.com/geoffsee/unsolved-problems/master/apps/example"
mkdir -p "${tmp_dir}/src"

curl -fsSL "${base_url}/package.json" -o "${tmp_dir}/package.json"
curl -fsSL "${base_url}/src/index.ts" -o "${tmp_dir}/src/index.ts"

pick_mode="${UNSOLVED_PICK_MODE:-}"
problem_id="${UNSOLVED_PROBLEM_ID:-}"
user_goal="${UNSOLVED_USER_GOAL:-}"
user_background="${UNSOLVED_USER_BACKGROUND:-}"
user_constraints="${UNSOLVED_USER_CONSTRAINTS:-}"
user_context="${UNSOLVED_USER_CONTEXT:-}"

fetch_shortlist() {
  curl -fsSL -X POST "${MCP_URL}" \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -H "mcp-protocol-version: 2025-03-26" \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_problems","arguments":{"limit":8,"status":"available"}}}'
}

if [[ -z "${pick_mode}" && -t 0 ]]; then
  echo "Guide the agent before it picks a problem."
  printf "What kind of outcome are you hoping for? "
  read -r user_goal
  printf "What background or strengths should it lean on? "
  read -r user_background
  printf "Any constraints or preferences to respect? "
  read -r user_constraints
  printf "Any extra context, hunches, or references? "
  read -r user_context
  echo
  echo "How should the agent pick a problem?"
  echo "  1) Random available problem"
  echo "  2) Choose from a live shortlist"
  echo "  3) Enter a problem ID manually"
  printf "Select [1-3]: "
  read -r menu_choice

  case "${menu_choice}" in
    1|"")
      pick_mode="random"
      ;;
    2)
      pick_mode="specific"
      shortlist_json="$(fetch_shortlist)"
      mapfile -t shortlist < <(
        printf '%s' "${shortlist_json}" | bun -e '
          const chunks = [];
          for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const items = payload?.result?.structuredContent?.items ?? [];
          for (const item of items) {
            const text = String(item.text ?? "").replace(/\s+/g, " ").trim();
            console.log([item.id, `${item.category} / ${item.section}`, text].join("\t"));
          }
        '
      )

      if [[ "${#shortlist[@]}" -eq 0 ]]; then
        echo "No available problems were returned by the MCP server." >&2
        exit 1
      fi

      echo
      echo "Available shortlist:"
      for i in "${!shortlist[@]}"; do
        IFS=$'\t' read -r item_id item_scope item_text <<<"${shortlist[$i]}"
        printf "  %d) %s\n" "$((i + 1))" "${item_id}"
        printf "     %s\n" "${item_scope}"
        printf "     %s\n" "${item_text:0:140}"
      done
      printf "Pick a problem [1-%d]: " "${#shortlist[@]}"
      read -r shortlist_choice

      if ! [[ "${shortlist_choice}" =~ ^[0-9]+$ ]] || (( shortlist_choice < 1 || shortlist_choice > ${#shortlist[@]} )); then
        echo "Invalid selection." >&2
        exit 1
      fi

      IFS=$'\t' read -r problem_id _ <<<"${shortlist[$((shortlist_choice - 1))]}"
      ;;
    3)
      pick_mode="specific"
      printf "Enter a problem ID: "
      read -r problem_id
      if [[ -z "${problem_id}" ]]; then
        echo "A problem ID is required." >&2
        exit 1
      fi
      ;;
    *)
      echo "Invalid selection." >&2
      exit 1
      ;;
  esac
fi

if [[ -z "${pick_mode}" ]]; then
  pick_mode="agent"
fi

echo "Bootstrapping agent in ${tmp_dir}..."
(
  cd "${tmp_dir}"
  bun install --silent
  UNSOLVED_MCP_URL="${MCP_URL}" \
  UNSOLVED_PICK_MODE="${pick_mode}" \
  UNSOLVED_PROBLEM_ID="${problem_id}" \
  UNSOLVED_USER_GOAL="${user_goal}" \
  UNSOLVED_USER_BACKGROUND="${user_background}" \
  UNSOLVED_USER_CONSTRAINTS="${user_constraints}" \
  UNSOLVED_USER_CONTEXT="${user_context}" \
  bun run start
)
