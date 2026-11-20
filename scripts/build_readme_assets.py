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
HERO_STAGES = ('Enroll the device', 'Evaluate access', 'Open the approved site')


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

    graph = label(42, 52, 'RemoteShield X system architecture', 31, WHITE, 600)
    graph += label(42, 84, 'Application authorization and packet routing have separate responsibilities.', 18, MUTED)
    graph += label(42, 132, 'CONTROL PLANE', 15, CYAN, 600)
    graph += box(42, 158, 280, 'Clients', ['Desktop · Android · Admin', 'Independent runtime boundaries'])
    graph += box(400, 158, 350, 'Nginx + backend', ['Versioned API · session checks', 'Config · policy decisions · events'])
    graph += box(830, 158, 328, 'PostgreSQL', ['Organizations · sessions · policy', 'Tenant-scoped rows and events'])
    graph += arrow(324, 214, 397, 214) + arrow(752, 214, 827, 214)
    graph += '<path d="M42 316H1158" stroke="#244364" stroke-dasharray="5 8"/>'
    graph += label(42, 355, 'NETWORK / NATIVE ENFORCEMENT', 15, CYAN, 600)
    graph += box(42, 382, 280, 'Native + OS policy', ['WebView navigation · firewall', 'Routing · DNS · IPv4 / IPv6'])
    graph += box(400, 382, 350, 'WireGuard + VPS', ['Tunnel · routing / NAT', 'Separate privileged deployment'])
    graph += box(830, 382, 328, 'Destination', ['Website responds to the WebView', 'Through the configured OS route'])
    graph += arrow(324, 438, 397, 438) + arrow(752, 438, 827, 438)
    graph += arrow(180, 272, 180, 378, True)
    graph += label(202, 302, 'Navigation decision', 16, MUTED)
    graph += label(42, 547, 'The lower lane shows a managed WireGuard deployment. Control requests can also travel over that tunnel.', 17, MUTED)
    (OUT / 'architecture.svg').write_text(svg_document(1200, 584, 'RemoteShield X architecture', 'A control plane of clients, Nginx/backend and PostgreSQL is separate from native OS policy, WireGuard/VPS and destination website traffic. Policy decisions do not prove enforcement.', graph), encoding='utf8', newline='\n')

    flow = label(42, 52, 'From sign-in to a navigation decision', 31, WHITE, 600)
    flow += label(42, 84, 'The backend checks live access state for the requested URL.', 18, MUTED)
    steps = [('01', 'Admit the source', 'Use the configured edge and VPN source rules'), ('02', 'Authenticate the session', 'Check identity, organization, account and session'), ('03', 'Evaluate the request', 'Apply device requirements and assigned URL policy'), ('04', 'Record the result', 'Associate the decision with a request ID')]
    for i, (number, heading, description) in enumerate(steps):
        y = 127+i*98
        flow += f'<circle cx="68" cy="{y+24}" r="23" fill="{PANEL}" stroke="{CYAN}"/>'
        flow += label(56, y+30, number, 17, CYAN, 600)
        flow += label(112, y+23, heading, 23, WHITE, 600)
        flow += label(112, y+52, description, 18, MUTED)
        if i < 3:
            flow += arrow(68, y+50, 68, y+72, i == 2)
    flow += box(715, 139, 435, 'Allow', ['The native WebView opens the site', 'The OS controls routing and DNS'])
    flow += box(715, 310, 435, 'Deny', ['The client blocks the requested page', 'The admin can review recorded decisions'], '#f6cc78')
    flow += label(42, 552, 'Application revocation and WireGuard peer revocation are separate operator actions.', 18, MUTED)
    (OUT / 'security-workflow.svg').write_text(svg_document(1200, 590, 'RemoteShield X navigation security workflow', 'The backend checks source, session, device and URL policy, then records the decision. The WebView loads allowed pages and blocks denied navigation. Routing and DNS are separately managed.', flow), encoding='utf8', newline='\n')

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
    art = Image.open(SOURCE / 'brand-art.png').convert('RGB').resize((735, 428), Image.Resampling.LANCZOS).convert('RGBA')
    mask = Image.new('L', art.size, 255)
    draw_mask = ImageDraw.Draw(mask)
    for x in range(65):
        draw_mask.line((x, 0, x, 427), fill=round(255*x/64))
    for x in range(art.width-30, art.width):
        opacity = round(255*(art.width-1-x)/29)
        draw_mask.line((x, 0, x, 427), fill=opacity)
    canvas.paste(art, (520, 48), mask)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((58, 36, 1222, 414), radius=22, outline='#254263', width=2)
    draw.rounded_rectangle((88, 78, 138, 82), radius=2, fill=CYAN)
    draw.text((88, 105), 'MANAGED BROWSER / DESKTOP + ANDROID', font=bold(16), fill=CYAN)
    draw.text((83, 153), 'RemoteShield X', font=bold(64), fill=WHITE)
    draw.text((88, 249), 'Secure access starts with', font=regular(32), fill=WHITE)
    draw.text((88, 291), 'an explicit decision.', font=bold(32), fill=CYAN)
    draw.text((88, 357), 'Identity  /  Device trust  /  URL policy', font=regular(20), fill=MUTED)
    for index, stage in enumerate(HERO_STAGES):
        x = 58 + index*396
        draw.rounded_rectangle((x, 431, x+372, 502), radius=12, fill=PANEL, outline='#254263', width=2)
        draw.text((x+16, 453), f'{index+1:02}', font=bold(19), fill=CYAN)
        draw.text((x+54, 450), stage, font=bold(23), fill=WHITE)
    return canvas


