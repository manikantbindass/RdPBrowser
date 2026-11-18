#!/usr/bin/env python3
"""Reproducible quality catalog. Unavailable prerequisites never count as passes."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT_FILES = {'backend-unit':('backend-jest.json',), 'database':('database-jest.json','admin-playwright.json')}


def catalog():
    node = shutil.which('node') or 'node'
    checks = []
    def add(name, category, argv, cwd='.', prerequisites=(), timeout=600):
        checks.append(dict(id=name, category=category, argv=argv, cwd=cwd, prerequisites=list(prerequisites), timeout=timeout))
    add('backend-lint','static',[node,'backend/node_modules/eslint/bin/eslint.js','backend/src','--ext','.js','--max-warnings','0'], prerequisites=['backend/node_modules'])
    add('security-lint','static',[node,'node_modules/eslint/bin/eslint.js','src','--ext','.js','--config','security.eslintrc.cjs','--format','json','--output-file','{out}/security-eslint.json','--max-warnings','0'],'backend',['backend/node_modules'])
    add('backend-unit','unit/auth/authorization/contracts',[node,'node_modules/jest/bin/jest.js','--runInBand','--detectOpenHandles','--json','--outputFile={out}/backend-jest.json'], 'backend', ['backend/node_modules'])
    add('database','migration/API/tenant/identity/e2e/accessibility',['pwsh','-NoProfile','-File','scripts/quality/database.ps1'],timeout=600)
    add('admin-components','admin',[node,'--test','test/components.test.js'],'admin-dashboard')
    add('desktop-state','desktop',[node,'--experimental-strip-types','--test','tests/state.test.mjs'],'desktop')
    add('desktop-types','desktop',[node,'node_modules/typescript/bin/tsc'],'desktop',['desktop/node_modules'])
    add('desktop-build','desktop',[node,'node_modules/vite/bin/vite.js','build'],'desktop',['desktop/node_modules'])
    add('desktop-ui','desktop/accessibility',[node,'node_modules/@playwright/test/cli.js','test','test/desktop.spec.js','--reporter=json'],'admin-dashboard',['desktop/dist/index.html'])
    for name,arguments in [('rust-format',['fmt','--','--check']),('rust-tests',['test','--locked','--offline']),('rust-clippy',['clippy','--locked','--offline','--all-targets','--','-D','warnings'])]:
        add(name,'rust',['cargo',*arguments],'desktop/src-tauri',timeout=1200)
    for operation in ['analyze','test','integration']:
        add('flutter-'+operation,'android',['pwsh','-NoProfile','-File','scripts/quality/android.ps1',operation],timeout=1200)
    for folder in ['backend','desktop','admin-dashboard']:
        add(folder+'-audit','dependency',['pwsh','-NoProfile','-Command','npm audit --omit=dev --json'],folder)
    add('secret-signatures','secret',[node,'scripts/scan-backend-secrets.mjs','{out}/secret-signatures.json'])
    add('readme-links','documentation',['python','scripts/validate_readme.py'])
    linux_script='scripts/quality/linux.sh'
    linux_command=['wsl','-d',os.environ.get('RSX_QUALITY_WSL_DISTRO','RemoteShieldPhase08'),'--','bash',linux_script] if os.name=='nt' else ['bash',linux_script]
    for mode in ['native','compose','production','development','scan']:
        add('linux-'+mode,'network/container/security/performance',[*linux_command,mode],timeout=1800)
    return checks


def redact(text):
    text=re.sub(r'(?i)(postgres(?:ql)?://[^:/\s]+:)[^@\s]+@',r'\1[REDACTED]@',text)
    text=re.sub(r'(https?://(?:127\.0\.0\.1|localhost):\d+/)[A-Za-z0-9_-]{8,}={1,2}/',r'\1[REDACTED_VM_SERVICE]/',text)
    return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[REDACTED_JWT]',text)


def test_report_problem(check, out, output):
    """A successful process must also have executed its required assertions."""
    def read_report(name):
        return json.loads((out/name).read_text(encoding='utf-8-sig'))

    try:
        if check in ('backend-unit','database'):
            report=read_report('backend-jest.json' if check=='backend-unit' else 'database-jest.json')
            if not report['numPassedTests'] or report['numFailedTests'] or report['numPendingTests'] or report['numTodoTests']:
                return 'Jest reported zero passes or unexpected test statuses'
        if check in ('desktop-ui','database'):
            stats=(json.loads(output) if check=='desktop-ui' else read_report('admin-playwright.json'))['stats']
            if not stats['expected'] or stats['unexpected'] or stats['skipped'] or stats['flaky']:
                return 'Playwright reported zero passes or unexpected test statuses'
        if check in ('flutter-test','flutter-integration'):
            records=[json.loads(line) for line in output.splitlines() if line.startswith('{')]
            cases=[row for row in records if row.get('type')=='testDone' and not row.get('hidden')]
            if not cases or any(row.get('skipped') or row.get('result')!='success' for row in cases):
                return 'Flutter reported zero passes or unexpected test statuses'
    except (ValueError, KeyError, OSError):
        return 'Expected machine-readable test report missing or invalid'
    return None


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--select',default='all',help='Comma-separated check IDs, or all')
    parser.add_argument('--output',default='.quality-results')
    parser.add_argument('--list',action='store_true')
    args=parser.parse_args()
    definitions=catalog()
    if args.list:
        print(json.dumps(definitions,indent=2));return
    selected=set(args.select.split(','))
    if selected!={'all'} and selected-set(row['id'] for row in definitions):
        parser.error('Unknown check ID')
    out=(ROOT/args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    destination=out/'results.json'
    report=json.loads(destination.read_text()) if destination.exists() else {'schemaVersion':1,'checks':{}}
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    patch=subprocess.check_output(['git','diff','HEAD','--binary'],cwd=ROOT)
    untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'],cwd=ROOT).split(b'\0')
    digest=hashlib.sha256(patch)
    for filename in sorted(set(untracked)-{b''}):
        relative=Path(os.fsdecode(filename))
        if (ROOT/relative).is_file() and not (ROOT/relative).is_relative_to(out):
            digest.update(filename+b'\0'+hashlib.sha256((ROOT/relative).read_bytes()).digest())
    for check in definitions:
        if selected!={'all'} and check['id'] not in selected:
            continue
        row={**check,'revision':revision,'workingTreeSha256':digest.hexdigest(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        argv=[part.replace('{out}',str(out)) for part in check['argv']]
        missing=[value for value in check['prerequisites'] if not (ROOT/value).exists()]
        if not shutil.which(argv[0]):missing.append(argv[0])
        started=time.monotonic();output=''
        if missing:
            row.update(status='BLOCKED',reason='Missing prerequisite: '+', '.join(missing),exitCode=None)
        else:
            for filename in REPORT_FILES.get(check['id'],()):
                (out/filename).unlink(missing_ok=True)
            env={**os.environ,'RSX_QUALITY_OUTPUT':str(out)}
            scratch=ROOT/'.local-tests/quality-tmp';scratch.mkdir(parents=True,exist_ok=True)
            env.update(TEMP=str(scratch),TMP=str(scratch),TMPDIR=str(scratch))
            env['npm_config_cache']=str(scratch/'npm-cache')
            if argv[0]=='wsl':
                forwarded='RSX_QUALITY_OUTPUT/p:RSX_QUALITY_IMAGES:RSX_SCANNER_DIRECTORY'
                env['WSLENV']=':'.join(filter(None,[env.get('WSLENV'),forwarded]))
            try:
                process=subprocess.run(argv,cwd=ROOT/check['cwd'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=check['timeout'])
                output=redact(process.stdout.decode('utf8',errors='replace'))
                row.update(status='PASS' if process.returncode==0 else 'BLOCKED' if process.returncode==77 else 'FAIL',exitCode=process.returncode)
                if row['status']=='PASS' and (problem:=test_report_problem(check['id'],out,output)):
                    row.update(status='FAIL',reason=problem)
            except subprocess.TimeoutExpired as error:
                output=redact((error.stdout or b'').decode('utf8',errors='replace'))
                row.update(status='FAIL',reason='Execution deadline exceeded',exitCode=None)
            except OSError as error:
                row.update(status='BLOCKED',reason=type(error).__name__,exitCode=None)
        row['seconds']=round(time.monotonic()-started,3)
        if row['status']=='BLOCKED' and 'reason' not in row:
            row['reason']=next((line.removeprefix('BLOCKED: ') for line in output.splitlines() if line.startswith('BLOCKED: ')), 'Test prerequisite unavailable')
        path=out/(check['id']+'.log')
        path.write_bytes(('\n'.join(line.rstrip() for line in output.splitlines())+'\n').encode())
        row['log']=path.name;row['logSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        report['checks'][check['id']]=row
        report['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        destination.write_bytes((json.dumps(report,indent=2)+'\n').encode())
        print(check['id']+': '+row['status'],flush=True)
    # Absent checks are explicit, never silently counted as successful.
    for check in definitions:
        report['checks'].setdefault(check['id'],{**check,'status':'SKIPPED','reason':'Not selected in this capture'})
    statuses=[row['status'] for row in report['checks'].values()]
    report['summary']={value:statuses.count(value) for value in ['PASS','FAIL','BLOCKED','SKIPPED']}
    report['accepted']=all(value=='PASS' for value in statuses)
    destination.write_bytes((json.dumps(report,indent=2)+'\n').encode())
    lines=['# Automated quality results','',f'Acceptance: {"PASS" if report["accepted"] else "PARTIAL / NOT ACCEPTED"}','', '| Check | Category | Status | Evidence |','|---|---|---|---|']
    lines += [f'| {row["id"]} | {row["category"]} | {row["status"]} | {row.get("log",row.get("reason",""))} |' for row in report['checks'].values()]
    (out/'QUALITY_REPORT.md').write_bytes(('\n'.join(lines)+'\n').encode())
    return 0 if report['accepted'] else 1


if __name__=='__main__':
    raise SystemExit(main())
