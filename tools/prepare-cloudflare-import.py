"""Build a private, repeatable Convex -> D1/R2 import bundle; never print records.

Usage: python3 tools/prepare-cloudflare-import.py snapshot.zip /private/tmp/bundle
The target D1 database must be empty and in maintenance. Rehearsal snapshots are
not valid cutover snapshots: production must first reach its frozen marker.
"""
import hashlib, gzip, json, os, pathlib, sys, zipfile

source, destination = map(pathlib.Path, sys.argv[1:3])
require_frozen = '--require-frozen' in sys.argv[3:]
destination.mkdir(mode=0o700)
os.chmod(destination, 0o700)
statements, manifest, expected = [], [], {}

def literal(value):
    if value is None: return 'NULL'
    if isinstance(value, bool): return str(int(value))
    if isinstance(value, (int, float)):
        if value != value or abs(value) == float('inf'): raise ValueError('Non-finite value')
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"

def insert(table, record):
    expected.setdefault(table, []).append(record)
    statements.append(f'INSERT INTO {table} ({",".join(record)}) VALUES ({",".join(map(literal, record.values()))});')

def encoded(value): return json.dumps(value, separators=(',', ':'), ensure_ascii=False)
def money(value):
    if not isinstance(value, (float, int)) or int(value) != value or value % 100:
        raise ValueError('Invalid monetary units; refusing import')
    return int(value)

