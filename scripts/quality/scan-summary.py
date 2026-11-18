"""Publish counts and locations from scanner reports without source snippets or secrets."""
import argparse
from collections import Counter
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('scans', type=Path)
parser.add_argument('eslint', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def basename(value):
    return Path(value.replace('\\', '/')).name

def current_source(value):
    normalized = value.replace('\\', '/')
    return normalized.split('/source/', 1)[-1].split('/RDPBrowser/', 1)[-1]

summary = {'schemaVersion': 1, 'sources': {}}
for filename in ['filesystem-scan.json', 'remoteshield-backend-scan.json', 'remoteshield-nginx-scan.json']:
    path = args.scans / filename
    if not path.is_file():
        summary['sources'][filename] = {'status': 'BLOCKED', 'reason': 'Scanner report missing'}
        continue
    report = read(path)
    advisories = []
    config = []
    for row in report.get('Results', []):
        for finding in row.get('Vulnerabilities', []):
            advisories.append(dict(target=basename(row['Target']), id=finding['VulnerabilityID'], package=finding['PkgName'],
                                   installed=finding.get('InstalledVersion'), fixed=finding.get('FixedVersion'), severity=finding['Severity']))
        for finding in row.get('Misconfigurations', []):
            config.append(dict(target=current_source(row['Target']), id=finding['ID'], severity=finding['Severity'], title=finding.get('Title')))
    summary['sources'][filename] = {'status': 'FAIL' if advisories or config else 'PASS', 'artifact': report.get('ArtifactName'),
                                     'imageId': report.get('Metadata', {}).get('ImageID'), 'advisories': advisories, 'misconfigurations': config,
                                     'severityCounts': dict(Counter(item['severity'] for item in [*advisories, *config]))}
path = args.scans / 'gitleaks.json'
if path.is_file():
    candidates = [{'rule': row['RuleID'], 'file': current_source(row['File']), 'line': row['StartLine']} for row in read(path) or []]
    summary['sources']['gitleaks.json'] = {'status': 'FAIL' if candidates else 'PASS', 'candidates': candidates}
else:
    summary['sources']['gitleaks.json'] = {'status': 'BLOCKED', 'reason': 'Scanner report missing'}
if args.eslint.is_file():
    findings = [{'file': current_source(row['filePath']), 'line': message['line'], 'rule': message['ruleId']}
                for row in read(args.eslint) for message in row['messages']]
    summary['sources']['security-eslint.json'] = {'status': 'FAIL' if findings else 'PASS', 'findings': findings,
                                                  'ruleCounts': dict(Counter(item['rule'] for item in findings))}
else:
    summary['sources']['security-eslint.json'] = {'status': 'BLOCKED', 'reason': 'Analyzer report missing'}
args.output.write_bytes((json.dumps(summary, indent=2)+'\n').encode())
