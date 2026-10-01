"""Compare every imported field against D1 without exposing private records."""
import json, pathlib, subprocess, sys
bundle, config, database = sys.argv[1:]
expected = json.loads((pathlib.Path(bundle)/'expected.json').read_text())
checked = 0
report=json.loads((pathlib.Path(bundle)/'report.json').read_text())
for table, records in expected.items():
    columns = list(records[0]) if records else []
    if not columns: continue
    query = 'SELECT '+','.join('"'+c+'"' for c in columns)+' FROM '+table
    result = subprocess.run(['npx','wrangler','d1','execute',database,'--remote','--config',config,'--command',query,'--json'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('D1 verification failed for '+table)
    actual = json.loads(result.stdout)[0]['results']
    def normalize(rows):
        return sorted(json.dumps({k:(int(v) if isinstance(v,bool) or isinstance(v,float) and v.is_integer() else v) for k,v in row.items()},sort_keys=True,ensure_ascii=False,separators=(',',':')) for row in rows)
    if normalize(actual) != normalize(records): raise RuntimeError('Imported field mismatch in '+table)
    checked += len(records)
for table in ['auth_session','wagers']:
    query='SELECT count(*) AS n FROM '+table+(' WHERE returned IS NULL' if table=='wagers' else '')
    result=subprocess.run(['npx','wrangler','d1','execute',database,'--remote','--config',config,'--command',query,'--json'],capture_output=True,text=True)
    if result.returncode or json.loads(result.stdout)[0]['results'][0]['n']!=0: raise RuntimeError('Nonempty session or unsettled wager table')
result=subprocess.run(['npx','wrangler','d1','execute',database,'--remote','--config',config,'--command','PRAGMA foreign_key_check','--json'],capture_output=True,text=True)
if result.returncode or json.loads(result.stdout)[0]['results']: raise RuntimeError('Foreign key mismatch')
print(json.dumps({'verification':'pass','recordsCompared':checked,'fields':'all imported fields','credentials':'unchanged','IDs':'unchanged'}))
