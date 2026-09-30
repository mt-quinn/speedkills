"""Score runs/duel/spectacle.jsonl against the spectacle gate (see DESIGN-v2 §13)."""
import json, collections, sys, statistics as st

ms = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/spectacle.jsonl')]
n = len(ms)
def pct(x): return f"{100*x:.0f}%"
res = []
def check(name, ok, detail): res.append((name, ok, detail))

dur = sorted(m['duration'] for m in ms)
med = dur[n // 2]
short = sum(d < 40 for d in dur) / n
timeout = sum(m['reason'] == 'time' for m in ms) / n
check("G1 length", 60 <= med <= 150 and short < 0.10 and timeout < 0.10,
      f"median {med:.0f}s, <40s {pct(short)}, time-outs {pct(timeout)}  (want 60–150, <10%, <10%)")

# G2: no dominant tactic.
styles = sorted({s['style'] for m in ms for s in m['sides']})
wins = collections.Counter(); games = collections.Counter(); h2h = collections.defaultdict(lambda: [0, 0])
for m in ms:
    a, b = m['sides'][0]['style'], m['sides'][1]['style']
    for i, st_ in enumerate((a, b)):
        games[st_] += 1
        if m['winner'] == i: wins[st_] += 1
        elif m['winner'] is None: wins[st_] += 0.5
    if a != b:
        key = tuple(sorted((a, b)))
        h2h[key][1] += 1
        if m['winner'] is not None:
            h2h[key][0] += 1 if m['sides'][m['winner']]['style'] == key[0] else 0
        else:
            h2h[key][0] += 0.5
rates = {s: wins[s] / games[s] for s in styles}
beats_all = [s for s in styles if len(styles) > 1 and all(
    (h2h[tuple(sorted((s, o)))][0] / max(1, h2h[tuple(sorted((s, o)))][1]) if tuple(sorted((s, o)))[0] == s
     else 1 - h2h[tuple(sorted((s, o)))][0] / max(1, h2h[tuple(sorted((s, o)))][1])) > 0.55 for o in styles if o != s)]
check("G2 no dominant tactic", len(styles) >= 3 and all(0.35 <= r <= 0.65 for r in rates.values()) and not beats_all,
      f"overall {', '.join(f'{s} {pct(r)}' for s, r in rates.items())}; beats everyone (>55%): {beats_all or 'none'}; styles {len(styles)} (want ≥3)")
for k, (w, g) in sorted(h2h.items()):
    print(f"      {k[0]} vs {k[1]}: {pct(w / g)} for {k[0]}")

swing = sum(m['lead_changes'] > 0 for m in ms) / n
trailed = sum(m['winner_trailed'] for m in ms if m['winner'] is not None) / max(1, sum(m['winner'] is not None for m in ms))
check("G3 swings", swing >= 0.50, f"lead changed in {pct(swing)} of fights; winner was behind at some point in {pct(trailed)}  (want ≥50%)")

causes = collections.Counter(m['finish_cause'] for m in ms)
top = causes.most_common(1)[0][1] / n
many = sum(c / n >= 0.10 for c in causes.values())
check("G4 varied endings", top <= 0.50 and many >= 3, "killing blow: " + "  ".join(f"{c} {pct(v / n)}" for c, v in causes.most_common(5)))
l10 = collections.Counter(m.get('finish_last10', '') for m in ms)
print("      (most damage in the final 10 s, for comparison: " + "  ".join(f"{c} {pct(v / n)}" for c, v in l10.most_common(4)) + ")")

hits = [sum(sum(s['hits_taken'].values()) for s in m['sides']) for m in ms]
check("G5 exchanges", st.median(hits) >= 4, f"median meaningful hits per fight {st.median(hits):.0f}  (want ≥4)")

juice = sum(any(s['crew_killed_by_g'] > 0 or s['time_over_14g'] > 0.5 for s in m['sides']) for m in ms) / n
check("G6 the juice", 0.05 <= juice <= 0.20, f"lethal-g burns or g deaths in {pct(juice)} of fights  (want 5–20%)")

# Behaviour: a style that doesn't fly differently isn't a style.
print("\n      behaviour by style:")
bb = collections.defaultdict(lambda: collections.defaultdict(list))
for m in ms:
    for i, s_ in enumerate(m['sides']):
        b = bb[s_['style']]
        b['shot_km'] += [x['range'] / 1000 for x in s_['shots']]
        b['near_s'].append(m['time_within_1200m']); b['vents'].append(s_['rail_vents'])
        b['juke_s'].append(s_['mode_time'].get('juke', 0)); b['torp_hits'].append(s_['torps_hit'])
        b['pdc_hits'].append(s_['pdc_hits_dealt']); b['overcharges'].append(s_['overcharges'])
        b['min_dist'].append(m['min_dist'])
for k, b in sorted(bb.items()):
    print(f"      {k:10} shot range {st.median(b['shot_km']):.1f} km · <1.2 km {st.mean(b['near_s']):4.0f} s · juke {st.mean(b['juke_s']):3.0f} s · vents {st.mean(b['vents']):.1f} · overcharges {st.mean(b['overcharges']):.1f} · torp hits {st.mean(b['torp_hits']):.2f} · PDC hits {st.mean(b['pdc_hits']):4.0f} · fight min dist {st.median(b['min_dist']):.0f} m")
print()
for name, ok, detail in res:
    print(f"{'PASS' if ok else 'FAIL'}  {name:24} {detail}")
