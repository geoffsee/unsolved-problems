#!/usr/bin/env bash
set -euo pipefail

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

echo "Bootstrapping agent in ${tmp_dir}..."
(
  cd "${tmp_dir}"
  bun install --silent
  bun run start
)
