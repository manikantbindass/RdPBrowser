from PIL import Image

# Read source PNG
img = Image.open(r"d:\Runtime Terror\RdPBrowser\app-icon-real.png")

# Ensure RGBA
img = img.convert("RGBA")

# Generate standard ICO format directly to Desktop icons folder
img.save(
    r"d:\Runtime Terror\RdPBrowser\desktop\src-tauri\icons\icon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
print("Proper icon.ico successfully generated for Windows.")
