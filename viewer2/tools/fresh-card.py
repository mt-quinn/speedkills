"""Generate a fresh unfiltered card; reuse odds only for the identical simulation source.
python3 viewer2/tools/fresh-card.py --refresh-odds  # after sim changes
python3 viewer2/tools/fresh-card.py --count 12      # new matchups/seeds, cached odds
"""
import argparse, hashlib, json, pathlib, random, subprocess, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
VIEWER = ROOT / 'viewer2'

def fingerprint():
    h = hashlib.sha256()
    for f in sorted((ROOT / 'crates/duel/src').glob('*.rs')):
        if f.name in ('tests.rs', 'diag.rs', 'trace.rs'): continue
        h.update(f.name.encode()); h.update(f.read_bytes())
    for f in sorted((ROOT / 'crates/sim/src').rglob('*.rs')):
        h.update(str(f.relative_to(ROOT)).encode()); h.update(f.read_bytes())
    return h.hexdigest()

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--count', type=int, default=12)
    p.add_argument('--seed', type=int, default=None)
    p.add_argument('--refresh-odds', action='store_true')
    p.add_argument('--stamp', action='store_true', help='Stamp odds immediately after a verified full league build')
    args = p.parse_args()
    signature = VIEWER / 'league-simulation.sha256'
    if args.stamp:
        signature.write_text(fingerprint() + '\n'); raise SystemExit(0)
    seed = args.seed if args.seed is not None else time.time_ns() // 1000000
    if not 1 <= args.count <= 45: p.error('--count must be 1..45')
    files = [VIEWER / 'matches' / f'L{seed + k}.json' for k in range(args.count)]
    if any(f.exists() for f in files): p.error('Seed overlaps existing recordings; choose a new seed.')
    archives = VIEWER / 'cards'; archives.mkdir(exist_ok=True)
    old = VIEWER / 'matches/index.json'
    if old.exists(): (archives / f'before-{seed}.json').write_bytes(old.read_bytes())
    if args.refresh_odds:
        subprocess.run(['cargo', 'run', '--release', '-p', 'sk-duel', '--bin', 'league', '--', 'build', '--odds', '400', '--card', str(args.count), '--from', str(seed)], cwd=ROOT, check=True)
        signature.write_text(fingerprint() + '\n'); raise SystemExit(0)
    if not signature.exists() or signature.read_text().strip() != fingerprint():
        p.error('Simulation differs from cached odds. Run with --refresh-odds.')
    league = json.loads((VIEWER / 'league.json').read_text())
    rng = random.Random(seed)
    pairs = [(a, b) for a in range(len(league['ships'])) for b in range(a + 1, len(league['ships']))]
    rng.shuffle(pairs)
    chosen = [(b, a) if rng.random() < .5 else (a, b) for a, b in pairs[:args.count]]
    files = [VIEWER / 'matches' / f'L{seed + k}.json' for k in range(args.count)]
    if any(f.exists() for f in files): p.error('Seed overlaps existing recordings; choose a new seed.')
    subprocess.run(['cargo', 'build', '--release', '-p', 'sk-duel', '--bin', 'league'], cwd=ROOT, check=True)
    index = []
    for k, (a, b) in enumerate(chosen):
        subprocess.run([str(ROOT / 'target/release/league'), 'fight', '--a', str(a), '--b', str(b), '--seed', str(seed + k), '--out', str(files[k])], cwd=ROOT, check=True)
        index.append(dict(file=files[k].name, seed=seed+k, ships=[a, b], odds=[league['odds'][a][b], league['odds'][b][a]]))
    old.write_text(json.dumps(index, separators=(',', ':')) + '\n')
    print(f'Wrote {len(index)} unfiltered fights; reload the viewer. No winner, duration or drama filtering.')
