"""How often the fight reaches inside the ships: crew killed and systems lost by weapon fire
while the fight is still going (more than 5 s before the end), from runs/duel/spectacle.jsonl."""
import json, sys, statistics as st, collections

ms = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'runs/duel/spectacle.jsonl')]
n = len(ms)
def mid(ts, m): return [t for t in ts if t < m['duration'] - 5]
crew = [sum(len(mid(s['crew_hit_death_t'], m)) for s in m['sides']) for m in ms]
parts = [sum(len(mid(s['part_loss_t'], m)) for s in m['sides']) for m in ms]
pdmg = [sum(s['parts_damage'] for s in m['sides']) for m in ms]
print(f"fights {n}")
print(f"H1 crew killed by fire mid-fight: in {100*sum(c > 0 for c in crew)/n:.0f}% of fights; mean {st.mean(crew):.2f} per fight   (want >=40%)")
print(f"H2 systems lost mid-fight: in {100*sum(p > 0 for p in parts)/n:.0f}% of fights; median {st.median(parts):.0f} per fight   (want >=80%, median >=2)")
print(f"   component damage per fight: median {st.median(pdmg):.2f} part-healths")
lost = collections.Counter(p for m in ms for s in m['sides'] for p in s['parts_lost'])
print("   parts lost (all):", ", ".join(f"{k} {v}" for k, v in lost.most_common()))
reasons = collections.Counter(m['reason'] for m in ms)
print("   endings:", ", ".join(f"{k} {100*v/n:.0f}%" for k, v in reasons.most_common()))
alive = collections.Counter(s['crew_alive'] for m in ms for s in m['sides'] if m['winner'] is not None and m['sides'].index(s) == m['winner'])
print("   winner's crew alive at the end:", dict(sorted(alive.items())))
