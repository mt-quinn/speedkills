"""Report actual engagement motion from an unfiltered spectacle JSONL batch.

Usage: python3 python/duel/geometry.py [runs/duel/spectacle.jsonl]
Stationary means 1.2–5 km apart, closing speed under 40 m/s and line-of-sight
rotation under 0.04 rad/s. Passes and reentries are spatial observations, not
pilot mode labels. These complement spectacle.py; they do not replace its gates.
"""
import json
import statistics as stats
import sys
from collections import defaultdict

path = sys.argv[1] if len(sys.argv) > 1 else "runs/duel/spectacle.jsonl"
groups = defaultdict(list)
for line in open(path):
    row = json.loads(line)
    pair = "/".join(sorted(side["style"] for side in row["sides"]))
    groups[pair].append(row)
    groups["ALL"].append(row)

print("Pair                    N   idle s/fight   idle %   longest p50   passes   reentries")
for pair, rows in sorted(groups.items()):
    idle = sum(r["stationary_exchange_time"] for r in rows)
    duration = sum(r["duration"] for r in rows)
    longest = stats.median(r["longest_stationary_exchange"] for r in rows)
    passes = stats.mean(r["fast_passes"] for r in rows)
    returns = stats.mean(r["reentries"] for r in rows)
    print(f"{pair:23} {len(rows):4} {idle/len(rows):14.1f} {100*idle/duration:8.1f}"
          f" {longest:13.1f} {passes:8.2f} {returns:11.2f}")
