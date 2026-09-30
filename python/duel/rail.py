"""Railgun gunnery from runs/duel/spectacle.jsonl: hit rate, calibration (does a shot fire control
rated p actually hit about p of the time?), hit rate by range, shots per ship."""
import json, sys
ms = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/spectacle.jsonl')]
sh = [x for m in ms for s in m['sides'] for x in s['shots']]
n = len(sh); h = sum(x['hit'] for x in sh)
print(f"railgun: {n} shots ({n / len(ms) / 2:.1f} per ship), hit {100*h/n:.0f}%   (want 65–75%)")
cal = []
for lo, hi in ((0, .3), (.3, .6), (.6, .9), (.9, 1.01)):
    b = [x for x in sh if lo <= x['p_est'] < hi]
    if b: cal.append(f"p {lo:.1f}–{min(hi,1):.1f}: {len(b)/n*100:.0f}% of shots, hit {100*sum(x['hit'] for x in b)/len(b):.0f}%")
print("   calibration: " + " · ".join(cal))
rg = []
for lo, hi in ((0, 1500), (1500, 3000), (3000, 4500), (4500, 1e9)):
    b = [x for x in sh if lo <= x['range'] < hi]
    if b: rg.append(f"{lo/1000:.1f}–{min(hi,9e3)/1000:.1f} km: {len(b)/n*100:.0f}%, hit {100*sum(x['hit'] for x in b)/len(b):.0f}%")
print("   by range: " + " · ".join(rg))
