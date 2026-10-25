#!/usr/bin/env bash
# Refresh the canonical rules/evaluator, then regenerate embedded Bash rules.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
page_url=${P2S_PAGE_URL:-https://www.getpagespeed.com/php2shell}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
fetch() {
    local url=$1 destination=$2 attempt=0
    until curl --fail --silent --show-error --location --connect-timeout 15 --max-time 60 -o "$destination" "$url"; do
        attempt=$((attempt+1))
        if ((attempt >= 5)); then
            printf 'Failed to fetch %s after five attempts\n' "$url" >&2
            return 1
        fi
        sleep "$((attempt*5))"
    done
}
fetch "$page_url" "$tmp_dir/page.html"
js_url=$(python3 "$root/tools/extract-rules.py" "$tmp_dir/page.html" "$tmp_dir/data.json" "$page_url")
fetch "$js_url" "$tmp_dir/php2shell.js"
mv "$tmp_dir/data.json" "$root/data/php2shell-data.json"
mv "$tmp_dir/php2shell.js" "$root/vendor/php2shell.js"
python3 "$root/tools/gen-rules.py"
