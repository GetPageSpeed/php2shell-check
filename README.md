[![CI](https://github.com/GetPageSpeed/php2shell-check/actions/workflows/ci.yml/badge.svg)](https://github.com/GetPageSpeed/php2shell-check/actions/workflows/ci.yml)

# php2shell-check

Check installed PHP packages for PHP2Shell (CVE-2026-109618 / CVE-2026-109619), including vendor backports. Version-only checkers can report patched packages as vulnerable because distributions keep the upstream PHP version and change the package release instead.

```sh
curl -fsSL https://raw.githubusercontent.com/GetPageSpeed/php2shell-check/main/php2shell-check.sh | bash

# Or download, then run:
curl -fsSLO https://raw.githubusercontent.com/GetPageSpeed/php2shell-check/main/php2shell-check.sh
bash php2shell-check.sh
```

## CentOS 7 / RHEL 7: still fixable

Keep CentOS 7 servers patched. php.net fixed only PHP 8.2 and newer. Remi stopped building for CentOS 7 in June 2024, so Remi's CentOS 7 packages (PHP 5.6 to 8.3) will never get this fix.

GetPageSpeed rebuilt every Remi CentOS 7 PHP, 5.6 to 8.4, with PHP2Shell fixed: same package names, so `yum upgrade` replaces them in place, and PECL extensions and ionCube keep working. Free to install, no account or signup; personal, development and evaluation use is free, while commercial production use requires [GetPageSpeed Ultra](https://www.getpagespeed.com/repo-subscribe#ultra-annual).

Patched builds: 5.6.40-44.el7, 7.0.33-46.el7, 7.1.33-35.el7, 7.2.34-30.el7, 7.3.33-26.el7, 7.4.33-35.el7, 8.0.30-25.el7, 8.1.34-8.el7, 8.2.35-2.el7, 8.3.36-2.el7, 8.4.27-3.el7.

For base-name packages, replace `php74` with your version:

```sh
yum -y install https://extras.getpagespeed.com/release-latest.rpm
yum --enablerepo=getpagespeed-extras-php74 upgrade 'php-*'
systemctl restart php-fpm
```

For software collections:

```sh
yum -y install https://extras.getpagespeed.com/release-latest.rpm
yum upgrade 'php74-php*'
systemctl restart php74-php-fpm
```

Software collections need no extra channel. After upgrading, `php -v` prints "Built by GetPageSpeed LLC". It still shows the old upstream version, which is exactly why this checker reads the package release.

See [PHP2Shell EOL fixes](https://www.getpagespeed.com/php2shell#eol) and [CentOS 7 patching](https://www.getpagespeed.com/eol/centos-7).

## Ubuntu 20.04 / 18.04, Debian 10

The same repository ships patched DEB packages for the suites the sury PPA dropped: php7.4 / php8.0 / php8.1 for Ubuntu 20.04 (1:7.4.33-31+gps1, 1:8.0.30-25+gps1, 8.1.34-9+gps1), php7.2 for Ubuntu 18.04 (7.2.34-66+gps1) and php7.3 for Debian 10 (7.3.33-35+gps1). See [PHP2Shell on Ubuntu and Debian](https://www.getpagespeed.com/server-setup/php/php2shell-on-ubuntu-debian).

## Usage and exit codes

Runtime dependencies: Bash 4.2 or newer, coreutils, grep/sed/awk, and rpm, dpkg-query, or apk. No Python, jq, curl, or network access is needed to run a downloaded checker. It checks installed package builds; restart PHP services after upgrading.

```sh
bash php2shell-check.sh --file packages.txt
rpm -qa | bash php2shell-check.sh --file -
bash php2shell-check.sh --json
bash php2shell-check.sh --help
bash php2shell-check.sh --version
```

`--file` accepts the web checker's rpm, dpkg, apk, and `php -v` formats. `php -v` cannot identify vendor backports. JSON reports use the same fields and verdicts as the web checker (`patched`, `vulnerable`, `unknown`, or overall `none`). Human output uses `[FIXED]`, `[VULNERABLE]`, and `[UNKNOWN]`.

| Exit | Meaning |
| --- | --- |
| 0 | All detected runtime families are fixed |
| 1 | At least one family is vulnerable |
| 3 | No vulnerable family, but something is unknown, or no PHP found |
| 2 | Usage, input, or package-manager error |

## Supported vendors

Rules cover GetPageSpeed CentOS 7 base and software collections, Remi EL7 and EL8+, CentOS 7 base, RHEL/AlmaLinux/Rocky/Oracle Linux, cPanel EasyApache 4 ea-php, CloudLinux ea-php and alt-php, Amazon Linux 2 (including the GetPageSpeed PHP 7.2 build), Amazon Linux 2023, Ubuntu, Debian, Ondřej Surý packages, and Alpine Linux. Coverage depends on the branch and package release; unknown builds are reported as unknown.

Use the [web checker](https://www.getpagespeed.com/php2shell) for fix instructions and mitigation.

## Development

`data/php2shell-data.json` and `vendor/php2shell.js` are copies of the rules and checker served by the public [PHP2Shell page](https://www.getpagespeed.com/php2shell). `tools/sync-rules.sh` refreshes both from that page and regenerates the embedded Bash rules. Python 3 is needed only for generation. The generator rejects unsupported regex syntax and supports `--check` for stale rules.

```sh
bats tests/ && shellcheck php2shell-check.sh tools/sync-rules.sh && python3 tools/gen-rules.py --check && bash tests/containers.sh
```

The differential suite compares every fixture against the vendored JavaScript oracle using Node deep equality, including exit codes. Set `P2S_JS=/path/to/php2shell.js` to test against another reference copy. Container tests require Docker and Node, download stock packages, and also check the GetPageSpeed CentOS 7 software collection. CI runs these checks on pushes, pull requests, and weekly.

MIT license. Copyright GetPageSpeed LLC.
