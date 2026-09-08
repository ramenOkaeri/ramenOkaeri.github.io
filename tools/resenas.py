# -*- coding: utf-8 -*-
"""Trae las resenas de Google y las escribe en content/resenas.json.

    GOOGLE_MAPS_KEY=... python tools/resenas.py           # solo ensena
    GOOGLE_MAPS_KEY=... python tools/resenas.py --escribe  # guarda el JSON
    ... --escribe --incluye-todas                          # sin filtrar por nota

POR QUE SE LLAMA AQUI Y NO EN EL NAVEGADOR
------------------------------------------
La forma que circula por los tutoriales es cargar la API de Places desde el
navegador del visitante. Eso costaria cuatro cosas: la clave queda a la vista
en el HTML, la llamada se factura en cada visita, seria la primera peticion a
un tercero de todo el sitio -y con ella el banner de cookies que hoy no hace
falta-, y Google no indexaria las citas porque se pintan con JavaScript.

Llamandola aqui, al construir, la clave no sale de este ordenador, el visitante
no le pide nada a nadie, siguen sin hacer falta cookies y Google si lee las
citas, porque acaban siendo texto de verdad en el HTML.

LA CLAVE NO SE ESCRIBE EN NINGUN SITIO. Se lee del entorno y punto: ni en este
archivo, ni en el JSON de salida, ni en la boveda, ni en el repositorio.

QUE SE PUEDE Y QUE NO
---------------------
Google devuelve como mucho CINCO resenas y las elige el. Se puede elegir cuales
de esas cinco se ensenan; NO se puede tocar el texto ni acortarlo. Por eso aqui
solo se filtra y nunca se edita.

Y devuelve un juego DISTINTO por cada languageCode, cada una escrita en ese
idioma. De ahi que cada version de la web ensene resenas nativas y no haya que
traducir ninguna.

Se refresca volviendo a ejecutarlo y reconstruyendo. Conviene hacerlo al menos
una vez al mes: Google pide no cachear este contenido mas de 30 dias.
"""
import json, os, sys, io, re, glob, hashlib, unicodedata, urllib.request, urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(REPO, 'content', 'resenas.json')
AVATARES = os.path.join(REPO, 'assets', 'img', 'resenas')
LADO = 80          # se ensena a 40 px, asi que el doble para pantallas densas
CONSULTA = 'Ramen Okaeri, Rua das Orfas 27, Santiago de Compostela'
IDIOMAS = ['es', 'en', 'gl']

MESES = {
    'es': ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
           'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    'gl': ['xaneiro', 'febreiro', 'marzo', 'abril', 'maio', 'xuño', 'xullo',
           'agosto', 'setembro', 'outubro', 'novembro', 'decembro'],
    'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July',
           'August', 'September', 'October', 'November', 'December'],
}


def fecha(iso, lang):
    """2026-07-06T... -> 'julio de 2026'. Absoluta y no relativa: un 'hace dos
       meses' horneado en HTML estatico envejece mal."""
    a, m = int(iso[0:4]), int(iso[5:7])
    mes = MESES[lang][m - 1]
    return '%s %d' % (mes, a) if lang == 'en' else '%s de %d' % (mes, a)


def mote(nombre):
    """Nombre -> trozo de ruta estable y sin acentos, con un hash detras para
       que dos personas que se llamen igual no compartan archivo."""
    base = unicodedata.normalize('NFKD', nombre or 'anon')
    base = base.encode('ascii', 'ignore').decode('ascii').lower()
    base = re.sub(r'[^a-z0-9]+', '-', base).strip('-')[:22] or 'anon'
    h = hashlib.sha1((nombre or '').encode('utf-8')).hexdigest()[:6]
    return '%s-%s' % (base, h)


def avatar(url, nombre):
    """Baja la foto de quien escribio la resena y la deja cuadrada aqui dentro.

    Se aloja en el propio dominio a proposito: tirar de lh3.googleusercontent.com
    seria la primera peticion a un tercero de todo el sitio. Google permite
    cachear su contenido hasta 30 dias, que es justo el ritmo al que conviene
    volver a lanzar este script."""
    if not url:
        return None
    try:
        from PIL import Image, ImageOps
    except ImportError:
        print('   (sin Pillow: no se bajan avatares)')
        return None
    # el photoUri trae una cadena de parametros pegada (=s128-c-rp-mo-br100):
    # se corta desde el =s y se pide el tamano que hace falta
    u = re.sub(r'=s\d+.*$', '', url) + '=s%d' % (LADO * 2)
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as r:
            crudo = r.read()
    except Exception as e:
        print('   avatar de %s: no se pudo bajar (%s)' % (nombre, e))
        return None
    im = Image.open(io.BytesIO(crudo)).convert('RGB')
    im = ImageOps.fit(im, (LADO, LADO), Image.LANCZOS, centering=(0.5, 0.5))
    os.makedirs(AVATARES, exist_ok=True)
    n = mote(nombre)
    im.save(os.path.join(AVATARES, n + '.webp'), 'WEBP', quality=82, method=6)
    im.save(os.path.join(AVATARES, n + '.jpg'), 'JPEG', quality=84, optimize=True)
    return n


