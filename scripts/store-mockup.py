"""Composes the store images from the cut-outs (store/cutouts, made by scripts/capture-docs.cjs): each one is a
backdrop, a headline and the app windows. Writes store/promo/screenshot-*.png (1920x1080) and store/feature-1024x500.png.
Usage: npx electron scripts/capture-docs.cjs   (once, needs a desktop)   then   python scripts/store-mockup.py"""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
FONT = "C:/Windows/Fonts/segoeui.ttf"
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"
FONT_L = "C:/Windows/Fonts/segoeuil.ttf"
os.makedirs("store/promo", exist_ok=True)


def font(path, size):
    return ImageFont.truetype(path, size)


def cover(img, w, h, blur=0):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    img = img.crop((x, y, x + w, y + h))
    return img.filter(ImageFilter.GaussianBlur(blur)) if blur else img


def gradient(w, h, top, bottom):
    g = Image.linear_gradient("L").resize((w, h))
    return Image.composite(Image.new("RGB", (w, h), bottom), Image.new("RGB", (w, h), top), g)


def blobs(img, spots):
    """Soft coloured glows, so a flat gradient does not look flat."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x, y, r, color in spots:
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(120))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def backdrop(kind, w=W, h=H):
    if kind == "indigo":
        im = gradient(w, h, (14, 12, 40), (44, 32, 120))
        return blobs(im, [(w * 0.15, h * 0.2, 330, (124, 106, 247, 150)), (w * 0.9, h * 0.9, 380, (60, 90, 230, 130))])
    if kind == "teal":
        im = gradient(w, h, (8, 22, 40), (18, 96, 130))
        return blobs(im, [(w * 0.85, h * 0.15, 340, (40, 200, 190, 120)), (w * 0.1, h * 0.95, 360, (110, 90, 240, 110))])
    if kind == "sky":
        im = cover(Image.open("store/gen/sky-d.jpg").convert("RGB"), w, h, 6)
        return Image.blend(im, Image.new("RGB", im.size, (10, 24, 60)), 0.45)
    # "picture": the Ha Long Bay picture, blurred and darkened
    im = cover(Image.open("store/gen/halong-card.jpg").convert("RGB"), w, h, 14)
    return Image.blend(im, Image.new("RGB", im.size, (6, 20, 28)), 0.42)


def shade(img, box, alpha_a, alpha_b, vertical=True):
    """A soft dark gradient over `box`, so white text stays readable."""
    x0, y0, x1, y1 = box
    n = (y1 - y0) if vertical else (x1 - x0)
    ramp = Image.linear_gradient("L")
    ramp = ramp.resize((1, n)) if vertical else ramp.transpose(Image.ROTATE_90).resize((n, 1))
    ramp = ramp.point(lambda v: round(alpha_a + (alpha_b - alpha_a) * v / 255))
    mask = ramp.resize((x1 - x0, y1 - y0))
    img.paste(Image.new("RGB", mask.size, (6, 8, 20)), (x0, y0), mask)


def text(d, xy, s, f, anchor="la", fill="white"):
    d.text((xy[0], xy[1] + 3), s, font=f, fill=(0, 0, 0), anchor=anchor)  # soft drop shadow
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def headline(img, head, sub, x, y, anchor="la", size=88):
    d = ImageDraw.Draw(img)
    lines = head.split(chr(10))
    for i, line in enumerate(lines):
        text(d, (x, y + i * round(size * 1.15)), line, font(FONT_B, size), anchor)
    text(d, (x, y + len(lines) * round(size * 1.15) + 14), sub, font(FONT_L, round(size * 0.42)), anchor)


def load(name):
    im = Image.open(f"store/cutouts/{name}.png").convert("RGBA")
    box = im.getbbox()
    return im.crop(box) if box else im


def fit(im, max_w, max_h):
    s = min(max_w / im.width, max_h / im.height)
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)


def framed(im, radius=14, pad=16):
    """A screenshot inside a rounded dark frame with some space between the border and the picture."""
    im = im.convert("RGBA")
    inner = Image.new("L", im.size, 0)
    ImageDraw.Draw(inner).rounded_rectangle((0, 0, im.width - 1, im.height - 1), max(4, radius - 6), fill=255)
    w, h = im.width + pad * 2, im.height + pad * 2
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius + 6, fill=(12, 14, 24, 255), outline=(255, 255, 255, 80), width=2)
    out.paste(im, (pad, pad), inner)
    return out


def put(base, im, cx, cy, shadow=True):
    x, y = round(cx - im.width / 2), round(cy - im.height / 2)
    if shadow:  # a soft shadow cast from the window's own shape
        a = im.split()[3].point(lambda v: round(v * 0.55))
        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
        layer.putalpha(a)
        pad = 80
        big = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
        big.paste(Image.new("RGBA", im.size, (0, 0, 0, 255)), (pad, pad + 18), layer.split()[3])
        big = big.filter(ImageFilter.GaussianBlur(26))
        base.paste(big, (x - pad, y - pad), big)
    base.paste(im, (x, y), im)


def pill(d, xy, s, f):
    w = d.textlength(s, font=f) + 70
    x, y = xy
    d.rounded_rectangle((x, y, x + w, y + 74), 37, fill=(8, 10, 26, 150), outline=(255, 255, 255, 120), width=2)
    d.text((x + 35, y + 37), s, font=f, fill="white", anchor="lm")
    return w


def save(img, name):
    img.convert("RGB").save(f"store/promo/{name}", optimize=True)
    print("wrote", name)



def crop(name, box):
    """A part of a full 1920x1080 lens capture (box in 1920x1080 coordinates)."""
    im = Image.open(f"store/cutouts/{name}.png").convert("RGBA")
    s = im.width / 1920
    return im.crop(tuple(round(v * s) for v in box))


def caption(img, s, cx, y, size=40):
    text(ImageDraw.Draw(img), (cx, y), s, font(FONT_B, size), "ma")


SAILS = (525, 260, 1005, 740)      # round lens on the boat's sails
CLASSIC = (450, 250, 1010, 810)    # round lens with the handle
RECT = (405, 640, 895, 1010)       # wide lens on the flowers

# 1. a lens that follows the mouse
img = backdrop("picture")
shade(img, (0, 0, 900, H), 150, 0, vertical=False)
headline(img, "A lens that follows\nyour mouse", "Freeze the screen, then point at what you want to see", 110, 280, size=74)
put(img, framed(fit(crop("lens-classic", (0, 0, 1920, 1080)), 1000, 570)), 1380, 540)
save(img, "screenshot-1-lens.png")

# 2. blur against sharp
img = backdrop("sky")
shade(img, (0, 0, W, 300), 120, 0)
headline(img, "From blocky to sharp", "The same spot at x8: plain pixels against an AI upscaler", W // 2, 56, "ma")
a, b = framed(fit(crop("lens-nearest", SAILS), 560, 560)), framed(fit(crop("lens-ai", SAILS), 560, 560))
put(img, a, 560, 660)
put(img, b, 1360, 660)
caption(img, "No filter", 560, 980)
caption(img, "Real-ESRGAN", 1360, 980)
save(img, "screenshot-2-sharp.png")

# 3. three looks
img = backdrop("teal")
shade(img, (0, 0, W, 300), 120, 0)
headline(img, "Pick a look", "Circle or rectangle, in three styles", W // 2, 56, "ma")
for cx, name, box, label in [(360, "lens-clean", RECT, "Clean"), (960, "lens-bold", RECT, "Bold"), (1560, "lens-classic", CLASSIC, "Magnifier")]:
    put(img, framed(fit(crop(name, box), 520, 470)), cx, 640)
    caption(img, label, cx, 930)
save(img, "screenshot-3-looks.png")

# 4. simple, icon first
img = backdrop("indigo")
headline(img, "Simple and icon-first", "One small window to start. Everything else is in a settings window.", W // 2, 70, "ma", size=80)
put(img, fit(load("main"), 1080, 460), 600, 700)
put(img, framed(fit(load("settings"), 560, 760), 16), 1480, 640)
save(img, "screenshot-4-simple.png")

# 5. from classic filters to AI
img = backdrop("picture")
shade(img, (0, 0, 900, H), 150, 0, vertical=False)
headline(img, "From classic filters\nto AI", "Pick the look that fits your screen", 110, 150, size=74)
over = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(over)
for i, label in enumerate(["Bilinear", "Bicubic", "Lanczos3", "NIS", "Real-ESRGAN AI"]):
    pill(d, (110, 480 + i * 100), label, font(FONT, 36))
img = Image.alpha_composite(img.convert("RGBA"), over)
put(img, framed(fit(crop("lens-ai", SAILS), 700, 700)), 1380, 540)
save(img, "screenshot-5-methods.png")

# 6. cpu or gpu, offline
img = backdrop("teal")
shade(img, (0, 0, 1000, H), 140, 0, vertical=False)
headline(img, "CPU or GPU,\nyour choice", "Everything runs on your PC. Nothing is uploaded.", 110, 260, size=76)
over = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(over)
x = 110
for label in ["CPU", "GPU (DirectML)", "Offline"]:
    x += pill(d, (x, 640), label, font(FONT, 36)) + 24
img = Image.alpha_composite(img.convert("RGBA"), over)
put(img, framed(fit(load("settings"), 640, 880), 16), 1450, 560)
save(img, "screenshot-6-device.png")

# Feature graphic 1024x500: title and tagline on the left, the lens and the toolbar on the right.
FW, FH = 1024, 500
fg = backdrop("picture", FW, FH)
shade(fg, (0, 0, 560, FH), 150, 0, vertical=False)
d = ImageDraw.Draw(fg)
text(d, (50, 180), "ScreenMagnify2", font(FONT_B, 54), "lm")
text(d, (52, 246), "A magnifying lens", font(FONT_L, 30), "lm")
text(d, (52, 288), "for your screen", font(FONT_L, 30), "lm")
fg = fg.convert("RGBA")
put(fg, framed(fit(crop("lens-classic", (300, 150, 1100, 850)), 400, 400), 10), 760, 235)
put(fg, fit(load("main"), 240, 100), 880, 420)
fg.convert("RGB").save("store/feature-1024x500.png", optimize=True)
print("wrote feature")
