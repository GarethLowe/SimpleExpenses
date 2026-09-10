"""Generate PWA PNG icons without any imaging library (solid shapes only)."""
import struct, zlib, sys, os

def png(width, height, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def draw(size):
    bg, white, dark, light = (31,111,95,255), (255,255,255,255), (31,111,95,255), (159,200,189,255)
    s = size / 64.0
    r = 14 * s
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            # rounded square background
            cx = min(max(x, r), size - r); cy = min(max(y, r), size - r)
            inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
            px = bg if inside else (0, 0, 0, 0)
            X, Y = x / s, y / s
            if 18 <= X < 46 and 12 <= Y < 48:
                # zigzag bottom edge: 7 teeth of width 4, depth 3
                tooth = (X - 18) % 8
                depth = 3 * (1 - abs(tooth - 4) / 4)
                if Y < 48 - depth:
                    px = white
                    if 23 <= X < 41 and 20 <= Y < 23: px = dark
                    if 23 <= X < 41 and 27 <= Y < 30: px = light
                    if 23 <= X < 35 and 34 <= Y < 37: px = light
            row.extend(px)
        rows.append(row)
    return png(size, size, rows)

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for n in (192, 512):
    with open(os.path.join(out, f"icon-{n}.png"), "wb") as f:
        f.write(draw(n))
print("icons written")
