# -*- coding: utf-8 -*-
"""Compone un mapa estatico del local desde teselas de OpenStreetMap.
Se descargan una vez y se sirven desde el propio dominio: sin iframe de Google,
sin cookies de terceros y sin banner. Atribucion obligatoria en la pagina.
"""
import math, os, urllib.request, io
from PIL import Image, ImageDraw, ImageEnhance

LAT, LON = 42.8771694, -8.5441098
Z = 17
ANCHO, ALTO = 1440, 720          # imagen final
DEST = r"D:\web\ramenOkaeri\ramenOkaeri.github.io\assets\img"
UA = "RamenOkaeriWeb/1.0 (mapa estatico de un solo local; contacto: ramenokaeri.com)"

SUMI = (18, 24, 24)
BENGARA = (163, 69, 68)
WASHI = (229, 215, 202)


def deg2xy(lat, lon, z):
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def main():
    os.makedirs(DEST, exist_ok=True)
    fx, fy = deg2xy(LAT, LON, Z)
    # cuantas teselas hacen falta a cada lado del centro
    tx = math.ceil(ANCHO / 256 / 2) + 1
    ty = math.ceil(ALTO / 256 / 2) + 1
    x0, y0 = int(fx) - tx, int(fy) - ty
    nx, ny = tx * 2 + 1, ty * 2 + 1

    lienzo = Image.new("RGB", (nx * 256, ny * 256), SUMI)
    op = urllib.request.build_opener()
    op.addheaders = [("User-Agent", UA)]
    bajadas = 0
    for i in range(nx):
        for j in range(ny):
            url = f"https://tile.openstreetmap.org/{Z}/{x0+i}/{y0+j}.png"
            try:
                with op.open(url, timeout=25) as r:
                    t = Image.open(io.BytesIO(r.read())).convert("RGB")
                lienzo.paste(t, (i * 256, j * 256))
                bajadas += 1
            except Exception as e:
                print("  fallo", url, e)
    print(f"teselas: {bajadas}/{nx*ny}")

    # el centro exacto dentro del lienzo
    cx = (fx - x0) * 256
    cy = (fy - y0) * 256
    caja = (int(cx - ANCHO / 2), int(cy - ALTO / 2),
            int(cx - ANCHO / 2) + ANCHO, int(cy - ALTO / 2) + ALTO)
    m = lienzo.crop(caja)

    # se lleva a la paleta de la web: desaturado, oscuro y con un tinte sumi
    m = ImageEnhance.Color(m).enhance(0.18)
    m = ImageEnhance.Brightness(m).enhance(0.46)
    m = ImageEnhance.Contrast(m).enhance(1.18)
    tinte = Image.new("RGB", m.size, SUMI)
    m = Image.blend(m, tinte, 0.55)

    # marcador
    d = ImageDraw.Draw(m, "RGBA")
    px, py = ANCHO // 2, ALTO // 2
    for r, a in ((74, 26), (52, 34), (32, 46)):
        d.ellipse((px - r, py - r, px + r, py + r), fill=BENGARA + (a,))
    d.ellipse((px - 13, py - 13, px + 13, py + 13), fill=BENGARA + (255,), outline=WASHI + (235,), width=3)

    m.save(os.path.join(DEST, "mapa-1440.jpg"), "JPEG", quality=82, optimize=True, progressive=True)
    m.save(os.path.join(DEST, "mapa-1440.webp"), "WEBP", quality=76, method=6)
    try:
        m.save(os.path.join(DEST, "mapa-1440.avif"), "AVIF", quality=52, speed=4)
    except Exception:
        pass
    z = m.resize((720, 360), Image.LANCZOS)
    z.save(os.path.join(DEST, "mapa-720.jpg"), "JPEG", quality=82, optimize=True, progressive=True)
    z.save(os.path.join(DEST, "mapa-720.webp"), "WEBP", quality=76, method=6)
    try:
        z.save(os.path.join(DEST, "mapa-720.avif"), "AVIF", quality=52, speed=4)
    except Exception:
        pass

    for f in ("mapa-720.avif", "mapa-720.webp", "mapa-1440.avif", "mapa-1440.webp"):
        p = os.path.join(DEST, f)
        if os.path.exists(p):
            print(f"{f:18s} {os.path.getsize(p)/1024:6.1f} KB")


if __name__ == "__main__":
    main()
