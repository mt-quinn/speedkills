#!/bin/bash
# Usage: sweep_insides.sh "CREW_HARM=1 RAIL_SPALL=0.2 PDC_PEN_P=0.1" ...  (100 fights per pairing each)
cd "$(dirname "$0")/../../crates/duel"
for cfg in "$@"; do
  env $(for kv in $cfg; do echo "SK_$kv"; done) GATE_N=${GATE_N:-100} cargo test -p sk-duel --release spectacle_round_robin -- --ignored >/dev/null 2>&1
  echo "=== $cfg"
  (cd ../.. && python3 python/duel/insides.py | sed -n 2,4p; python3 python/duel/insides.py | sed -n 6p; python3 python/duel/spectacle.py | grep -E "^(PASS|FAIL)" | grep -v G2 | cut -c1-110)
done
