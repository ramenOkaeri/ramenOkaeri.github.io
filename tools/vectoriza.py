# -*- coding: utf-8 -*-
"""Vectoriza el logo de Ramen Okaeri a SVG.
Cada pixel del JPEG se asigna al color de marca mas cercano; de cada mascara
se extraen los contornos con seguimiento Moore, se suavizan, se simplifican con
Douglas-Peucker y se emiten como curvas cubicas."""
import os, numpy as np
from PIL import Image

ORIGEN = r"D:\web\ramenOkaeri\recursos-ramenOkaeri\LOGO RAMEN OKAERI 91x90.5cm_page-0001.jpg"
BRAND  = r"D:\web\ramenOkaeri\ramenOkaeri.github.io\assets\brand"
RES    = 1400          # resolucion de trabajo
VB     = 1000.0        # viewBox de salida

SUMI, BENGARA, WASHI, BLANCO = (18,24,24), (163,69,68), (229,215,202), (255,255,255)
PALETA = [SUMI, BENGARA, WASHI, BLANCO]

VEC = [(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1)]   # 8 vecinos en orden horario

def contornos(m):
    """Todos los contornos cerrados de una mascara booleana, por seguimiento Moore."""
    H, W = m.shape
    p = np.zeros((H+2, W+2), bool); p[1:-1, 1:-1] = m
    visto = set(); salida = []
    for y in range(1, H+1):
        fila = p[y]
        if not fila.any():
            continue
        xs = np.flatnonzero(fila)
        for x in xs:
            if not p[y, x-1] and (y, x) not in visto:      # borde izquierdo de una racha
                c = traza(p, y, x, visto)
                if len(c) > 12:
                    salida.append(c)
    return salida

def traza(p, y0, x0, visto):
    """Seguimiento Moore con criterio de parada de Jacob."""
    cam = [(y0, x0)]; visto.add((y0, x0))
    b = 6                                   # se entro por la izquierda
    cy, cx = y0, x0
    for _ in range(400000):
        for k in range(8):
            d = (b + 1 + k) % 8
            ny, nx = cy + VEC[d][0], cx + VEC[d][1]
            if p[ny, nx]:
                b = (d + 5) % 8             # el vecino previo pasa a ser el de atras
                cy, cx = ny, nx
                if (cy, cx) == (y0, x0) and len(cam) > 2:
                    return cam
                cam.append((cy, cx)); visto.add((cy, cx))
                break
        else:
            return cam
    return cam

