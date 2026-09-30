"""Do the two ships do the same thing at the same time? From runs/duel/spectacle.jsonl.

For salvos (±3 s) and railgun shots (±1.5 s): the share of one ship's actions matched by the
other's within the window, against a control where the other ship's timeline is shifted
circularly by a random offset (what chance alone gives with the same counts). 1.0× = no more
synchrony than chance. Also salvo sizes and how many were rippled (launches spread in time)."""
import json, sys, random, collections

ms = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/spectacle.jsonl')]
rng = random.Random(1)

def coincide(a, b, win):
    return sum(any(abs(x - y) <= win for y in b) for x in a), len(a)

def sync(get, win):
    hit = n = 0; chit = cn = 0
    for m in ms:
        D = m['duration']
        A, B = get(m['sides'][0]), get(m['sides'][1])
        for P, Q in ((A, B), (B, A)):
            h, k = coincide(P, Q, win); hit += h; n += k
            for _ in range(10):
                off = rng.uniform(0, D)
                Qs = [(q + off) % D for q in Q]
                h, k = coincide(P, Qs, win); chit += h; cn += k
    o, c = hit / max(1, n), chit / max(1, cn)
    return o, c

for name, get, win in (('salvos', lambda s: s['salvo_times'], 3.0), ('railgun shots', lambda s: [x['t'] for x in s['shots']], 1.5)):
    o, c = sync(get, win)
    print(f"{name:14s} matched within ±{win:.1f} s: {100*o:.0f}%  (chance {100*c:.0f}%)  → {o/max(1e-9,c):.2f}× chance")
sz = collections.Counter(); rip = n = 0
for m in ms:
    for s in m['sides']:
        for sv in s.get('salvos', []):
            sz[sv[1]] += 1; rip += sv[2]; n += 1
if n:
    print("salvo sizes:", "  ".join(f"{k}: {100*v/n:.0f}%" for k, v in sorted(sz.items())), f"  rippled: {100*rip/n:.0f}%   ({n} salvos, {n/len(ms)/2:.1f} per ship)")
first = [abs(m['sides'][0]['salvo_times'][0] - m['sides'][1]['salvo_times'][0]) for m in ms if m['sides'][0]['salvo_times'] and m['sides'][1]['salvo_times']]
first.sort()
print(f"first salvos: gap between the two ships' first launches, median {first[len(first)//2]:.1f} s; within 1 s in {100*sum(g <= 1 for g in first)/len(first):.0f}% of fights")
