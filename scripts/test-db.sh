#!/usr/bin/env bash
# Runs the pgTAP suites in supabase/tests/database against the linked project
# via the Management API (no Docker needed). Each suite runs in one transaction
# that is deliberately aborted at the end, so no fixtures, and not even the
# pgtap extension, persist. Results come back in the abort message.
set -uo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
status=0

files=("$@"); [ ${#files[@]} -eq 0 ] && files=(supabase/tests/database/*.test.sql)
for test_file in "${files[@]}"; do
  echo "# $test_file"
  {
    echo "begin;"
    echo "create extension if not exists pgtap with schema extensions;"
    echo "set local search_path = public, extensions;"
    echo "create temp table tap_out (n serial, line text);"
    echo "grant all on tap_out to public; grant all on sequence tap_out_n_seq to public;"
    sed -e '/^begin;$/d' -e '/^rollback;$/d' \
        -e 's/^select \(plan\|is_empty\|isnt_empty\|isnt\|matches\|results_eq\|set_eq\|bag_eq\|throws_ok\|throws_like\|lives_ok\|cmp_ok\|is\|ok\)(/insert into tap_out(line) select \1(/' \
        -e 's/^select \* from finish();/insert into tap_out(line) select * from finish();/' \
        "$test_file"
    echo "reset role;"
    echo "do \$\$ begin raise exception 'TAP_RESULTS%', E'\n' || (select string_agg(line, E'\n' order by n) from tap_out); end \$\$;"
  } > "$tmp"

  # The query always "fails": the deliberate abort is how results come back.
  { npx supabase db query --linked -f "$tmp" 2>&1 || true; } | node scripts/parse-tap.mjs || status=1
done

exit $status