def suaviza(pts, k=5, vueltas=2):
    a = np.asarray(pts, float)
    for _ in range(vueltas):
        n = len(a)
        idx = (np.arange(n)[:, None] + np.arange(-(k//2), k//2+1)[None, :]) % n
        a = a[idx].mean(axis=1)
    return a

def dp(pts, eps):
    """Douglas-Peucker sobre un anillo cerrado. Iterativo: los contornos son largos."""
    p = np.asarray(pts, float)
    n = len(p)
    if n < 4:
        return p
    keep = np.zeros(n, bool); keep[0] = keep[n-1] = True
    pila = [(0, n-1)]
    while pila:
        i, j = pila.pop()
        if j <= i + 1:
            continue
        a, b = p[i], p[j]
        ab = b - a
        L = float(np.hypot(ab[0], ab[1]))
        seg = p[i+1:j] - a
        if L < 1e-9:
            d = np.hypot(seg[:, 0], seg[:, 1])
        else:
            d = np.abs(ab[0] * seg[:, 1] - ab[1] * seg[:, 0]) / L
        m = int(d.argmax())
        if d[m] <= eps:
            continue
        m += i + 1
        keep[m] = True
        pila.append((i, m)); pila.append((m, j))
    return p[keep]

def bezier(pts, tension=0.28):
    """Anillo cerrado a curvas cubicas estilo Catmull-Rom."""
    n = len(pts)
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for i in range(n):
        p0 = pts[(i-1) % n]; p1 = pts[i]; p2 = pts[(i+1) % n]; p3 = pts[(i+2) % n]
        c1 = p1 + (p2 - p0) * tension
        c2 = p2 - (p3 - p1) * tension
        d.append(f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}")
    d.append("Z")
    return "".join(d)

# ---------- preparar la imagen ----------
im = Image.open(ORIGEN).convert("RGB")
g = im.convert("L")
bb = g.point(lambda v: 255 if v > 45 else 0).getbbox()
m = 60
bb = (max(0,bb[0]-m), max(0,bb[1]-m), min(im.width,bb[2]+m), min(im.height,bb[3]+m))
im = im.crop(bb)
lado = max(im.size)
li = Image.new("RGB", (lado, lado), SUMI)
li.paste(im, ((lado-im.width)//2, (lado-im.height)//2))
im = li.resize((RES, RES), Image.LANCZOS)

a = np.asarray(im).astype(np.int16)
dist = np.stack([((a - np.array(c))**2).sum(axis=2) for c in PALETA], axis=0)
idx = dist.argmin(axis=0)

def paths(mascara, eps=1.2):
    ds = []
    for c in contornos(mascara):
        p = suaviza(c)
        p = dp(p, eps)
        if len(p) < 4: continue
        q = np.stack([p[:,1] - 1, p[:,0] - 1], axis=1) * (VB / RES)   # (fila,col) -> (x,y)
        ds.append(bezier(q))
    return ds

capas = []
for col, nombre, eps in ((BENGARA,"anillo",1.1), (WASHI,"palillos",1.0), (BLANCO,"texto",0.9)):
    i = PALETA.index(col)
    ds = paths(idx == i, eps)
    hexcol = "#%02X%02X%02X" % col
    capas.append((nombre, hexcol, ds))
    print(f"{nombre:9s} {len(ds):3d} contornos, {sum(len(d) for d in ds)/1024:6.1f} KB de path")

def svg(capas, titulo):
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="{titulo}">']
    for nombre, col, ds in capas:
        if not ds: continue
        o.append(f'<path fill="{col}" fill-rule="evenodd" d="{"".join(ds)}"/>')
    o.append("</svg>")
    return "".join(o)

completo = svg(capas, "Ramen Okaeri")
open(os.path.join(BRAND, "logo.svg"), "w", encoding="utf-8").write(completo)
simbolo = svg([c for c in capas if c[0] != "texto"], "Ramen Okaeri")
open(os.path.join(BRAND, "simbolo.svg"), "w", encoding="utf-8").write(simbolo)
print(f"\nlogo.svg    {os.path.getsize(os.path.join(BRAND,'logo.svg'))/1024:6.1f} KB")
print(f"simbolo.svg {os.path.getsize(os.path.join(BRAND,'simbolo.svg'))/1024:6.1f} KB")


# ---------- version ligera del simbolo, para la cabecera a 38-52 px ----------
RES2 = 900
im2 = im.resize((RES2, RES2), Image.LANCZOS)
a2 = np.asarray(im2).astype(np.int16)
d2 = np.stack([((a2 - np.array(c))**2).sum(axis=2) for c in PALETA], axis=0)
idx2 = d2.argmin(axis=0)

def paths2(mascara, eps):
    ds = []
    for c in contornos(mascara):
        p = suaviza(c, k=5, vueltas=2)
        p = dp(p, eps)
        if len(p) < 5: continue
        q = np.stack([p[:,1] - 1, p[:,0] - 1], axis=1) * (VB / RES2)
        ds.append(bezier(q, 0.24).replace(".0 ", " "))
    return ds

capas2 = []
for col, nombre, eps in ((BENGARA,"anillo",1.5), (WASHI,"palillos",1.3)):
    i = PALETA.index(col)
    capas2.append((nombre, "#%02X%02X%02X" % col, paths2(idx2 == i, eps)))
    print(f"ligero {nombre:9s} {len(capas2[-1][2]):3d} contornos")

lig = svg(capas2, "Ramen Okaeri")
open(os.path.join(BRAND, "simbolo-min.svg"), "w", encoding="utf-8").write(lig)
print(f"simbolo-min.svg {os.path.getsize(os.path.join(BRAND,'simbolo-min.svg'))/1024:6.1f} KB")