def hero_frame(base, phase):
    # Every property is periodic; render(0) and render(1) are pixel-identical.
    phase %= 1.0
    canvas = base.copy()
    glow = Image.new('RGBA', canvas.size)
    draw = ImageDraw.Draw(glow)
    stage = min(int(phase*3), 2)
    step = phase*3 - stage
    pulse = math.sin(math.pi*step)**2
    cyan = (88, 231, 243)
    blue = (77, 169, 255)
    if stage == 1:
        angle = 360*step
        draw.arc((821, 110, 1081, 374), angle, angle+92, fill=(*cyan, round(200*pulse)), width=4)
        draw.arc((811, 100, 1091, 384), angle+180, angle+240, fill=(*blue, round(155*pulse)), width=3)
    else:
        lanes = [(749, 846, 286), (1143, 1056, 288)]
        for start, end, y in lanes:
            if stage == 2:
                start, end = end, start
            x = start+(end-start)*step
            color = cyan if stage == 0 else blue
            draw.line((start, y, x, y), fill=(*color, round(125*pulse)), width=4)
            draw.ellipse((x-7, y-7, x+7, y+7), fill=(*color, round(250*pulse)))
    x = 58 + 396*stage
    draw.rounded_rectangle((x, 431, x+372, 502), radius=12, outline=(*cyan, round(190*pulse)), width=3)
    draw.line((x+14, 492, x+14+344*step, 492), fill=(*cyan, round(220*pulse)), width=3)
    canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(6)))
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


def access_base(regular, bold):
    canvas = gradient((1280, 560)).convert('RGBA')
    draw = ImageDraw.Draw(canvas)
    draw.text((58, 38), 'A navigation decision has a clear boundary.', font=bold(31), fill=WHITE)
    draw.text((60, 83), 'The API evaluates policy. The native WebView requests the page.', font=regular(19), fill=MUTED)
    cards = [(58, 'MANAGED CLIENT', 'URL + live session'), (470, 'CONTROL PLANE', 'Identity + policy'), (882, 'DESTINATION', 'OS WebView request')]
    for x, heading, detail in cards:
        draw.rounded_rectangle((x, 174, x+340, 340), radius=14, fill=PANEL, outline='#244364', width=2)
        draw.text((x+22, 202), heading, font=bold(17), fill=CYAN if x != 882 else WHITE)
        draw.text((x+22, 247), detail, font=regular(21), fill=WHITE)
    draw.line((398, 256, 465, 256), fill='#244364', width=4)
    draw.line((810, 256, 877, 256), fill='#244364', width=4)
    draw.line((398, 301, 877, 301), fill='#244364', width=3)
    draw.text((58, 406), 'POLICY REQUEST', font=bold(14), fill=CYAN)
    draw.line((58, 441, 602, 441), fill='#244364', width=3)
    draw.text((652, 406), 'SITE REQUEST THROUGH THE OPERATING SYSTEM', font=bold(14), fill=CYAN)
    draw.line((652, 441, 1220, 441), fill='#244364', width=3)
    draw.text((58, 507), 'Conceptual flow only. A policy response does not proxy site traffic or prove device-wide enforcement.', font=regular(15), fill=MUTED)
    return canvas


