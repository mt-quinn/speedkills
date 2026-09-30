"""Summaries of runs/duel/gate.jsonl: railgun shots by range, per pairing and shooter."""
import json, collections, sys

path = sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/gate.jsonl'
ms = [json.loads(l) for l in open(path)]
pairs = sorted({tuple(sorted(s['style'] for s in m['sides'])) for m in ms})
only = sys.argv[2:] or None
def mean(xs): return sum(xs) / len(xs) if xs else float('nan')
for P in pairs:
    if only and not any(o in P for o in only): continue
    for shooter in sorted(set(P)):
        sh = [x for m in ms if tuple(sorted(s['style'] for s in m['sides'])) == P
              for s in m['sides'] if s['style'] == shooter for x in s['shots']]
        if not sh: continue
        print(f"{P} {shooter}: {len(sh)} shots, hit {mean([x['hit'] for x in sh]):.2f}, p_est {mean([x['p_est'] for x in sh]):.2f}")
        byr = collections.defaultdict(list)
        for x in sh: byr[int(x['range'] // 1000)].append(x)
        for r in sorted(byr):
            xs = byr[r]
            print(f"   {r}km n={len(xs):4} hit {mean([x['hit'] for x in xs]):.2f} p_est {mean([x['p_est'] for x in xs]):.2f} "
                  f"aim_miss {mean([x['aim_miss'] for x in xs]):5.1f} escape {mean([x['escape'] for x in xs]):5.1f} "
                  f"target lateral {mean([x['target_lateral'] for x in xs]):5.1f} m/s² · misses pass at {mean([x['closest'] for x in xs if not x['hit']]):5.1f} m")
