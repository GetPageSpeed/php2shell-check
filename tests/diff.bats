#!/usr/bin/env bats
setup() {
    cd "$BATS_TEST_DIRNAME/.."
}

@test "all fixtures match the independent JavaScript oracle and exit code" {
    for fixture in tests/fixtures/*.txt; do
        expected=$(node tests/oracle.js "$fixture")
        run bash php2shell-check.sh --json --file "$fixture"
        actual=$output
        actual_status=$status
        node -e '
          const assert = require("node:assert/strict");
          const [expected, actual, status] = process.argv.slice(1);
          const report = JSON.parse(expected);
          assert.deepStrictEqual(JSON.parse(actual), report);
          assert.equal(Number(status), {patched:0, vulnerable:1, unknown:3, none:3}[report.overall]);
        ' "$expected" "$actual" "$actual_status" || {
            printf 'Fixture failed: %s\nExpected: %s\nActual: %s\nStatus: %s\n' "$fixture" "$expected" "$actual" "$actual_status" >&3
            return 1
        }
    done
    printf 'Compared %s fixtures.\n' "$(find tests/fixtures -name '*.txt' | wc -l | tr -d ' ')" >&3
}

@test "generated rules are current and generation is idempotent" {
    run python3 tools/gen-rules.py --check
    [ "$status" -eq 0 ]
    before=$(shasum php2shell-check.sh)
    python3 tools/gen-rules.py
    python3 tools/gen-rules.py
    [ "$(shasum php2shell-check.sh)" = "$before" ]
}

@test "help version and usage errors" {
    run bash php2shell-check.sh --help
    [ "$status" -eq 0 ]
    [[ "$output" == *Usage:* ]]
    run bash php2shell-check.sh --version
    [ "$status" -eq 0 ]
    expected=$(node -p 'require("./data/php2shell-data.json").updated')
    [ "$output" = "$expected" ]
    run bash php2shell-check.sh --file
    [ "$status" -eq 2 ]
    run bash php2shell-check.sh --invalid
    [ "$status" -eq 2 ]
    run bash php2shell-check.sh --file /no/such/file
    [ "$status" -eq 2 ]
}

@test "stdin has the same report as a file" {
    fixture=tests/fixtures/mixed.txt
    expected=$(node tests/oracle.js "$fixture")
    run bash -c 'bash php2shell-check.sh --json --file - < "$1"' _ "$fixture"
    [ "$status" -eq 1 ]
    node -e 'require("node:assert/strict").deepStrictEqual(JSON.parse(process.argv[1]),JSON.parse(process.argv[2]))' "$expected" "$output"
}

@test "human output includes family verdicts fix commands and checker link" {
    run bash php2shell-check.sh --file tests/fixtures/mixed.txt
    [ "$status" -eq 1 ]
    [[ "$output" == *'[FIXED]'* ]]
    [[ "$output" == *'[VULNERABLE]'* ]]
    [[ "$output" == *'[UNKNOWN]'* ]]
    [[ "$output" == *"yum upgrade 'php80-php*'"* ]]
    [[ "$output" == *'https://www.getpagespeed.com/php2shell' ]]
    run bash php2shell-check.sh --file tests/fixtures/empty.txt
    [ "$status" -eq 3 ]
    [[ "$output" == *'No PHP found.'* ]]
}

@test "published focal packages retain the provider and exact package floor" {
    for pair in 8.2:8.2.35 8.3:8.3.36 8.4:8.4.27; do
        branch=${pair%%:*}
        version=${pair#*:}
        run bash php2shell-check.sh --json --file "tests/fixtures/gps-focal-$branch-fixed.txt"
        [ "$status" -eq 0 ]
        node -e '
          const assert = require("node:assert/strict");
          const row = JSON.parse(process.argv[1]).results[0];
          assert.match(row.vendor, /^GetPageSpeed/);
          assert.equal(row.fixedIn, process.argv[2] + "-1+gps1");
        ' "$output" "$version"
    done
}

@test "checker page extraction accepts current WordPress markup" {
    run python3 -m unittest discover -s tests -p test_sync_page.py -v
    [ "$status" -eq 0 ]
}
