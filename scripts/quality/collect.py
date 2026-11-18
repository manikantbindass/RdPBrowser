"""Merge explicit captures by check timestamp; preserve failures and exact evidence hashes."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from run import catalog,redact

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('captures',nargs='+')
parser.add_argument('--output',default='docs/audit/phase13')
args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
checks={}
for folder in map(Path,args.captures):
    report=folder/'results.json'
    if not report.exists():parser.error(f'Missing capture {report}')
    for key,row in json.loads(report.read_text(encoding='utf8'))['checks'].items():
        if row['status']=='SKIPPED':continue
        if key not in checks or row.get('startedAt','')>checks[key].get('startedAt',''):
            checks[key]={**row,'capture':str(folder)}
if not checks:parser.error('No executed checks in captures')
for check in catalog():
    checks.setdefault(check['id'],{**check,'status':'SKIPPED','reason':'No capture selected for this check'})
for key,row in checks.items():
    if row['status']=='SKIPPED':continue
    source=Path(row['capture'])/row.get('log','missing')
    if not source.is_file():parser.error(f'Missing log for executed check {key}')
    original=source.read_bytes()
    original_hash=hashlib.sha256(original).hexdigest()
    if original_hash!=row['logSha256']:
        parser.error(f'Evidence hash differs for {key}')
    target=out/(key+'.log')
    published=('\n'.join(line.rstrip() for line in redact(original.decode('utf8',errors='replace')).splitlines()).rstrip()+'\n').encode()
    if target.resolve()==source.resolve():parser.error('Choose a publication directory separate from the captures')
    target.write_bytes(published)
    row['sourceLogSha256']=original_hash
    row['logSha256']=hashlib.sha256(published).hexdigest()
report={'schemaVersion':1,'checks':checks,'summary':dict(Counter(row['status'] for row in checks.values())),
        'accepted':all(row['status']=='PASS' for row in checks.values())}
(out/'results.json').write_bytes((json.dumps(report,indent=2)+'\n').encode())
lines=['# Automated quality capture','', 'Acceptance: '+('PASS' if report['accepted'] else 'PARTIAL / NOT ACCEPTED'),'', '| Check | Status | Seconds | Evidence |','|---|---|---|---|']
for key,row in sorted(checks.items()):
    evidence=f'[{key}.log]({key}.log)' if 'log' in row else row['reason']
    lines.append(f'| {key} | {row["status"]} | {row.get("seconds", "")} | {evidence} |')
(out/'QUALITY_REPORT.md').write_bytes(('\n'.join(lines)+'\n').encode())
print(json.dumps(report['summary']))
raise SystemExit(0 if report['accepted'] else 1)
