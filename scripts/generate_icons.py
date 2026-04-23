"""
Generate PWA icons from a single source design.
Produces 180, 192, 512 regular and 512 maskable, plus favicon.png.
Run once after changing the design; outputs go into docs/icons/.
"""
from PIL import Image, ImageDraw
import os, sys, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "docs", "icons")
os.makedirs(OUT, exist_ok=True)

# --- brand colors ---
BLUE   = (96, 165, 250)   # #60a5fa
PURPLE = (167, 139, 250)  # #a78bfa
BG_DARK = (11, 18, 32)    # #0b1220
WHITE  = (255, 255, 255)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i]-a[i]) * t) for i in range(3))

def gradient(size, c1, c2):
    """Diagonal gradient top-left -> bottom-right."""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (*lerp(c1, c2, t), 255)
    return img

def draw_glyph(img, inset_frac=0.18):
    """
    Draw the glyph: rounded tile background already set; overlay a small
    tilt-chart line with a couple of dots. Inset ensures maskable safe zone.
    """
    W, H = img.size
    d = ImageDraw.Draw(img)
    inset = int(W * inset_frac)
    x0, y0 = inset, inset
    x1, y1 = W - inset, H - inset
    w = x1 - x0
    h = y1 - y0

    # zero axis (faint white line across the middle)
    mid = y0 + h // 2
    axis_w = max(2, W // 180)
    d.line([(x0, mid), (x1, mid)], fill=(255, 255, 255, 90), width=axis_w)

    # tilt line path — 6 points crossing zero
    pts_t = [
        (0.00, -0.15),
        (0.20, -0.35),
        (0.40,  0.10),
        (0.60,  0.45),
        (0.80,  0.25),
        (1.00,  0.55),
    ]
    stroke = max(3, W // 48)
    coords = []
    for fx, fy in pts_t:
        px = x0 + int(fx * w)
        py = mid - int(fy * (h / 2))
        coords.append((px, py))
    d.line(coords, fill=WHITE, width=stroke, joint="curve")
    dot_r = max(4, W // 36)
    for (px, py) in coords:
        d.ellipse([px - dot_r, py - dot_r, px + dot_r, py + dot_r],
                  fill=WHITE, outline=None)

def rounded_tile(size, c1, c2, radius_frac=0.22):
    """Gradient with rounded corners on transparent background."""
    base = gradient(size, c1, c2)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=255
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out

def maskable_tile(size, c1, c2):
    """Full bleed (no rounding) — Android will apply its own mask."""
    return gradient(size, c1, c2)

def make_regular(size):
    img = rounded_tile(size, BLUE, PURPLE)
    draw_glyph(img, inset_frac=0.22)
    return img

def make_maskable(size):
    # For maskable, put art inside the safe zone (80% centered).
    # Easiest: draw glyph with larger inset so it stays visible after masking.
    img = maskable_tile(size, BLUE, PURPLE)
    draw_glyph(img, inset_frac=0.28)
    return img

def make_favicon(size=64):
    return make_regular(size)

def main():
    targets = [
        ("icon-180.png",           make_regular(180)),   # apple-touch
        ("icon-192.png",           make_regular(192)),
        ("icon-512.png",           make_regular(512)),
        ("icon-maskable-512.png",  make_maskable(512)),
        ("favicon.png",            make_favicon(64)),
    ]
    for name, img in targets:
        p = os.path.join(OUT, name)
        img.save(p, "PNG", optimize=True)
        print(f"wrote {p}  ({img.size[0]}x{img.size[1]})")

if __name__ == "__main__":
    main()
