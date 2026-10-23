#!/usr/bin/env bash
# Run the same stock-distro and GetPageSpeed checks locally and in CI.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
log=$(mktemp)
trap 'rm -f "$log"' EXIT
images=(centos:7 rockylinux:9 ubuntu:24.04 debian:12 alpine:3.20 centos7-gps)
if (($#)); then images=("$@"); fi
for image in "${images[@]}"; do
    pull_image=$image
    # The GetPageSpeed LTS image: CentOS 7 with working repos and the GetPageSpeed release preinstalled.
    [[ $image == centos7-gps ]] && pull_image=getpagespeed/lts:el7
    printf '\n=== %s ===\n' "$image"
    docker pull --platform linux/amd64 "$pull_image"
    docker run --rm --interactive --platform linux/amd64 --volume "$root:/work:ro" --env "P2S_DISTRO=$image" \
        --entrypoint /bin/sh "$pull_image" -s <<'CONTAINER' | tee "$log"
set -eu
if [ "$P2S_DISTRO" = alpine:3.20 ]; then apk add --no-cache bash; fi
set +e
bash /work/php2shell-check.sh > /tmp/before.txt
status=$?
set -e
cat /tmp/before.txt
[ "$status" -eq 3 ]
grep -q 'No PHP found.' /tmp/before.txt
printf 'No-PHP check: exit %s (PASS)\n' "$status"
case "$P2S_DISTRO" in
    centos7-gps)
        # Exactly the README steps: refresh the release package, then install base and SCL PHP.
        yum -y install https://extras.getpagespeed.com/release-latest.rpm
        yum -y --enablerepo=getpagespeed-extras-php74 install php-cli php74-php-cli ;;
    centos:7)
        # CentOS 7 is archived: mirrorlist.centos.org is gone, packages live on vault.centos.org/7.9.2009.
        sed -i -e 's|^mirrorlist=|#mirrorlist=|' -e 's|^#baseurl=http://mirror.centos.org/centos/\$releasever|baseurl=https://vault.centos.org/7.9.2009|' /etc/yum.repos.d/CentOS-*.repo
        yum install -y php-cli ;;
    rockylinux:9) dnf install -y php-cli ;;
    ubuntu:24.04)
        apt-get update
        apt-get install -y php-cli php8.3-cli ;;
    debian:12)
        apt-get update
        apt-get install -y php-cli ;;
    alpine:3.20) apk add --no-cache php83 ;;
    *) printf 'Unsupported test image: %s\n' "$P2S_DISTRO" >&2; exit 2 ;;
esac
set +e
bash /work/php2shell-check.sh > /tmp/after.txt
status=$?
set -e
cat /tmp/after.txt
case "$status" in 0|1|3) ;; *) exit 1 ;; esac
grep -Eq '^\[(FIXED|VULNERABLE|UNKNOWN)\]' /tmp/after.txt
case "$P2S_DISTRO" in
    centos:7)
        [ "$status" -eq 1 ]
        grep -q '^\[VULNERABLE\] CentOS 7 base:' /tmp/after.txt ;;
    centos7-gps)
        [ "$status" -eq 0 ]
        grep -q '^\[FIXED\] GetPageSpeed (CentOS 7):' /tmp/after.txt
        grep -q '^\[FIXED\] GetPageSpeed (CentOS 7, software collection):' /tmp/after.txt
        ! grep -q '^\[VULNERABLE\]' /tmp/after.txt ;;
    ubuntu:24.04) grep -Eq '^\[(FIXED|VULNERABLE|UNKNOWN)\] Ubuntu:' /tmp/after.txt ;;
esac
set +e
bash /work/php2shell-check.sh --json > /tmp/report.json
json_status=$?
set -e
[ "$json_status" -eq "$status" ]
cat /tmp/report.json
printf 'Installed-PHP check: exit %s (PASS)\n' "$status"
CONTAINER
    node -e '
      const fs = require("node:fs");
      const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
      const reports = lines.filter(line => line.startsWith("{\"overall\":"));
      if (reports.length !== 1) throw Error("Expected exactly one JSON report");
      const report = JSON.parse(reports[0]);
      if (!Array.isArray(report.results) || !report.results.length) throw Error("Missing PHP results");
      console.log("Container JSON: valid (PASS)");
    ' "$log"
    printf '%s: PASS\n' "$image"
done
