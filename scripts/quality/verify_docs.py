from pathlib import Path
import hashlib,json,re,sys,zipfile,xml.etree.ElementTree as ET
try:
 from PIL import Image as PILImage
except ImportError: PILImage=None
if PILImage is None: raise SystemExit('Pillow is required; install scripts/requirements-readme.txt')
ROOT=Path(__file__).resolve().parents[2]
required=['README.md','CONTRIBUTING.md','SECURITY.md','docs/GETTING_STARTED.md','docs/ARCHITECTURE.md','docs/SECURITY_MODEL.md','docs/THREAT_MODEL.md','docs/API_REFERENCE.md','docs/DEPLOYMENT.md','docs/ADMIN_GUIDE.md','docs/USER_GUIDE.md','docs/TESTING.md','docs/TROUBLESHOOTING.md','docs/ROADMAP.md','docs/RELEASE_PROCESS.md','output/pdf/RemoteShield-X-Technical-Report.pdf','docs/deliverables/RemoteShield-X-Company-Briefing.pptx']
missing=[x for x in required if not (ROOT/x).is_file()]
if missing: raise SystemExit('missing required deliverables: '+', '.join(missing))
md=[ROOT/'README.md',ROOT/'CONTRIBUTING.md',ROOT/'SECURITY.md',*sorted((ROOT/'docs').glob('*.md'))]
link_count=0; image_count=0; broken=[]; unresolved_anchors=[]
link_re=re.compile(r'!?\[([^\]]*)\]\(([^)]+)\)')
def slug(s):
 s=s.strip().lower().replace('`','')
 s=re.sub(r'[^\w\- ]','',s,flags=re.UNICODE)
 return re.sub(r'\s+','-',s)
for mdfile in md:
 if not mdfile.exists(): continue
 content=mdfile.read_text(encoding='utf-8-sig')
 headings=set(); counts={}
 for line in content.splitlines():
  m=re.match(r'^#{1,6}\s+(.+?)\s*#*\s*$',line)
  if m:
   base=slug(m.group(1));n=counts.get(base,0);counts[base]=n+1;headings.add(base if n==0 else f'{base}-{n}')
 for m in link_re.finditer(content):
  label,target=m.group(1),m.group(2).split()[0].strip('<>');link_count+=1
  if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',target) or target.startswith('#'):continue
  path_part,sep,frag=target.partition('#');path_part=path_part.replace('\\','/')
  dest=(mdfile.parent/Path(path_part)).resolve() if path_part else mdfile.resolve()
  if not dest.exists():broken.append(f'{mdfile.relative_to(ROOT).as_posix()} -> {target}');continue
  if dest.suffix.lower() in {'.png','.gif','.webp','.svg','.jpg','.jpeg'}:image_count+=1
  if sep and frag and dest.suffix.lower() in {'.md','.markdown'}:
   target_text=dest.read_text(encoding='utf-8-sig')
   hs=set();hc={}
   for line in target_text.splitlines():
    hm=re.match(r'^#{1,6}\s+(.+?)\s*#*\s*$',line)
    if hm:
     b=slug(hm.group(1));n=hc.get(b,0);hc[b]=n+1;hs.add(b if n==0 else f'{b}-{n}')
   if frag.lower() not in hs:unresolved_anchors.append(f'{mdfile.relative_to(ROOT).as_posix()} -> {target}')
