#!/usr/bin/env bash
# Refresh the rules and the reference checker from the public PHP2Shell page,
# then regenerate the embedded Bash rules.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
page_url=${P2S_PAGE_URL:-https://www.getpagespeed.com/php2shell}
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$page_url" -o "$tmp"
js_url=$(python3 - "$tmp" "$root/data/php2shell-data.json" <<'PY'
import html, json, re, sys
page = open(sys.argv[1], encoding="utf-8").read()
data = re.search(r'<script type="application/json" id="gps-p2s-data">(.*?)</script>', page, re.S)
src = re.search(r'<script[^>]*id="gps-php2shell-js"[^>]*src="([^"]+)"', page)
if not data or not src:
    sys.exit("rules data or checker script not found on the page")
with open(sys.argv[2], "w", encoding="utf-8") as out:
    json.dump(json.loads(data.group(1)), out, indent=2, ensure_ascii=False)
    out.write("\n")
print(html.unescape(src.group(1)))
PY
)
curl -fsSL "$js_url" -o "$root/vendor/php2shell.js"
python3 "$root/tools/gen-rules.py"
