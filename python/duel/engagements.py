"""Measure range changes after contact, including holds at point-blank range.

Run after spectacle_round_robin. A reversal must move 700 m from an extremum;
small rail dodges don't count. A hold is a 20-second window spanning <500 m.
Report every pairing; no seed filtering or selection of best recordings.
"""
import json
import argparse
import statistics
from collections import defaultdict


def engagement(row):
    history = row['range_history']
    first = next((i for i, h in enumerate(history) if h[1] < 4000), len(history))
    history = history[first:]
    if not history:
        return 0, 0, 0
    anchor = extreme = history[0][1]
    direction = 0
    excursions = 0
    for _, distance, _ in history:
        if direction == 0:
            if abs(distance-anchor) >= 700:
                direction = 1 if distance > anchor else -1
                extreme = distance
                excursions += 1
        elif (distance-extreme)*direction > 0:
            extreme = distance
        elif (distance-extreme)*direction <= -700:
            direction = -direction
            extreme = distance
            excursions += 1
    holds = 0
    windows = 0
    for i in range(19, len(history)):
        window = history[i-19:i+1]
        if window[-1][0] - window[0][0] < 18:
            continue
        windows += 1
        holds += max(h[1] for h in window)-min(h[1] for h in window) < 500
    return excursions, holds, windows


groups = defaultdict(list)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('path', nargs='?', default='runs/duel/spectacle.jsonl')
parser.add_argument('--check', action='store_true', help='fail on prolonged range holding, rare close contact or missing range reversals')
args=parser.parse_args()
for line in open(args.path):
    row=json.loads(line)
    groups['/'.join(sorted(s['style'] for s in row['sides']))].append(row)
    groups['ALL'].append(row)

print('Pair                    N  <1km fights  2+ excursions  held windows  excursions p50')
metrics={}
for pair, rows in sorted(groups.items()):
    measured=[engagement(r) for r in rows]
    close=sum(r['min_dist']<1000 for r in rows)/len(rows)
    changes=sum(m[0]>=2 for m in measured)/len(rows)
    windows=sum(m[2] for m in measured)
    holds=sum(m[1] for m in measured)/max(1,windows)
    print(f'{pair:23} {len(rows):4} {close:12.0%} {changes:14.0%} {holds:13.0%}'
          f' {statistics.median(m[0] for m in measured):15.1f}')
    metrics[pair]=(close,changes,holds)

if args.check:
    failures=[]
    if len(groups['ALL'])<300:
        failures.append('need at least 300 unfiltered fights')
    close,changes,holds=metrics['ALL']
    if close<0.80: failures.append('fewer than 80% of fights reach <1 km')
    if changes<0.85: failures.append('fewer than 85% have 2+ substantial excursions after contact')
    if holds>0.20: failures.append('more than 20% of 20-second windows hold within a 500 m range band')
    for pair, (close,changes,holds) in metrics.items():
        if pair!='ALL' and holds>0.35:
            failures.append(f'{pair}: more than 35% held windows')
        if pair=='Knife/Knife' and (close<0.90 or changes<0.85 or holds>0.15):
            failures.append('Knife mirrors fail close contact / excursions / range hold requirements')
    if any(r['reason']=='unfinished' for r in groups['ALL']):
        failures.append('unfinished fights')
    print('\n'+ ('FAIL: '+'; '.join(failures) if failures else 'PASS: engagement motion checks'))
    raise SystemExit(bool(failures))
