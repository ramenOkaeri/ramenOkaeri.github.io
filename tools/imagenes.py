# -*- coding: utf-8 -*-
"""Pipeline de imagenes de Ramen Okaeri.
Origen: D:\web\ramenOkaeri\recursos-ramenOkaeri
Destino: el repositorio, en assets/img y assets/brand
Genera AVIF + WebP + JPEG en cinco anchos, mas marca y favicons."""
import json, os, sys, io
from PIL import Image, ImageDraw, ImageFilter
try:
    from PIL import AvifImagePlugin  # noqa
    AVIF = True
except Exception:
    AVIF = False

ORIGEN = r"D:\web\ramenOkaeri\recursos-ramenOkaeri"
REPO   = r"D:\web\ramenOkaeri\ramenOkaeri.github.io"
IMG    = os.path.join(REPO, "assets", "img")
BRAND  = os.path.join(REPO, "assets", "brand")
ANCHOS = [480, 768, 1080, 1440, 1920]

# nombre destino -> (archivo origen, foco vertical 0-1, foco horizontal 0-1, alt)
FOTOS = {
  "fachada":       ("img-tienda-vista-desde-fuera.jpg", 0.47, 0.52),
  "ramen":         ("img-ramen-de-tienda.jpg", 0.46, 0.50),
  "neon-okaeri":   ("img-tienda-decoracion-con-neon-okaeri.jpg", 0.58, 0.50),
  "neon-flechas":  ("img-tienda-decoracion-neon.jpg", 0.50, 0.45),
  "vitrina":       ("img-tienda-decoracion-vitrina-figuras-anime.jpg", 0.42, 0.50),
  "barra":         ("img-barra-con-trabajador-haciendo-coctel.jpg", 0.45, 0.58),
  "mesa":          ("img-mesa-con-personas-comiendo.jpg", 0.48, 0.50),
  "sala":          ("img-tienda-con-decoracion-y-mesa-con-dos-personas-comiendo.jpg", 0.45, 0.50),
  "sala-noche":    ("img-mesa-con-personas-sentadas-de-fondo.jpg", 0.48, 0.50),
  "banderines":    ("img-tienda-decoracion-bandera-de-imagenes-de-animes.jpg", 0.45, 0.50),
}
LOGO = "LOGO RAMEN OKAERI 91x90.5cm_page-0001.jpg"

def asegura(d):
    os.makedirs(d, exist_ok=True)

def recorta(im, ratio, fx, fy):
    """Recorta a la relacion pedida respetando el punto de foco."""
    w, h = im.size
    if w / h > ratio:
        nw = int(round(h * ratio)); nh = h
    else:
        nw = w; nh = int(round(w / ratio))
    x = int(round(fx * w - nw / 2)); y = int(round(fy * h - nh / 2))
    x = max(0, min(x, w - nw)); y = max(0, min(y, h - nh))
    return im.crop((x, y, x + nw, y + nh))

def guarda(im, base, ancho):
    """Guarda un ancho en los tres formatos. Devuelve bytes por formato."""
    r = {}
    alto = int(round(im.height * ancho / im.width))
    z = im.resize((ancho, alto), Image.LANCZOS)
    z = z.filter(ImageFilter.UnsharpMask(radius=0.6, percent=45, threshold=3))
    p = f"{base}-{ancho}.jpg"
    z.save(p, "JPEG", quality=80, optimize=True, progressive=True, subsampling=1)
    r["jpg"] = os.path.getsize(p)
    p = f"{base}-{ancho}.webp"
    z.save(p, "WEBP", quality=78, method=6)
    r["webp"] = os.path.getsize(p)
    if AVIF:
        p = f"{base}-{ancho}.avif"
        z.save(p, "AVIF", quality=52, speed=4)
        r["avif"] = os.path.getsize(p)
    return alto, r

def dominante(im):
    z = im.resize((1, 1), Image.LANCZOS).convert("RGB")
    return "#%02X%02X%02X" % z.getpixel((0, 0))

