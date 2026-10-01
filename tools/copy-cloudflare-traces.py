"""Upload and read back every private recording; log aggregate checks only."""
import gzip, hashlib, json, pathlib, subprocess, sys, tempfile
bundle, bucket = sys.argv[1:]
manifest=json.loads((pathlib.Path(bundle)/'traces.json').read_text())
for item in manifest:
    result=subprocess.run(['npx','wrangler','r2','object','put',bucket+'/'+item['key'],'--remote','--file',item['file'],'--content-type','application/json','--content-encoding','gzip'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('Recording upload failed')
    with tempfile.NamedTemporaryFile(prefix='hardburn-recording-check-',dir='/private/tmp') as check:
        result=subprocess.run(['npx','wrangler','r2','object','get',bucket+'/'+item['key'],'--remote','--file',check.name],capture_output=True,text=True)
        if result.returncode: raise RuntimeError('Recording read-back failed')
        raw=pathlib.Path(check.name).read_bytes()
        if raw.startswith(b'\x1f\x8b'): raw=gzip.decompress(raw)
        if hashlib.sha256(raw).hexdigest()!=item['sha256']: raise RuntimeError('Recording checksum mismatch')
print(json.dumps({'recordingsCopied':len(manifest),'readBackChecksums':'match','bucket':bucket}))
