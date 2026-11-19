# README media

Original brand artwork was generated with built-in ImageGen; the exact prompt and provenance are in [source/artwork-prompt.md](source/artwork-prompt.md). The original raster is versioned. Logo/diagrams/type/animation layers are authored, with no stock imagery. The imagery is conceptual, not a security demonstration. Real captures and unavailable views are documented in [SCREENSHOTS.md](SCREENSHOTS.md).

Rebuild from the repository root:

```powershell
python -m pip install -r scripts/requirements-readme.txt
python scripts/build_readme_assets.py
python scripts/validate_readme.py
```

The pinned Pillow version and committed source make animation generation repeatable. Windows uses Segoe UI regular/bold. Provide `--font-regular` and `--font-bold` paths on another host. The manifest records font names and checksums. Identical font inputs are needed for byte-identical output. The generator preserves the existing application captures by default. Pass `--rebuild-captures` to convert the archived desktop and admin JPEGs to PNGs again.

The hero runs for seven seconds (100 frames at 70 ms). Signals first move from the laptop and phone toward the shield for enrollment. Two arcs trace the shield during policy evaluation, then signals move back toward the devices as the approved navigation stage lights up. The static poster includes all three steps. The footer runs for 4.8 seconds. The access and network loops run for 5.6 seconds each. The generator checks that the start and end of each underlying loop match and uses a shared palette and optimized GIF deltas. Each animation has a static WebP fallback. `manifest.json` records dimensions, timing, size and checksums.

The access-flow loop separates an API access decision from a page request made by the native WebView. The network-boundary loop keeps the optional WireGuard path visually separate and states that a UI connection indicator does not establish packet-level enforcement. Both are conceptual diagrams, not runtime telemetry or a security proof. README uses a standard picture/source reduced-motion alternative where the renderer preserves that media query. GitHub supports picture elements, but sanitization and client behavior can vary; the visible [static edition](../../docs/README_STATIC.md) is the reliable no-animation option. No autoplay preference is assumed or overridden. Text is repeated in Markdown/alt text, and diagrams have title/description elements and text documentation equivalents.

Palette: navy#071426, cyan#58e7f3, electric blue#2788ff; body text#f1f7ff and secondary text#adc3db on navy. No external fonts, scripts or foreignObject elements are required by the SVGs. Each linked repository asset is committed, with relative paths suitable for GitHub branch rendering.