def pide(url, cabeceras, cuerpo=None):
    datos = json.dumps(cuerpo).encode('utf-8') if cuerpo is not None else None
    r = urllib.request.Request(url, data=datos, headers=cabeceras,
                               method='POST' if datos else 'GET')
    try:
        with urllib.request.urlopen(r, timeout=30) as f:
            return json.loads(f.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        sys.exit('HTTP %d: %s' % (e.code, e.read().decode('utf-8', 'replace')[:600]))


def main():
    clave = os.environ.get('GOOGLE_MAPS_KEY', '').strip()
    if not clave:
        sys.exit('falta GOOGLE_MAPS_KEY en el entorno')
    escribe = '--escribe' in sys.argv
    todas = '--incluye-todas' in sys.argv

    d = pide('https://places.googleapis.com/v1/places:searchText',
             {'Content-Type': 'application/json', 'X-Goog-Api-Key': clave,
              'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'},
             {'textQuery': CONSULTA, 'languageCode': 'es', 'regionCode': 'ES'})
    sitios = d.get('places') or []
    if not sitios:
        sys.exit('la busqueda no encontro el sitio')
    pid = sitios[0]['id']
    print('sitio: %s  (%s)' % (sitios[0]['displayName']['text'], pid))

    # se limpian los avatares viejos: si alguien deja de salir, su foto se va
    for viejo in glob.glob(os.path.join(AVATARES, '*')):
        os.remove(viejo)

    fuera, idiomas = [], {}
    nota = total = enlace = None
    for l in IDIOMAS:
        det = pide('https://places.googleapis.com/v1/places/%s?languageCode=%s&regionCode=ES'
                   % (pid, l),
                   {'X-Goog-Api-Key': clave,
                    'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri,reviews'})
        nota = det.get('rating')
        total = det.get('userRatingCount')
        # el googleMapsUri trae pegada detras una firma de la peticion;
        # el enlace canonico de la ficha es solo el cid
        u = det.get('googleMapsUri')
        enlace = (u.split('&')[0] if u else None) or enlace
        lista = []
        for x in det.get('reviews', []):
            # originalText es lo que escribio la persona; text puede venir traducido
            o = x.get('originalText') or x.get('text') or {}
            a = x.get('authorAttribution') or {}
            r = {
                'autor': a.get('displayName'),
                'estrellas': x.get('rating'),
                'fecha': fecha(x['publishTime'], l),
                'texto': (o.get('text') or '').strip(),
                'lang': (o.get('languageCode') or l).split('-')[0],
                'publicada': x['publishTime'][:10],
            }
            if not r['texto']:
                continue
            if r['estrellas'] < 5 and not todas:
                fuera.append('%s (%s, %s*, %s)' % (r['autor'], l, r['estrellas'], r['fecha']))
                continue
            # se baja despues de filtrar: si la resena no sale, su foto tampoco
            r['avatar'] = avatar(a.get('photoUri'), r['autor'])
            lista.append(r)
        idiomas[l] = lista
        print('  %s: %d resenas  (%d con avatar)'
              % (l, len(lista), sum(1 for x in lista if x.get('avatar'))))

    if fuera:
        print('\nFUERA por nota < 5 (se recuperan con --incluye-todas):')
        for f in fuera:
            print('  -', f)

    doc = {
        '_nota': 'GENERADO por tools/resenas.py. No se edita a mano: se vuelve a '
                 'ejecutar. Los textos son literales de Google y NO se traducen ni se '
                 'acortan: cada idioma trae su propio juego de resenas, escritas en ese '
                 'idioma, porque la API devuelve un conjunto distinto por languageCode.',
        '_licencia': 'Resenas de Google. Se muestran con el nombre y la foto de quien las '
                     'escribio y con enlace a la ficha, que es lo que pide Google. Los '
                     'avatares se alojan en assets/img/resenas/ para no pedirle nada a '
                     'ningun tercero desde el navegador del visitante; Google permite '
                     'cachear su contenido hasta 30 dias, asi que hay que relanzar esto '
                     'al menos una vez al mes.',
        'fuente': 'Google',
        'enlace': enlace,
        'nota': nota,
        'total': total,
        'actualizado': __import__('datetime').date.today().isoformat(),
        'idiomas': idiomas,
    }
    if escribe:
        io.open(SALIDA, 'w', encoding='utf-8').write(
            json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
        print('\nescrito %s  (nota %s, total %s)' % (SALIDA, nota, total))
    else:
        print('\n(en seco: anade --escribe para guardarlo)')


if __name__ == '__main__':
    main()