def main():
    asegura(IMG); asegura(BRAND)
    meta = {"fotos": {}, "avif": AVIF}
    total = 0

    for nombre, (arch, fy, fx) in FOTOS.items():
        src = os.path.join(ORIGEN, arch)
        if not os.path.exists(src):
            print("FALTA:", arch); continue
        im = Image.open(src).convert("RGB")
        col = dominante(im)
        entradas = {}

        # vertical 3:4 -> movil y tarjetas de galeria
        v = recorta(im, 3/4, fx, fy)
        base = os.path.join(IMG, nombre + "-v")
        alturas = {}
        for a in [480, 768, 1080]:
            alto, pesos = guarda(v, base, a)
            alturas[a] = alto; total += sum(pesos.values())
        entradas["v"] = {"ratio": "3/4", "anchos": [480, 768, 1080], "alto": alturas}

        # apaisado 16:9 -> escritorio y hero
        p = recorta(im, 16/9, fx, fy)
        base = os.path.join(IMG, nombre + "-h")
        alturas = {}
        for a in ANCHOS:
            alto, pesos = guarda(p, base, a)
            alturas[a] = alto; total += sum(pesos.values())
        entradas["h"] = {"ratio": "16/9", "anchos": ANCHOS, "alto": alturas}

        entradas["color"] = col
        meta["fotos"][nombre] = entradas
        print(f"  {nombre:14s} color {col}")

    # ---- marca ----
    lg = Image.open(os.path.join(ORIGEN, LOGO)).convert("RGB")
    # el fondo del JPEG es plano: se recorta al contenido con un umbral
    g = lg.convert("L")
    bb = g.point(lambda v: 255 if v > 45 else 0).getbbox()
    if bb:
        m = 40
        bb = (max(0, bb[0]-m), max(0, bb[1]-m), min(lg.width, bb[2]+m), min(lg.height, bb[3]+m))
        lg = lg.crop(bb)
    lado = max(lg.size)
    lienzo = Image.new("RGB", (lado, lado), (18, 24, 24))
    lienzo.paste(lg, ((lado-lg.width)//2, (lado-lg.height)//2))
    lg = lienzo

    # version con transparencia: el fondo sumi pasa a alfa
    rgba = lg.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r0, g0, b0, _ = px[x, y]
            lum = max(r0, g0, b0)
            if lum <= 30:
                px[x, y] = (r0, g0, b0, 0)
            elif lum < 70:
                px[x, y] = (r0, g0, b0, int((lum-30) * 255 / 40))
    for a in [256, 512, 1024]:
        rgba.resize((a, a), Image.LANCZOS).save(os.path.join(BRAND, f"logo-{a}.png"), "PNG", optimize=True)
        rgba.resize((a, a), Image.LANCZOS).save(os.path.join(BRAND, f"logo-{a}.webp"), "WEBP", quality=90, method=6)

    # favicons e icono de iOS, sobre fondo sumi solido
    lg.resize((180, 180), Image.LANCZOS).save(os.path.join(BRAND, "apple-touch-icon.png"), "PNG", optimize=True)
    lg.resize((512, 512), Image.LANCZOS).save(os.path.join(BRAND, "icon-512.png"), "PNG", optimize=True)
    lg.resize((192, 192), Image.LANCZOS).save(os.path.join(BRAND, "icon-192.png"), "PNG", optimize=True)
    ico = [lg.resize((s, s), Image.LANCZOS) for s in (16, 32, 48)]
    ico[0].save(os.path.join(REPO, "favicon.ico"), format="ICO",
                sizes=[(16, 16), (32, 32), (48, 48)])

    # imagen para redes 1200x630: el bol de ramen
    og = Image.open(os.path.join(ORIGEN, FOTOS["ramen"][0])).convert("RGB")
    og = recorta(og, 1200/630, 0.50, 0.46).resize((1200, 630), Image.LANCZOS)
    velo = Image.new("RGB", og.size, (18, 24, 24))
    og = Image.blend(og, velo, 0.28)
    marca = Image.open(os.path.join(BRAND, "logo-512.png")).resize((250, 250), Image.LANCZOS)
    og.paste(marca, (60, 190), marca)
    og.save(os.path.join(BRAND, "og.jpg"), "JPEG", quality=86, optimize=True, progressive=True)

    with open(os.path.join(REPO, "content", "imagenes.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    print(f"\nAVIF: {AVIF}   total fotos: {total/1024/1024:.2f} MB en disco")

if __name__ == "__main__":
    os.makedirs(os.path.join(REPO, "content"), exist_ok=True)
    main()
