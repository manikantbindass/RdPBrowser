"""Rebuild original README media. No network, fake screenshots, or product changes.

Install scripts/requirements-readme.txt, then run from any working directory.
Use --font-regular/--font-bold to reproduce the chosen Segoe UI font inputs on
another host; no proprietary font files are redistributed.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/readme"
SOURCE = OUT / "source"
NAVY = "#071426"
PANEL = "#0d2038"
CYAN = "#58e7f3"
BLUE = "#2788ff"
WHITE = "#f1f7ff"
MUTED = "#adc3db"


def svg_document(width, height, title, description, content):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
<title id="title">{html.escape(title)}</title><desc id="desc">{html.escape(description)}</desc>
<defs><linearGradient id="accent"><stop stop-color="{CYAN}"/><stop offset="1" stop-color="{BLUE}"/></linearGradient>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="{CYAN}"/></marker></defs>
<rect width="{width}" height="{height}" rx="20" fill="{NAVY}"/>
<g font-family="Segoe UI,Arial,sans-serif">{content}</g></svg>\n'''


def label(x, y, value, size=20, color=WHITE, weight=400):
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}">{html.escape(value)}</text>'


def box(x, y, width, heading, lines, accent=CYAN):
    content = f'<rect x="{x}" y="{y}" width="{width}" height="112" rx="12" fill="{PANEL}" stroke="#244364"/>'
    content += f'<rect x="{x}" y="{y+18}" width="3" height="28" fill="{accent}"/>'
    content += label(x+22, y+35, heading, 22, WHITE, 600)
    for index, line in enumerate(lines):
        content += label(x+22, y+65+index*23, line, 17, MUTED)
    return content


def arrow(x1, y1, x2, y2, dashed=False):
    dash = ' stroke-dasharray="6 6"' if dashed else ''
    return f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{CYAN}" stroke-width="2" marker-end="url(#arrow)"{dash}/>'


def write_vectors():
    logo = '<path d="M42 8L72 20V43C72 63 59 78 42 88C25 78 12 63 12 43V20Z" fill="#0d2038" stroke="url(#accent)" stroke-width="4"/><path d="M31 45V37A11 11 0 0 1 53 37V45M29 45H55V64H29Z" fill="none" stroke="#58e7f3" stroke-width="3" stroke-linejoin="round"/>'
    logo += label(98, 47, 'RemoteShield X', 36, WHITE, 600)
    logo += label(100, 73, 'Remote access. Explicit control.', 17, MUTED)
    (OUT / 'remoteshield-logo.svg').write_text(svg_document(460, 96, 'RemoteShield X', 'Original shield and lock mark. Remote access. Explicit control.', logo), encoding='utf8', newline='\n')

    graph = label(42, 52, 'Control decisions. Separate enforcement.', 31, WHITE, 600)
    graph += label(42, 84, 'Current modular architecture · not a network-protection certification', 18, MUTED)
    graph += label(42, 132, 'CONTROL PLANE', 15, CYAN, 600)
    graph += box(42, 158, 280, 'Clients', ['Desktop · Android · Admin', 'Independent runtime boundaries'])
    graph += box(400, 158, 350, 'Nginx + backend', ['Versioned API · session checks', 'Config · policy decisions · events'])
    graph += box(830, 158, 328, 'PostgreSQL', ['Users · sessions · legacy rules', 'Explicit migration history'])
    graph += arrow(324, 214, 397, 214) + arrow(752, 214, 827, 214)
    graph += '<path d="M42 316H1158" stroke="#244364" stroke-dasharray="5 8"/>'
    graph += label(42, 355, 'NETWORK / NATIVE ENFORCEMENT', 15, CYAN, 600)
    graph += box(42, 382, 280, 'Native + OS policy', ['WebView navigation · firewall', 'Routing · DNS · IPv4 / IPv6'])
    graph += box(400, 382, 350, 'WireGuard + VPS', ['Tunnel · routing / NAT', 'Separate privileged deployment'])
    graph += box(830, 382, 328, 'Destination', ['Website traffic flows here', 'Not through the policy API'])
    graph += arrow(324, 438, 397, 438) + arrow(752, 438, 827, 438)
    graph += arrow(180, 272, 180, 378, True)
    graph += label(202, 302, 'decision ≠ enforcement', 16, MUTED)
    graph += label(42, 547, 'Solid arrows: intended data flow. Dashed arrow: policy advice. Native/network guarantees remain unverified.', 17, MUTED)
    (OUT / 'architecture.svg').write_text(svg_document(1200, 584, 'RemoteShield X architecture', 'A control plane of clients, Nginx/backend and PostgreSQL is separate from native OS policy, WireGuard/VPS and destination website traffic. Policy decisions do not prove enforcement.', graph), encoding='utf8', newline='\n')

    flow = label(42, 52, 'Security is a chain of explicit checks.', 31, WHITE, 600)
    flow += label(42, 84, 'Implemented control checks and the remaining native / network verification boundary', 18, MUTED)
    steps = [('01', 'Validate configuration', 'Reject invalid production settings'), ('02', 'Authenticate the session', 'Token + active session + role gates'), ('03', 'Evaluate policy', 'Control-plane allow / deny decision'), ('04', 'Enforce and measure', 'Native / OS / tunnel work remains')]
    for i, (number, heading, description) in enumerate(steps):
        y = 127+i*98
        flow += f'<circle cx="68" cy="{y+24}" r="23" fill="{PANEL}" stroke="{CYAN}"/>'
        flow += label(56, y+30, number, 17, CYAN, 600)
        flow += label(112, y+23, heading, 23, WHITE, 600)
        flow += label(112, y+52, description, 18, MUTED)
        if i < 3:
            flow += arrow(68, y+50, 68, y+72, i == 2)
    flow += box(715, 139, 435, 'Observe and correlate', ['Structured errors + request IDs', 'Migration / readiness checks'])
    flow += box(715, 310, 435, 'Open security work', ['Refresh rotation · tenant isolation', 'Device trust · DNS / tunnel failure'], '#f6cc78')
    flow += label(42, 552, 'A successful API response, health check or UI VPN indicator is not a security attestation.', 18, MUTED)
    (OUT / 'security-workflow.svg').write_text(svg_document(1200, 590, 'Security workflow and open boundaries', 'Configuration validation, session authentication and policy decisions precede native enforcement. Native, tunnel, DNS and trust verification remain incomplete; logs and readiness are observations.', flow), encoding='utf8', newline='\n')

    for name, left, right in [('badge-status', 'STATUS', 'Experimental'), ('badge-stack', 'STACK', 'Tauri 2 / Flutter / Node'), ('badge-contracts', 'API', 'v1 + legacy aliases')]:
        width = 350 if name == 'badge-stack' else 292
        body = f'<rect x="1" y="1" width="{width-2}" height="34" rx="8" fill="{PANEL}" stroke="#244364"/>'
        body += label(14, 24, left, 12, CYAN, 600) + label(80, 24, right, 13, WHITE, 600)
        (OUT / f'{name}.svg').write_text(svg_document(width, 36, f'{left}: {right}', f'Repository metadata: {right}. Not a certification.', body), encoding='utf8', newline='\n')


def gradient(size):
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    for y in range(size[1]):
        t = y / max(1, size[1]-1)
        draw.line((0, y, size[0], y), fill=(7, int(20+6*t), int(38+13*t)))
    return image


def hero_base(regular, bold):
    canvas = gradient((1280, 520)).convert('RGBA')
    art = Image.open(SOURCE / 'brand-art.png').convert('RGB').resize((760, 428), Image.Resampling.LANCZOS).convert('RGBA')
    mask = Image.new('L', art.size, 255)
    draw_mask = ImageDraw.Draw(mask)
    for x in range(65):
        draw_mask.line((x, 0, x, 427), fill=round(255*x/64))
    canvas.paste(art, (520, 48), mask)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((60, 72, 130, 76), radius=2, fill=CYAN)
    draw.text((60, 105), 'OPEN ARCHITECTURE / CLEAR BOUNDARIES', font=regular(13), fill=CYAN)
    draw.text((56, 157), 'RemoteShield X', font=bold(55), fill=WHITE)
    draw.text((60, 247), 'Remote access.', font=regular(30), fill=WHITE)
    draw.text((60, 291), 'Explicit control.', font=regular(30), fill=CYAN)
    draw.line((60, 375, 432, 375), fill='#244364', width=1)
    draw.text((60, 399), 'Tauri 2  /  Flutter  /  Node.js', font=regular(17), fill=MUTED)
    draw.text((60, 479), 'Conceptual artwork. See verified feature status below.', font=regular(12), fill=MUTED)
    return canvas


def hero_frame(base, phase):
    # Every property is periodic; render(0) and render(1) are pixel-identical.
    phase %= 1.0
    canvas = base.copy()
    glow = Image.new('RGBA', canvas.size)
    draw = ImageDraw.Draw(glow)
    alpha = round(24+10*math.sin(2*math.pi*phase))
    draw.ellipse((848, 119, 1100, 379), outline=(88, 231, 243, alpha), width=3)
    for start, end, offset in [(754, 860, 0), (1162, 1078, .5)]:
        for shift in [0, .5]:
            t = (phase+offset+shift) % 1
            x = start+(end-start)*t
            a = round(235*math.sin(math.pi*t)**2)
            draw.ellipse((x-5, 286, x+5, 296), fill=(88, 231, 243, a))
    canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(4)))
    canvas = Image.alpha_composite(canvas, glow)
    return canvas.convert('RGB')


def footer_base(regular, bold):
    canvas = gradient((1280, 260)).convert('RGBA')
    draw = ImageDraw.Draw(canvas)
    draw.text((60, 64), 'Built in the open.', font=bold(36), fill=WHITE)
    draw.text((60, 123), 'Review the boundaries. Shape the next release.', font=regular(22), fill=MUTED)
    draw.text((60, 200), 'RemoteShield X  /  Remote access. Explicit control.', font=regular(15), fill=CYAN)
    return canvas


def shield(draw, cx, cy, scale=1):
    points = [(cx, cy-66*scale), (cx+55*scale, cy-44*scale), (cx+48*scale, cy+20*scale), (cx+25*scale, cy+51*scale), (cx, cy+69*scale), (cx-25*scale, cy+51*scale), (cx-48*scale, cy+20*scale), (cx-55*scale, cy-44*scale)]
    draw.polygon(points, fill=PANEL)
    draw.line(points+[points[0]], fill=CYAN, width=3, joint='curve')
    draw.arc((cx-17, cy-29, cx+17, cy+10), 180, 360, fill=CYAN, width=3)
    draw.rounded_rectangle((cx-23, cy-9, cx+23, cy+26), radius=5, fill=PANEL, outline=CYAN, width=3)
    draw.ellipse((cx-3, cy+3, cx+3, cy+9), fill=CYAN)


def footer_frame(base, phase):
    phase %= 1.0
    canvas = base.copy()
    overlay = Image.new('RGBA', canvas.size)
    draw = ImageDraw.Draw(overlay)
    for index, (sx, sy, ex, ey) in enumerate([(755, 45, 982, 130), (755, 215, 982, 130), (1250, 45, 1090, 130), (1250, 215, 1090, 130)]):
        draw.line((sx, sy, ex, ey), fill='#244364', width=2)
        t = (phase+index*.25) % 1
        x, y = sx+(ex-sx)*t, sy+(ey-sy)*t
        a = round(255*math.sin(math.pi*t)**2)
        draw.ellipse((x-5, y-5, x+5, y+5), fill=(88, 231, 243, a))
    canvas = Image.alpha_composite(canvas, overlay.filter(ImageFilter.GaussianBlur(5)))
    canvas = Image.alpha_composite(canvas, overlay)
    shield(ImageDraw.Draw(canvas), 1036, 130)
    return canvas.convert('RGB')


def export_animation(name, base, render, count, duration):
    first = render(base, 0)
    assert ImageChops.difference(first, render(base, 1)).getbbox() is None, 'Loop endpoints must match exactly'
    palette = first.quantize(colors=192, method=Image.Quantize.MEDIANCUT)
    frames = [render(base, frame/count).quantize(palette=palette, dither=Image.Dither.NONE) for frame in range(count)]
    frames[0].save(OUT / f'{name}.gif', save_all=True, append_images=frames[1:], duration=duration, loop=0, disposal=1, optimize=True)
    first.save(OUT / f'{name}.webp', quality=88, method=6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--font-regular', default='C:/Windows/Fonts/segoeui.ttf')
    parser.add_argument('--font-bold', default='C:/Windows/Fonts/segoeuib.ttf')
    args = parser.parse_args()
    for font in [args.font_regular, args.font_bold]:
        if not Path(font).is_file():
            parser.error('Supply explicit --font-regular and --font-bold paths; see assets/readme/README.md')
    regular = lambda size: ImageFont.truetype(args.font_regular, size)
    bold = lambda size: ImageFont.truetype(args.font_bold, size)
    OUT.mkdir(parents=True, exist_ok=True)
    write_vectors()
    export_animation('remoteshield-hero', hero_base(regular, bold), hero_frame, 100, 70)
    export_animation('remoteshield-footer', footer_base(regular, bold), footer_frame, 80, 60)
    for name in ['desktop', 'admin']:
        capture = SOURCE / f'{name}-capture.jpg'
        if capture.is_file():
            target = 'desktop-browser.png' if name == 'desktop' else 'admin-dashboard.png'
            Image.open(capture).convert('RGB').save(OUT / target, optimize=True)
    manifest = {'generator': 'scripts/build_readme_assets.py', 'fontInputs': {}, 'assets': {}}
    for key, font in [('regular', args.font_regular), ('bold', args.font_bold)]:
        manifest['fontInputs'][key] = {'name': Path(font).name, 'sha256': hashlib.sha256(Path(font).read_bytes()).hexdigest()}
    for asset in sorted(OUT.iterdir()):
        if asset.suffix not in {'.gif', '.webp', '.png', '.svg'}:
            continue
        item = {'bytes': asset.stat().st_size, 'sha256': hashlib.sha256(asset.read_bytes()).hexdigest()}
        if asset.suffix != '.svg':
            with Image.open(asset) as image:
                item.update(width=image.width, height=image.height, frames=getattr(image, 'n_frames', 1))
                if asset.suffix == '.gif':
                    item['durationMs'] = sum(image.seek(i) or image.info.get('duration', 0) for i in range(image.n_frames))
                    item['loop'] = image.info.get('loop')
        manifest['assets'][asset.name] = item
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8', newline='\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
