"""Swing structure of a spectacle log: real vs shuffled-order lead changes, per pairing."""
import json, random, sys, collections
ms = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/spectacle.jsonl')]
def changes(diffs):
    x = 0; lead = 0; ch = 0
    for d in diffs:
        x += d
        now = 1 if x > 0.03 else -1 if x < -0.03 else lead
        if now != lead and lead != 0: ch += 1
        lead = now
    return ch
by = collections.defaultdict(list)
for m in ms: by[tuple(sorted(s['style'] for s in m['sides']))].append(m)
for pair, sel in sorted(by.items()):
    real = shuf = 0
    for m in sel:
        H = m['health']
        d = [(b[0] - b[1]) - (a[0] - a[1]) for a, b in zip(H, H[1:]) if abs((b[0] - b[1]) - (a[0] - a[1])) > 1e-4]
        real += changes(d) > 0
        for _ in range(10):
            dd = d[:]; random.shuffle(dd); shuf += (changes(dd) > 0) / 10
    print(f"{pair}: swings real {real/len(sel):.2f}, shuffled {shuf/len(sel):.2f}")