if broken or unresolved_anchors: raise SystemExit('\n'.join(['broken links: '+repr(broken),'unresolved anchors: '+repr(unresolved_anchors)]))
# OpenAPI coverage is compared against the rendered Markdown table, not a hard-coded count.
api=json.loads((ROOT/'contracts/openapi.json').read_text(encoding='utf-8'))
contract={(m.upper(),p) for p,ops in api['paths'].items() for m in ops}
ref=(ROOT/'docs/API_REFERENCE.md').read_text(encoding='utf-8')
catalogue=set(re.findall(r'^\| `(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)` \| `([^`]+)` \|',ref,re.M))
if contract!=catalogue:raise SystemExit(f'OpenAPI catalogue mismatch missing={sorted(contract-catalogue)} extra={sorted(catalogue-contract)}')
# Asset integrity covers requested README animations and capture files.
assets=['assets/readme/remoteshield-hero.gif','assets/readme/remoteshield-footer.gif','assets/readme/remoteshield-hero.webp','assets/readme/remoteshield-logo.svg','assets/readme/architecture.svg','assets/readme/security-workflow.svg','assets/readme/desktop-browser.png','assets/readme/admin-dashboard.png','assets/readme/device-management.png','assets/readme/policy-management.png']
ledger=(ROOT/'assets/readme/SCREENSHOTS.md').read_text(encoding='utf-8-sig')
if 'android-browser.png' not in ledger or 'requires a provisioned' not in ledger: raise SystemExit('Android screenshot blocker is not documented in the capture ledger')
asset_report=[]
manifest=json.loads((ROOT/'assets/readme/manifest.json').read_text(encoding='utf-8'))
for rel in assets:
 p=ROOT/rel
 if not p.is_file(): raise SystemExit('missing README asset: '+rel)
 b=p.read_bytes();ext=p.suffix.lower();ok={'.png':b.startswith(bytes([137])+b'PNG\r\n\x1a\n'),'.gif':b.startswith((b'GIF87a',b'GIF89a')),'.webp':b.startswith(b'RIFF') and b[8:12]==b'WEBP','.svg':True}[ext]
 if ext=='.svg': ET.fromstring(b)
 if not ok:raise SystemExit('invalid asset signature: '+rel)
 entry=manifest.get('assets',{}).get(p.name)
 if entry and (entry.get('bytes')!=len(b) or entry.get('sha256')!=hashlib.sha256(b).hexdigest()):raise SystemExit('asset manifest mismatch: '+rel)
 dim=None
 if PILImage and ext in {'.png','.gif','.webp'}:
  with PILImage.open(p) as im:
   dim={'width':im.width,'height':im.height,'frames':getattr(im,'n_frames',1)}
   if ext=='.gif':
    duration=sum((im.seek(i) or im.info.get('duration',0)) for i in range(im.n_frames));loop=im.info.get('loop')
    dim.update({'duration_ms':duration,'loop':loop})
    if loop!=0 or (p.name=='remoteshield-hero.gif' and duration!=7000) or (p.name=='remoteshield-footer.gif' and duration!=4800):raise SystemExit('animation timing or loop mismatch: '+rel)
 asset_report.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'dimensions':dim})
# Verify PDF and PPTX structure at the file level.
pdf=ROOT/'output/pdf/RemoteShield-X-Technical-Report.pdf';ppt=ROOT/'docs/deliverables/RemoteShield-X-Company-Briefing.pptx'
if not pdf.read_bytes().startswith(b'%PDF-'):raise SystemExit('invalid PDF signature')
with zipfile.ZipFile(ppt) as z:
 bad=z.testzip()
 if bad:raise SystemExit('corrupt PPTX member: '+bad)
 slides=[n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)]
 if len(slides)!=18:raise SystemExit(f'expected 18 PPTX slides, found {len(slides)}')
# Ensure requested Mermaid diagrams are in balanced fenced blocks.
arch=(ROOT/'docs/ARCHITECTURE.md').read_text(encoding='utf-8-sig')
if arch.count('```mermaid')<2 or arch.count('```')%2:raise SystemExit('architecture diagrams missing or Markdown fences unbalanced')
readme=(ROOT/'README.md').read_text(encoding='utf-8-sig')
if 'prefers-reduced-motion' not in readme or 'remoteshield-hero.webp' not in readme or 'remoteshield-footer.webp' not in readme:raise SystemExit('README reduced-motion static fallbacks missing')
report={'status':'pass','markdown_files':len([f for f in md if f.exists()]),'relative_links_checked':link_count,'broken_links':len(broken),'broken_anchors':len(unresolved_anchors),'openapi_operations':len(contract),'catalogue_operations':len(catalogue),'required_readme_assets':asset_report,'architecture_mermaid_blocks':arch.count('```mermaid'),'android_screenshot':'not captured; blocker documented in SCREENSHOTS.md','pdf_bytes':pdf.stat().st_size,'pptx_bytes':ppt.stat().st_size,'pptx_slides':len(slides)}
(ROOT/'docs/deliverables/validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
