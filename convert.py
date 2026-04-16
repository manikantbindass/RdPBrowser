from PIL import Image

# Read JPEG
img = Image.open(r"app-icon.jpg")

# Ensure RGBA so Tauri detects it correctly
img = img.convert("RGBA")

# Resize to at least 1024x1024 if needed
img = img.resize((1024, 1024), Image.Resampling.LANCZOS)

# Save as clean PNG
img.save(r"app-icon-real.png", format="PNG")
print("Image successfully converted to RGBA PNG using Python.")
