# -*- coding: utf-8 -*-
"""Variante de retrato alto para el hero: una pantalla de iPhone moderno va
de 0,46 a 0,56 de relacion. Con 3:4 sobra ancho y se recorta por los lados,
asi que el encuadre vertical no se puede controlar."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageFilter

ORIGEN = r"D:\web\ramenOkaeri\recursos-ramenOkaeri"
REPO = r"D:\web\ramenOkaeri\ramenOkaeri.github.io"
IMG = os.path.join(REPO, "assets", "img")
RATIO = 0.48                      # cubre de un SE a un Pro Max sin franjas
ANCHOS = [480, 720, 900, 1170]

def recorta(im, ratio, fx, fy):
    w, h = im.size
    if w / h > ratio:
        nw, nh = int(round(h * ratio)), h
    else:
        nw, nh = w, int(round(w / ratio))
    x = max(0, min(int(round(fx * w - nw / 2)), w - nw))
    y = max(0, min(int(round(fy * h - nh / 2)), h - nh))
    return im.crop((x, y, x + nw, y + nh))

meta = json.load(open(os.path.join(REPO, "content", "imagenes.json"), encoding="utf-8"))

# (destino, archivo, foco x, foco y)
# (destino, archivo, foco x, foco y, cuanto alto se conserva)
CASOS = [("fachada", "img-tienda-vista-desde-fuera.jpg", 0.53, 0.60, 0.80)]

for nombre, arch, fx, fy, alto_util in CASOS:
    im = Image.open(os.path.join(ORIGEN, arch)).convert("RGB")
    # la foto original es 0,667 y el destino 0,48: recortando solo el ancho
    # se conserva todo el alto y el encuadre vertical deja de existir.
    # Por eso primero se quita banda de arriba y de abajo alrededor del foco.
    w, h = im.size
    nh = int(round(h * alto_util))
    y = max(0, min(int(round(fy * h - nh / 2)), h - nh))
    im = im.crop((0, y, w, y + nh))
    p = recorta(im, RATIO, fx, 0.5)
    alturas = {}
    for a in ANCHOS:
        alto = int(round(p.height * a / p.width))
        z = p.resize((a, alto), Image.LANCZOS).filter(
            ImageFilter.UnsharpMask(radius=0.6, percent=45, threshold=3))
        base = os.path.join(IMG, f"{nombre}-p-{a}")
        z.save(base + ".jpg", "JPEG", quality=80, optimize=True, progressive=True, subsampling=1)
        z.save(base + ".webp", "WEBP", quality=78, method=6)
        z.save(base + ".avif", "AVIF", quality=52, speed=4)
        alturas[a] = alto
        print(f"  {nombre}-p-{a}: avif {os.path.getsize(base+'.avif')/1024:5.1f} KB")
    meta["fotos"][nombre]["p"] = {"ratio": "12/25", "anchos": ANCHOS, "alto": alturas}

json.dump(meta, open(os.path.join(REPO, "content", "imagenes.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("imagenes.json actualizado")