def access_frame(base, phase):
    phase %= 1.0
    canvas = base.copy()
    glow = Image.new('RGBA', canvas.size)
    draw = ImageDraw.Draw(glow)
    # Request and page traffic use separate lanes to expose the control/data boundary.
    for x1, x2, y, offset, color in [(398, 465, 256, 0, (39,136,255)), (810, 877, 256, .33, (88,231,243)), (58, 602, 441, .5, (88,231,243)), (652, 1220, 441, .75, (39,136,255))]:
        t = (phase+offset) % 1.0
        x = x1+(x2-x1)*t
        alpha = round(255*math.sin(math.pi*t)**2)
        draw.ellipse((x-8,y-8,x+8,y+8),fill=(*color,alpha))
    canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(8)))
    canvas = Image.alpha_composite(canvas, glow)
    return canvas.convert('RGB')


def network_base(regular, bold):
    canvas = gradient((1280, 620)).convert('RGBA')
    draw = ImageDraw.Draw(canvas)
    draw.text((58, 38), 'Control and packet paths stay distinct.', font=bold(31), fill=WHITE)
    draw.text((60, 83), 'WireGuard is an optional, separately operated network layer.', font=regular(19), fill=MUTED)
    draw.text((60, 142), 'CONTROL PLANE', font=bold(15), fill=CYAN)
    draw.text((60, 359), 'OPTIONAL NETWORK PATH', font=bold(15), fill=CYAN)
    for y, nodes in [(184, [(58,'Client'),(470,'API + policy'),(882,'PostgreSQL')]), (401, [(58,'Managed device'),(470,'WireGuard gateway'),(882,'Internet egress')])]:
        for x, label_text in nodes:
            draw.rounded_rectangle((x,y,x+340,y+112),radius=12,fill=PANEL,outline='#244364',width=2)
            draw.text((x+20,y+42),label_text,font=bold(21),fill=WHITE)
        draw.line((398,y+56,465,y+56),fill='#244364',width=4)
        draw.line((810,y+56,877,y+56),fill='#244364',width=4)
    draw.line((228, 300, 228, 354), fill='#244364', width=3)
    draw.text((250, 317), 'policy state', font=regular(14), fill=MUTED)
    draw.text((58, 564), 'A connected indicator is not packet proof. Validate routes, DNS, IPv6 and tunnel-loss behavior per OS.', font=regular(15), fill=MUTED)
    return canvas


def network_frame(base, phase):
    phase %= 1.0
    canvas = base.copy()
    overlay = Image.new('RGBA', canvas.size)
    draw = ImageDraw.Draw(overlay)
    for y, x1, x2, offset, color in [(240,398,465,0,(39,136,255)),(240,810,877,.25,(39,136,255)),(457,398,465,.5,(88,231,243)),(457,810,877,.75,(88,231,243))]:
        t=(phase+offset)%1.0
        x=x1+(x2-x1)*t
        alpha=round(255*math.sin(math.pi*t)**2)
        draw.ellipse((x-8,y-8,x+8,y+8),fill=(*color,alpha))
    canvas=Image.alpha_composite(canvas,overlay.filter(ImageFilter.GaussianBlur(8)))
    canvas=Image.alpha_composite(canvas,overlay)
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
    parser.add_argument('--rebuild-captures', action='store_true', help='Re-encode the archived desktop and admin JPEGs as PNGs')
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
    export_animation('remoteshield-access-flow', access_base(regular, bold), access_frame, 80, 70)
    export_animation('remoteshield-network-boundary', network_base(regular, bold), network_frame, 80, 70)
    if args.rebuild_captures:
        for name, target in [('desktop', 'desktop-browser.png'), ('admin', 'admin-dashboard.png')]:
            with Image.open(SOURCE / f'{name}-capture.jpg') as capture:
                capture.convert('RGB').save(OUT / target, optimize=True)
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
