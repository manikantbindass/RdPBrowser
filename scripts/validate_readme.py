"""Validate README media, local links, SVG safety and animation contracts."""
import json
import re
import hashlib
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
checked = 0
for doc in [ROOT / 'README.md', ROOT / 'docs/README_STATIC.md']:
    text = doc.read_text(encoding='utf8')
    assert ']()' not in text, f'Empty link in {doc.name}'
    targets = re.findall(r'\]\(([^\s)]+)\)', text) + re.findall(r'(?:src|srcset)="([^"\s]+)"', text)
    for target in targets:
        if target.startswith(('https:', 'http:', '#', 'mailto:')):
            continue
        path = (doc.parent / target.split('#')[0]).resolve()
        assert path.exists(), f'Broken local link: {doc.name}: {target}'
        checked += 1

folder = ROOT / 'assets/readme'
manifest = json.loads((folder / 'manifest.json').read_text())
for name, item in manifest['assets'].items():
    path = folder / name
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], f'Hash mismatch: {name}'
    assert path.stat().st_size < 2_000_000, f'Media budget exceeded: {name}'
    if path.suffix == '.svg':
        tree = ET.parse(path)
        assert tree.find('{http://www.w3.org/2000/svg}title') is not None
        assert tree.find('{http://www.w3.org/2000/svg}desc') is not None
        assert not re.search(r'<(?:script|foreignObject)\b|https?://(?!www.w3.org)', path.read_text()), f'Unsafe external SVG content: {name}'
    else:
        with Image.open(path) as image:
            image.verify()
durations = {'remoteshield-hero': 7000, 'remoteshield-footer': 4800,
             'remoteshield-access-flow': 5600, 'remoteshield-network-boundary': 5600}
readme = (ROOT / 'README.md').read_text(encoding='utf8')
for name, duration in durations.items():
    animation = manifest['assets'][f'{name}.gif']
    fallback = manifest['assets'][f'{name}.webp']
    assert animation['durationMs'] == duration and animation['loop'] == 0
    assert fallback['frames'] == 1 and f'srcset="assets/readme/{name}.webp"' in readme
assert readme.count('(prefers-reduced-motion: reduce)') == len(durations)
assert '.gif' not in (ROOT / 'docs/README_STATIC.md').read_text(), 'Static edition contains animation'
report = {'localLinksChecked': checked, 'assetsValidated': len(manifest['assets']), 'animationDurationsMs': durations, 'status': 'PASS'}
print(json.dumps(report, indent=2))
