"""Score runs/duel/classes.jsonl: two ship classes, each with its own doctrine."""
import json, collections, statistics as st, math, sys
ms = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/classes.jsonl')]
by = collections.defaultdict(list)
for m in ms: by[m['pairing']].append(m)
def pct(x): return f"{100*x:.0f}%"
def rate(sel, cls):
    w = sum((m['winner'] is not None and m['sides'][m['winner']]['class'] == cls) + 0.5 * (m['winner'] is None) for m in sel)
    return w / len(sel)
res = []
def check(name, ok, detail): res.append((name, ok, detail))

cross = by['cross']; n = len(cross)
r = rate(cross, 'striker'); ci = 1.96 * math.sqrt(r * (1 - r) / n)
check("C1 evenly matched", 0.45 <= r <= 0.55, f"striker {pct(r)} ± {100*ci:.1f} over {n} cross fights (want 45–55%)")

# C2: spectacle on cross fights.
dur = sorted(m['duration'] for m in cross); med = dur[n // 2]
short = sum(d < 40 for d in dur) / n; tout = sum(m['reason'] == 'time' for m in cross) / n
swing = sum(m['lead_changes'] > 0 for m in cross) / n
causes = collections.Counter(m['finish_cause'] for m in cross)
top = causes.most_common(1)[0][1] / n; many = sum(c / n >= 0.10 for c in causes.values())
hits = st.median(sum(sum(s['hits_taken'].values()) for s in m['sides']) for m in cross)
juice = sum(any(s['crew_killed_by_g'] > 0 or s['time_over_14g'] > 0.5 for s in m['sides']) for m in cross) / n
ok2 = 60 <= med <= 150 and short < 0.1 and tout < 0.1 and swing >= 0.5 and top <= 0.5 and many >= 3 and hits >= 4 and 0.05 <= juice <= 0.2
check("C2 dynamic (cross)", ok2, f"median {med:.0f}s, <40s {pct(short)}, time-outs {pct(tout)} · swings {pct(swing)} · killing blows " +
      " ".join(f"{c} {pct(v/n)}" for c, v in causes.most_common(4)) + f" · hits {hits:.0f} · juice {pct(juice)}")

# C3: distinct styles — per class in cross fights.
print("      per class in cross fights:")
beh = {}
for cls in ('striker', 'warden'):
    S = [(m, s, m['sides'][1 - i]) for m in cross for i, s in enumerate(m['sides']) if s['class'] == cls]
    dealt = collections.Counter()
    for m, s, o in S:
        for k, v in o['damage_taken'].items(): dealt[k] += v
    T = sum(dealt.values()) or 1
    shots = [x['range'] for m, s, o in S for x in s['shots']]
    beh[cls] = dict(shot_km=st.median(shots) / 1000 if shots else 0, rail=dealt['railgun'] / T, torp=dealt['torpedo'] / T, pdc=dealt['pdc'] / T)
    print(f"      {cls:8} shot range {beh[cls]['shot_km']:.1f} km · damage dealt: railgun {pct(beh[cls]['rail'])} torpedo {pct(beh[cls]['torp'])} pdc {pct(beh[cls]['pdc'])} · "
          f"salvos {st.mean(len(s['salvo_times']) for m,s,o in S):.1f} · rail shots {st.mean(len(s['shots']) for m,s,o in S):.1f} · juke {st.mean(s['mode_time'].get('juke',0) for m,s,o in S):.0f}s · extend {st.mean(s['mode_time'].get('extend',0) for m,s,o in S):.0f}s")
diff = abs(beh['striker']['torp'] - beh['warden']['torp']) + abs(beh['striker']['rail'] - beh['warden']['rail'])
check("C3 distinct styles", diff >= 0.2 or abs(beh['striker']['shot_km'] - beh['warden']['shot_km']) >= 0.5,
      f"damage-mix difference {diff:.2f} (want ≥0.20) or shot range gap {abs(beh['striker']['shot_km'] - beh['warden']['shot_km']):.1f} km (want ≥0.5)")

# C4: tactic proof — each hull does better with its own doctrine.
own_s, own_w = r, 1 - r
sw_s = rate(by['swap: striker hull flies warden doctrine'], 'striker')
sw_w = 1 - rate(by['swap: warden hull flies striker doctrine'], 'striker')
check("C4 doctrine fits hull", own_s - sw_s >= 0.05 and own_w - sw_w >= 0.05,
      f"striker hull: own doctrine {pct(own_s)} vs warden's {pct(sw_s)} · warden hull: own {pct(own_w)} vs striker's {pct(sw_w)} (want each ≥5 pts better)")

# Sturdiness: hits each class takes before it dies (losers only).
sturdy = {}
for cls in ('striker', 'warden'):
    L = [sum(m['sides'][1 - m['winner']]['hits_taken'].values()) for m in cross if m['winner'] is not None and m['sides'][1 - m['winner']]['class'] == cls]
    sturdy[cls] = st.median(L) if L else 0
ratio = min(sturdy.values()) / max(max(sturdy.values()), 1)
check("S  similar sturdiness", ratio >= 0.8, f"meaningful hits to kill: striker {sturdy['striker']:.0f}, warden {sturdy['warden']:.0f} (want within 20%)")

for label in ('striker mirror', 'warden mirror'):
    sel = by[label]
    print(f"      {label}: median {st.median(m['duration'] for m in sel):.0f}s · swings {pct(sum(m['lead_changes']>0 for m in sel)/len(sel))} · time-outs {pct(sum(m['reason']=='time' for m in sel)/len(sel))}")
print()
for name, ok, detail in res:
    print(f"{'PASS' if ok else 'FAIL'}  {name:24} {detail}")