with zipfile.ZipFile(source) as archive:
    names = set(archive.namelist())
    def rows(table):
        filename = table + '/documents.jsonl'
        return [json.loads(line) for line in archive.read(filename).decode().splitlines() if line.strip()] if filename in names else []
    data = {t: rows(t) for t in ['users','authAccounts','players','ships','fights','wagers','ledger','messages','mutes','reports','odds','channel','migrationControl','_storage']}
    if len(data['channel']) != 1: raise ValueError('Expected exactly one league channel')
    ch = data['channel'][0]
    users = {u['_id']: u for u in data['users']}
    players = {p['_id']: p for p in data['players']}
    fights = {f['_id']: f for f in data['fights']}
    for p in players.values():
        if p.get('userId') and p['userId'] not in users: raise ValueError('Missing player account')
    for w in data['wagers']:
        if w['player'] not in players or w['fight'] not in fights: raise ValueError('Orphan wager')
    statements.append('DROP TRIGGER provision_player;')
    for u in users.values():
        insert('auth_user', dict(id=u['_id'], name=u['name'], email=u['email'].strip().lower(), emailVerified=bool(u.get('emailVerificationTime')), createdAt=u['_creationTime'], updatedAt=u['_creationTime'], username=u.get('usernameKey',u['name'].lower()), displayUsername=u['name']))
    accounts = []
    for a in data['authAccounts']:
        if a['provider'] != 'password' or a['userId'] not in users: raise ValueError('Unsupported credential provider')
        import re
        if not re.fullmatch('[a-f0-9]{32}:[a-f0-9]{128}', a.get('secret','')): raise ValueError('Unsupported password format')
        insert('auth_account', dict(id=a['_id'], accountId=a['userId'], providerId='credential', userId=a['userId'], password=a['secret'], createdAt=a['_creationTime'], updatedAt=a['_creationTime']))
        accounts.append(a['userId'])
    if set(accounts) != set(users): raise ValueError('An account is missing its password')
    for p in players.values():
        if sum(money(l['amount']) for l in data['ledger'] if l['player'] == p['_id']) != money(p['balance']):
            raise ValueError('Player balance does not reconcile with its ledger')
    for p in players.values():
        insert('players', dict(id=p['_id'], user_id=p.get('userId'), legacy_token_hash=hashlib.sha256(p['token'].encode()).hexdigest() if p.get('token') else None, name=p['name'], balance=money(p['balance']), last_chat=p['lastChat'], last_recovery=p['lastRecovery'], candidate_json=encoded(p['candidate']) if p.get('candidate') else None, created_at=p['_creationTime']))
    for s in data['ships']:
        if s.get('owner') and s['owner'] not in players: raise ValueError('Missing ship owner')
        insert('ships', dict(id=s['_id'], owner_id=s.get('owner'), name=s['name'], style=s['style'], identity=s['identity'], revision=s['revision'], crew_json=encoded(s['crew']), roster_index=s.get('rosterIndex'), testing=bool(s.get('testing')), earnings=money(s['earnings']), wins=s['wins'], fights=s['fights'], last_fight=s['lastFight']))
    available = {}
    for metadata in data['_storage']:
        storage_id = metadata['_id']
        candidates = [n for n in names if n.startswith('_storage/') and n != '_storage/documents.jsonl' and (n.split('/')[-1].split('.')[0] in [storage_id, metadata.get('internalId')])]
        if len(candidates) != 1: raise ValueError('Storage manifest/file mismatch')
        raw = archive.read(candidates[0]); json.loads(raw)
        digest = hashlib.sha256(raw).hexdigest()
        key = f'traces/import/{storage_id}/{digest}.json.gz'
        filename = destination / (storage_id + '.json.gz')
        filename.write_bytes(gzip.compress(raw, mtime=0)); os.chmod(filename, 0o600)
        manifest.append(dict(storageId=storage_id, key=key, file=str(filename), sha256=digest, rawBytes=len(raw)))
        available[storage_id] = key
    for f in fights.values():
        for snap in f['ships']:
            if not any(s['_id'] == snap['id'] for s in data['ships']): raise ValueError('Missing fight ship')
        insert('fights', dict(id=f['_id'], sequence=f['sequence'], ships_json=encoded(f['ships']), odds_json=encoded(f['odds']), odds_samples=f['oddsSamples'], odds_key=f['oddsKey'], seed=f['seed'], duration=f['duration'], winner=f['winner'], stats_json=encoded(f['stats']), story=f['story'], trace_key=available.get(f['trace']), replay_unavailable=f['trace'] not in available, crowd_json=encoded([money(n) for n in f['crowd']]), opens_at=f.get('opensAt'), starts_at=f.get('startsAt'), ends_at=f.get('endsAt'), next_at=f.get('nextAt'), settled=f['settled'], live_started=bool(f.get('liveStarted')), owner_payout=money(f.get('ownerPayout',0))))
    for w in data['wagers']:
        insert('wagers', dict(id=w['_id'], player_id=w['player'], fight_id=w['fight'], side=w['side'], stake=money(w['stake']), payout=money(w['payout']), returned=money(w['returned']) if 'returned' in w else None, net=money(w['net']) if 'net' in w else None))
    for l in data['ledger']:
        insert('ledger', dict(id=l['_id'], player_id=l['player'], fight_id=l.get('fight'), kind=l['kind'], amount=money(l['amount']), balance=money(l['balance']), note=l['note'], effect_key='import:'+l['_id'], created_at=l['_creationTime']))
    for m in data['messages']:
        insert('messages', dict(id=m['_id'], player_id=m['player'], name=m['name'], ship=m.get('ship'), body=m['body'], fight_id=m.get('fight'), created_at=m['_creationTime']))
    for m in data['mutes']: insert('mutes', dict(player_id=m['player'], muted_id=m['muted']))
    for r in data['reports']: insert('reports', dict(player_id=r['player'], message_id=r['message']))
    for o in data['odds']: insert('odds_cache', dict(key=o['key'], probability=o['probability'], samples=o['samples'], simulator_hash=o['key'].split(',')[0], created_at=o['_creationTime']))
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    fields = dict(current_id=ch.get('current'), pending_id=ch.get('pending'), generation=ch['generation'], queue_json=encoded(ch.get('queue',[])), preparing=0, phase='maintenance', maintenance=1, next_at=None, error=None, reopened_at=None, new_writes_at=None, import_source_hash=source_hash)
    statements.append('UPDATE league_state SET '+','.join(k+'='+literal(v) for k,v in fields.items())+",revision=revision+1 WHERE id='live';")
    trigger = pathlib.Path('cloudflare/migrations/0004_timestamps_and_limits.sql').read_text().split('-- statement-break')[1]
    statements.append(trigger)
    frozen = any(r.get('frozen') for r in data['migrationControl'])
    current = fights.get(ch.get('current'))
    if require_frozen and (not frozen or not current or not current['settled'] or any('returned' not in w for w in data['wagers'])):
        raise ValueError('Cutover requires a frozen, settled snapshot with no outstanding wagers')
    report = dict(sourceSha256=source_hash, frozen=frozen,
      currentSettled=bool(current and current['settled']), rows={t:len(v) for t,v in data.items() if not t.startswith('_')},
      balanceTotal=sum(money(p['balance']) for p in players.values()), ledgerAmountTotal=sum(money(l['amount']) for l in data['ledger']),
      recordings=len(manifest), missingRecordings=sum(f['trace'] not in available for f in fights.values()),
      credentialAccounts=len(accounts), sessionsImported=0,
      perPlayerLedger='match', lastAnnouncedSequence=current['sequence'] if current else None,
      queueSha256=hashlib.sha256(encoded(ch.get('queue',[])).encode()).hexdigest())
    expected['league_state'] = [dict(id='live', **fields)]
    for filename, content in [('expected.json',encoded(expected)),('import.sql','\n'.join(statements)),('statements.json',encoded(statements)),('traces.json',encoded(manifest)),('report.json',json.dumps(report,indent=2))]:
        path=destination/filename; path.write_text(content); os.chmod(path,0o600)
    print(json.dumps(report))
