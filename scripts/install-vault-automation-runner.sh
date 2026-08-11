#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
repo_dir=${script_dir:h}
uid=$(/usr/bin/id -u)
launchagents_dir="$HOME/Library/LaunchAgents"
runtime_dir="$HOME/Library/Application Support/FJG Vault Automation"
runner_dir="$runtime_dir/runner"
sentinel_source="$repo_dir/runner/com.fjg.vault-automation-executor.plist"
sentinel_target="$launchagents_dir/com.fjg.vault-automation-executor.plist"
runner_target="$launchagents_dir/com.fjg.vault-automation-runner.plist"

/bin/mkdir -p "$launchagents_dir" "$runner_dir"
/bin/chmod 700 "$runtime_dir" "$runner_dir"
/usr/bin/install -m 600 "$sentinel_source" "$sentinel_target"
/bin/launchctl bootout "gui/$uid/com.fjg.vault-automation-executor" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$uid" "$sentinel_target"

if [[ ${1:-} == "--sentinel-only" ]]; then
  exit 0
fi

base_url=${1:-}
if [[ ! $base_url =~ '^https://[A-Za-z0-9.-]+/?$' ]]; then
  print -u2 "Usage: $0 https://your-dedicated-site.netlify.app"
  exit 64
fi

node_path=$(/usr/bin/which node)
/usr/bin/install -m 700 "$repo_dir/scripts/vault-automation-runner.mjs" "$runner_dir/vault-automation-runner.mjs"
/usr/bin/install -m 600 "$repo_dir/scripts/vault-automation-runner-core.mjs" "$runner_dir/vault-automation-runner-core.mjs"
/usr/bin/printf '{"baseUrl":"%s"}\n' "${base_url%/}" > "$runtime_dir/config.json"
/bin/chmod 600 "$runtime_dir/config.json"

temp_plist=$(/usr/bin/mktemp -t fjg-vault-automation-runner)
trap '/bin/rm -f "$temp_plist"' EXIT
/usr/bin/sed \
  -e "s|__NODE_PATH__|$node_path|g" \
  -e "s|__RUNNER_PATH__|$runner_dir/vault-automation-runner.mjs|g" \
  "$repo_dir/runner/com.fjg.vault-automation-runner.plist.template" > "$temp_plist"
/usr/bin/plutil -lint "$temp_plist" >/dev/null
/usr/bin/install -m 600 "$temp_plist" "$runner_target"
/bin/launchctl bootout "gui/$uid/com.fjg.vault-automation-runner" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$uid" "$runner_target"
