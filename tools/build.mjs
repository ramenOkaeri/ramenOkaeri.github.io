/* =============================================================================
   Generador estático de ramenokaeri.com
   Se ejecuta con:  node tools/build.mjs
   Lee content/*.json y escribe el HTML de los tres idiomas.
   El texto vive en un solo sitio; aquí solo está la estructura.
   ============================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => JSON.parse(readFileSync(join(RAIZ, p), 'utf8'));

const D = leer('content/datos.json');
const IM = leer('content/imagenes.json');
const R = leer('content/resenas.json');
const C = leer('content/carta.json');
/* Huella del contenido en la URL de la hoja y del script.
   Cloudflare sirve el CSS con max-age de cuatro horas y el HTML con diez
   minutos, asi que sin esto un visitante se come el HTML nuevo con el CSS
   viejo: las clases que aun no existian se quedan sin estilo y la pagina
   parece rota. Con la huella, cada despliegue cambia la URL y no queda copia
   vieja que servir. Medido el 8 de septiembre de 2026. */
const huella = (rel) =>
  `/${rel}?v=${createHash('sha1').update(readFileSync(join(RAIZ, rel))).digest('hex').slice(0, 8)}`;
const CSS = huella('css/style.css');
const JS = huella('js/main.js');
/* El panel tiene su propia hoja y su propio script: el visitante no los
   descarga nunca, asi que la web publica no engorda ni un byte por tener
   panel. Llevan huella por lo mismo que la del sitio. */
const ADMIN_CSS = huella('admin/admin.css');
const ADMIN_JS = huella('admin/admin.js');
/* El PDF de la carta tambien, y ahora hace falta de verdad: desde que se puede
   cambiar desde el panel, este archivo deja de ser el mismo para siempre.
   Cloudflare cachea .pdf por extension, asi que sin huella el restaurante
   cambia la carta, el flujo la commitea, y el visitante sigue descargando la
   vieja durante horas. Mismo problema que ya se arreglo para la hoja.
   Verificado en el codigo del visor y no supuesto: viewer.mjs pasa el
   parametro file por URLSearchParams, asi que el ?v= codificado vuelve a salir
   entero, y validateFileURL solo compara el origen. */
const PDF = huella('assets/pdf/menu.pdf');

const IDIOMAS = ['es', 'en', 'gl'];
/* La nota, el total y el enlace salen de content/resenas.json, que lo refresca
   tools/resenas.py contra la API de Places. datos.json solo queda de respaldo
   por si algun dia se construye sin haber traido nada. */
const NOTA = R.nota != null ? R.nota : D.resenas.nota;
const TOTAL = R.total != null ? R.total : D.resenas.total;
const G_ENLACE = R.enlace || D.mapas.google;
const T = Object.fromEntries(IDIOMAS.map((l) => [l, leer(`content/${l}.json`)]));
const BASE = { es: '', en: '/en', gl: '/gl' };
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
/* Schema.org quiere el nombre completo en dayOfWeek; las abreviaturas de dos
   letras son del formato antiguo de openingHours y Google las descarta. */
const DIA_ISO = {
  lunes: 'Monday', martes: 'Tuesday', miercoles: 'Wednesday', jueves: 'Thursday',
  viernes: 'Friday', sabado: 'Saturday', domingo: 'Sunday'
};

/* --------------------------------------------------------------------------- */
/* utilidades                                                                   */
/* --------------------------------------------------------------------------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* El decimal lleva coma en espanol y gallego y punto en ingles; el separador
   de millar, al reves. Node sin ICU completo no formatea esto de fiar. */
const numNota = (l) => (l === 'en' ? String(NOTA) : String(NOTA).replace('.', ','));
const numTotal = (l) => String(TOTAL)
  .replace(/\B(?=(\d{3})+(?!\d))/g, l === 'en' ? ',' : '.');

const rell = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));

/** <picture> con AVIF, WebP y JPEG. `variante` es 'h' (16:9) o 'v' (3:4). */
function pic(nombre, variante, sizes, alt, { clase = '', prio = false, ancho = null } = {}) {
  const m = IM.fotos[nombre];
  if (!m) throw new Error(`falta la foto ${nombre} en imagenes.json`);
  const v = m[variante];
  const base = `/assets/img/${nombre}-${variante}`;
  const set = (ext) => v.anchos.map((a) => `${base}-${a}.${ext} ${a}w`).join(', ');
  const w = ancho || v.anchos[v.anchos.length - 1];
  const h = v.alto[w];
  const carga = prio ? 'eager' : 'lazy';
  const fetchp = prio ? ' fetchpriority="high"' : '';
  return `<picture>
<source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">
<source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">
<img src="${base}-${w}.jpg" srcset="${set('jpg')}" sizes="${sizes}"
 width="${w}" height="${h}" alt="${esc(alt)}" class="${clase}"
 loading="${carga}" decoding="async"${fetchp} style="background:${m.color}">
</picture>`;
}

/** Hero con dirección de arte. En móvil manda un recorte de retrato alto:
 *  una pantalla de iPhone va de 0,46 a 0,56 de relación, y con 3:4 lo que
 *  sobra es ancho, así que el encuadre vertical dejaría de poder tocarse. */
function picHero(nombre, alt) {
  const m = IM.fotos[nombre];
  const set = (v, ext) => m[v].anchos.map((a) => `/assets/img/${nombre}-${v}-${a}.${ext} ${a}w`).join(', ');
  const linea = (v, ext, tipo) =>
    `<source media="${v === 'p' ? '(max-width:899px)' : '(min-width:900px)'}" type="image/${tipo}" srcset="${set(v, ext)}" sizes="100vw">`;
  return `<picture>
${linea('p', 'avif', 'avif')}
${linea('p', 'webp', 'webp')}
${linea('p', 'jpg', 'jpeg')}
${linea('h', 'avif', 'avif')}
${linea('h', 'webp', 'webp')}
<img src="/assets/img/${nombre}-h-1440.jpg" srcset="${set('h', 'jpg')}" sizes="100vw"
 width="1440" height="${m.h.alto[1440]}" alt="${esc(alt)}"
 loading="eager" decoding="async" fetchpriority="high" style="background:${m.color}">
</picture>`;
}

/* iconos dibujados a mano: trazo de 1,6, mismas terminaciones en todos */
const ICO = {
  carta: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h16v15H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  tel: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z"/></svg>',
  mapa: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  bajar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  estrella: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5-5.8-3.05-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/></svg>',
  izq: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  der: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  descarga: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M4.5 19.5h15"/></svg>',
  ig: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
  tt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.2 3.2v10.9a3.6 3.6 0 1 1-3.1-3.57"/><path d="M14.2 3.2a5 5 0 0 0 4.9 4.3"/></svg>',
  fb: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.8 21v-8h2.7l.5-3.2h-3.2V7.7c0-.9.3-1.6 1.7-1.6h1.6V3.2A22 22 0 0 0 15.6 3c-2.4 0-4 1.5-4 4.3v2.5H8.8V13h2.8v8z"/></svg>',
  expandir: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-6 6M4.5 19.5l6-6"/></svg>',
  contraer: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 9.5h5m-5 0v-5m-5 10h-5m5 0v5M14.5 9.5l5-5M9.5 14.5l-5 5"/></svg>',
  moto: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.4" cy="16.8" r="2.7"/><circle cx="17.6" cy="16.8" r="2.7"/><path d="M9.1 16.8h5.8M4.4 16.8 7.7 7.2h2.9M12.4 7.2h3.4l2.2 6.9M12.4 12.4H8.2"/></svg>',
  bolsa: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.1 11.2a1.8 1.8 0 0 1-1.8 1.6H7.9a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M9 8V6.4a3 3 0 0 1 6 0V8"/></svg>'
};

/* --------------------------------------------------------------------------- */
/* piezas comunes                                                               */
/* --------------------------------------------------------------------------- */
const cabecera = (l, { activa = 'inicio' } = {}) => {
  const t = T[l], b = BASE[l];
  const enlaces = [
    [`${b || ''}/menu/`, t.nav.carta],
    [`${b || '/'}#domicilio`, t.nav.domicilio],
    [`${b || '/'}#sitio`, t.nav.sitio],
    [`${b || '/'}#redes`, t.nav.redes],
    [`${b || '/'}#donde`, t.nav.donde]
  ];
  const idiomas = IDIOMAS.map((o) =>
    `<a href="${BASE[o] || '/'}${activa === 'carta' ? 'menu/' : activa === 'legal' ? 'aviso-legal/' : ''}"
 lang="${o}" hreflang="${o}"${o === l ? ' aria-current="true"' : ''}>${o}</a>`).join('');
  return `<header class="cab">
 <div class="env">
  <a class="marca" href="${b || '/'}" aria-label="${esc(t.alt.logo)}">
   <img src="/assets/brand/simbolo.svg" width="38" height="38" alt="">
   <b>Ramen Okaeri</b>
  </a>
  <nav class="nav-esc" aria-label="${esc(t.nav.menu_abrir)}">
   <ul>${enlaces.map(([h, x]) => `<li><a href="${h}">${esc(x)}</a></li>`).join('')}</ul>
  </nav>
  <div class="idi" role="group" aria-label="${esc(t.nav.idioma)}">${idiomas}</div>
  <button class="hamb" type="button" aria-expanded="false" aria-controls="panel"
   aria-label="${esc(t.nav.menu_abrir)}"
   data-abrir="${esc(t.nav.menu_abrir)}" data-cerrar="${esc(t.nav.menu_cerrar)}"><i></i></button>
 </div>
</header>
<div class="panel" id="panel" role="dialog" aria-modal="true"
 aria-label="${esc(t.nav.menu_abrir)}">
 <div class="panel-top">
  <a class="marca" href="${b || '/'}" aria-label="${esc(t.alt.logo)}">
   <img src="/assets/brand/simbolo.svg" width="38" height="38" alt="">
   <b>Ramen Okaeri</b>
  </a>
  <button class="hamb hamb-x" type="button" data-cerrar
   aria-label="${esc(t.nav.menu_cerrar)}"><i></i></button>
 </div>
 <nav class="panel-nav" aria-label="${esc(t.nav.menu_abrir)}">
 ${enlaces.map(([h, x]) => `<a href="${h}">${esc(x)}</a>`).join('\n ')}
 <div class="idi" role="group" aria-label="${esc(t.nav.idioma)}">${idiomas}</div>
 </nav>
</div>`;
};

const barra = (l) => {
  const t = T[l], b = BASE[l];
  return `<nav class="barra" aria-label="${esc(t.nav.menu_abrir)}">
 <a href="${b || ''}/menu/" class="destacado">${ICO.carta}<span>${esc(t.barra.carta)}</span></a>
 <a href="tel:${D.telefono}">${ICO.tel}<span>${esc(t.barra.llamar)}</span></a>
 <a href="${D.mapas.comollegar}" target="_blank" rel="noopener">${ICO.mapa}<span>${esc(t.barra.llegar)}</span></a>
 <a href="${b || '/'}#domicilio">${ICO.moto}<span>${esc(t.barra.llevar)}</span></a>
</nav>`;
};

const pie = (l) => {
  const t = T[l], b = BASE[l];
  const red = (h, i, n) =>
    `<a href="${h}" target="_blank" rel="noopener" aria-label="${n}">${i}</a>`;
  return `<footer class="pie">
 <div class="env">
  <div class="pie-top">
   <a class="marca marca-grande" href="${b || '/'}" aria-label="${esc(t.alt.logo)}">
    <img src="/assets/brand/logo.svg" width="132" height="132" alt="" loading="lazy" decoding="async">
   </a>
   <div>
    <h2 class="oculto">${esc(t.pie.sigue)}</h2>
    <div class="redes">
     ${red(D.redes.instagram, ICO.ig, 'Instagram')}
     ${red(D.redes.tiktok, ICO.tt, 'TikTok')}
     ${red(D.redes.facebook, ICO.fb, 'Facebook')}
     ${red(D.redes.glovo, ICO.bolsa, 'Glovo')}
    </div>
   </div>
  </div>
  <div class="pie-bajo">
   <p>${esc(t.pie.derechos)}</p>
   <nav>
    <a href="${b || ''}/menu/">${esc(t.pie.carta)}</a>
    <a href="${b || ''}/aviso-legal/">${esc(t.pie.legal)}</a>
    <a href="tel:${D.telefono}">${D.telefono_visible}</a>
   </nav>
  </div>
 </div>
</footer>`;
};

/* --------------------------------------------------------------------------- */
/* cabeza del documento                                                          */
/* --------------------------------------------------------------------------- */
function cabeza(l, { titulo, desc, ruta, jsonld = '', noindex = false, clase = '' }) {
  const canon = D.dominio + ruta;
  const alt = IDIOMAS.map((o) => {
    const r = ruta.replace(/^\/(en|gl)\//, '/').replace(/^\/$/, '/');
    const destino = (BASE[o] || '') + (r === '/' ? '/' : r);
    return `<link rel="alternate" hreflang="${o}" href="${D.dominio}${destino}">`;
  }).join('\n ');
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${canon}">
 ${alt}
<link rel="alternate" hreflang="x-default" href="${D.dominio}/">
<meta name="theme-color" content="#121818">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-title" content="Okaeri">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="restaurant">
<meta property="og:site_name" content="Ramen Okaeri">
<meta property="og:locale" content="${l === 'es' ? 'es_ES' : l === 'en' ? 'en_GB' : 'gl_ES'}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="${D.dominio}/assets/brand/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="${D.dominio}">
<link rel="preload" href="/assets/fonts/shippori-700-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/zenkaku-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${CSS}">
${jsonld}
</head>
<body${clase ? ` class="${clase}"` : ''}>
<a class="saltar" href="#principal">${esc(T[l].nav.saltar)}</a>`;
}

/* --------------------------------------------------------------------------- */
/* datos estructurados                                                           */
/* --------------------------------------------------------------------------- */
function ldRestaurante(l) {
  const horas = DIAS
    .filter((d) => (D.horarios[d] || []).length)
    .flatMap((d) => D.horarios[d].map((f) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DIA_ISO[d], opens: f[0], closes: f[1]
    })));
  const o = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': D.dominio + '/#restaurante',
    name: D.marca,
    url: D.dominio + (BASE[l] || '') + '/',
    image: [D.dominio + '/assets/brand/og.jpg', D.dominio + '/assets/img/ramen-h-1440.jpg'],
    logo: D.dominio + '/assets/brand/icon-512.png',
    telephone: D.telefono,
    priceRange: D.precios.rango,
    currenciesAccepted: D.precios.moneda,
    servesCuisine: ['Japanese', 'Ramen'],
    hasMenu: D.dominio + (BASE[l] || '') + '/menu/',
    acceptsReservations: 'True',
    address: {
      '@type': 'PostalAddress',
      streetAddress: D.direccion.calle,
      postalCode: D.direccion.cp,
      addressLocality: D.direccion.ciudad,
      addressRegion: D.direccion.provincia,
      addressCountry: D.direccion.pais
    },
    geo: { '@type': 'GeoCoordinates', latitude: D.direccion.lat, longitude: D.direccion.lon },
    openingHoursSpecification: horas,
    sameAs: [D.redes.instagram, D.redes.tiktok, D.redes.facebook],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: NOTA, reviewCount: TOTAL,
      bestRating: 5, worstRating: 1
    }
  };
  return `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
}

function ldMigas(l, nombre, ruta) {
  const o = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ramen Okaeri', item: D.dominio + (BASE[l] || '') + '/' },
      { '@type': 'ListItem', position: 2, name: nombre, item: D.dominio + ruta }
    ]
  };
  return `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
}

/** Cinco estrellas con la ultima rellena a medias. Dos capas superpuestas y
 *  la de arriba recortada al porcentaje real: 4,8 no puede pintarse como 5. */
function estrellas(nota, etiqueta) {
  const cinco = ICO.estrella.repeat(5);
  return `<span class="estr" role="img" aria-label="${esc(etiqueta)}">
     <span class="estr-fondo" aria-hidden="true">${cinco}</span>
     <span class="estr-lleno" aria-hidden="true" style="width:${(nota / 5) * 100}%">${cinco}</span>
    </span>`;
}

/* --------------------------------------------------------------------------- */
/* la portada                                                                    */
/* --------------------------------------------------------------------------- */
function portada(l) {
  const t = T[l], b = BASE[l];
  const ruta = (b || '') + '/';

  const platos = D.destacados.map((p) => {
    const x = t.cocina.platos[p.id];
    return `<li class="plato">
    <div class="plato-txt"><h3>${esc(x.nombre)}</h3><p>${esc(x.desc)}</p></div>
    <span class="precio">${esc(p.precio)}</span>
   </li>`;
  }).join('\n   ');

  /* sin pie de foto: repetía el texto alternativo y ensuciaba la tira.
     La descripción sigue en el alt, que es donde de verdad sirve. */
  const galeria = D.galeria.map((n) => `<figure>
    ${pic(n, 'v', '(min-width:900px) 400px, (min-width:600px) 46vw, 76vw', t.alt[n], { ancho: 768 })}
   </figure>`).join('\n   ');

  /* Las resenas NO se traducen NUNCA: la API devuelve un juego distinto por
     idioma, cada una escrita en el suyo, y aqui se pinta ese. El texto es
     literal -Google no deja tocarlo- y por eso lleva su lang. Si no hubiera
     ninguna, el bloque de la nota media se pinta igual. */
  const suyas = (R.idiomas && R.idiomas[l]) || [];
  const citas = !suyas.length ? '' : `<div class="citas rv" data-rv="90" data-carrusel>
    <h3 class="oculto">${esc(t.resenas.titulo_lista)}</h3>
    <div class="tira tira-citas" tabindex="0" role="group" aria-label="${esc(t.resenas.titulo_lista)}">
    ${suyas.map((c) => `<figure lang="${esc(c.lang)}">
      ${estrellas(c.estrellas, `${c.estrellas} ${t.resenas.de}`)}
      <blockquote><p>${esc(c.texto)}</p></blockquote>
      <figcaption>
       ${c.avatar ? `<picture>
        <source type="image/webp" srcset="/assets/img/resenas/${c.avatar}.webp">
        <img class="cita-av" src="/assets/img/resenas/${c.avatar}.jpg" width="40" height="40"
         alt="" loading="lazy" decoding="async">
       </picture>` : `<span class="cita-av cita-av-vacio" aria-hidden="true">${esc((c.autor || '?').trim()[0])}</span>`}
       <span class="cita-quien"><b>${esc(c.autor)}</b><span>${esc(c.fecha)}</span></span>
      </figcaption>
     </figure>`).join('\n    ')}
    </div>
    <div class="env">
     <div class="tira-ctrl">
      <button type="button" class="tira-ant" aria-label="${esc(t.resenas.anterior)}">${ICO.izq}</button>
      <button type="button" class="tira-sig" aria-label="${esc(t.resenas.siguiente)}">${ICO.der}</button>
     </div>
    </div>
   </div>`;

  const horario = DIAS.map((d) => {
    const f = (D.horarios[d] || []);
    const txt = f.length ? f.map((x) => `${x[0]}–${x[1]}`).join(' · ') : '—';
    return `<li data-dia="${d}"><span class="dia">${esc(t.dias[d])}</span><span class="franjas">${txt}</span></li>`;
  }).join('\n     ');

  return `${cabeza(l, {
    titulo: t.meta.titulo, desc: t.meta.descripcion, ruta,
    jsonld: ldRestaurante(l)
  })}
${cabecera(l)}
<main id="principal">

 <section class="hero">
  <div class="hero-img">${picHero('fachada', t.alt.fachada)}</div>
  <div class="hero-vel"></div>
  <div class="env">
   <span class="hero-kana" lang="ja">${t.hero.kicker}</span>
   <h1 class="display">${esc(t.hero.titulo)}</h1>
   <p class="entradilla">${esc(t.hero.entradilla)}</p>
   <div class="hero-btns">
    <a class="btn btn-p" href="${b || ''}/menu/">${ICO.carta}${esc(t.hero.cta_carta)}</a>
    <a class="btn btn-s" href="tel:${D.telefono}">${ICO.tel}${esc(t.hero.cta_llamar)}</a>
    <a class="btn btn-s" href="#domicilio">${ICO.moto}${esc(t.hero.cta_domicilio)}</a>
   </div>
   <p class="estrellas">${ICO.estrella}<span>${rell(esc(t.hero.resenas), {
      nota: `</span><b>${numNota(l)}</b><span>`,
      total: `</span><b>${numTotal(l)}</b><span>`
    })}</span></p>
  </div>
 </section>

 <section class="sec" id="nombre">
  <div class="env dos">
   <div class="cuerpo rv">
    <p class="antetitulo">${esc(t.nombre.antetitulo)}</p>
    <h2>${esc(t.nombre.titulo)}</h2>
    <div class="tras-h2">${t.nombre.cuerpo.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
   </div>
   <div class="retrato rv" data-rv="90">
    ${pic('neon-okaeri', 'v', '(min-width:900px) 520px, 92vw', t.alt['neon-okaeri'], { ancho: 1080 })}
   </div>
  </div>
 </section>

 <section class="sec sec-linea" id="carta">
  <div class="env dos invertido">
   <div class="retrato rv">
    ${pic('ramen', 'v', '(min-width:900px) 520px, 92vw', t.alt.ramen, { ancho: 1080 })}
   </div>
   <div class="cuerpo rv" data-rv="90">
    <p class="antetitulo">${esc(t.cocina.antetitulo)}</p>
    <h2>${esc(t.cocina.titulo)}</h2>
    <div class="tras-h2">${t.cocina.cuerpo.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
   </div>
  </div>
  <div class="env">
   <ul class="platos rv">
   ${platos}
   </ul>
   <p class="nota">${esc(t.cocina.alergenos)}</p>
   <div class="acciones">
    <a class="btn btn-p" href="${b || ''}/menu/">${ICO.carta}${esc(t.cocina.cta)}</a>
   </div>
  </div>
 </section>

 <section class="sec sec-linea" id="domicilio">
  <div class="env">
   <div class="cuerpo rv">
    <p class="antetitulo">${esc(t.domicilio.antetitulo)}</p>
    <h2>${esc(t.domicilio.titulo)}</h2>
    <p class="tras-h2">${esc(t.domicilio.texto)}</p>
   </div>
   <div class="acciones rv" data-rv="70">
    <a class="btn btn-p" href="${D.redes.glovo}" target="_blank" rel="noopener">${ICO.bolsa}${esc(t.domicilio.cta_glovo)}</a>
    <a class="btn btn-s" href="${D.redes.justeat}" target="_blank" rel="noopener">${ICO.moto}${esc(t.domicilio.cta_justeat)}</a>
   </div>
  </div>
 </section>

 <section class="sec sec-linea" id="resenas">
  <div class="env">
   <div class="cuerpo rv">
    <p class="antetitulo">${esc(t.resenas.antetitulo)}</p>
    <h2>${esc(t.resenas.titulo)}</h2>
   </div>
   <div class="nota-g rv tras-h2" data-rv="70">
    <p class="nota-cifra"><b>${numNota(l)}</b><span>${esc(t.resenas.de)}</span></p>
    <div class="nota-col">
     ${estrellas(NOTA, `${numNota(l)} ${t.resenas.de}`)}
     <p>${esc(rell(t.resenas.cuenta, { total: numTotal(l) }))} · ${esc(R.fuente)}</p>
    </div>
    <a class="btn btn-s" href="${G_ENLACE}" target="_blank" rel="noopener">${esc(t.resenas.cta)}</a>
   </div>
  </div>
  ${citas}
 </section>

 <section class="sec sec-linea" id="sitio">
  <div class="env">
   <div class="cuerpo rv">
    <p class="antetitulo">${esc(t.sitio.antetitulo)}</p>
    <h2>${esc(t.sitio.titulo)}</h2>
   </div>
   <div class="cuerpo rv tras-h2" data-rv="80">
    ${t.sitio.cuerpo.map((p) => `<p>${esc(p)}</p>`).join('')}
   </div>
  </div>
  <div class="galeria rv" data-rv="120" data-carrusel>
   <h3 class="oculto">${esc(t.sitio.galeria_titulo)}</h3>
   <div class="tira" tabindex="0" role="group" aria-label="${esc(t.sitio.galeria_titulo)}">
   ${galeria}
   </div>
   <div class="env">
    <div class="tira-ctrl">
     <button type="button" class="tira-ant" aria-label="${esc(t.sitio.anterior)}">${ICO.izq}</button>
     <button type="button" class="tira-sig" aria-label="${esc(t.sitio.siguiente)}">${ICO.der}</button>
    </div>
   </div>
  </div>
  <div class="env">
   <div id="redes"><div class="soc rv" data-rv="60">
    <div class="soc-txt">
     <b>${esc(t.redes.titulo)}</b>
     <p>${esc(t.redes.texto)}</p>
    </div>
    <div class="soc-btns">
     <a class="soc-b soc-p" href="${D.redes.instagram}" target="_blank" rel="noopener">
      ${ICO.ig}<span>Instagram<i>${esc(D.redes.instagram_cuenta)}</i></span></a>
     <a class="soc-b" href="${D.redes.tiktok}" target="_blank" rel="noopener">
      ${ICO.tt}<span>TikTok<i>${esc(D.redes.tiktok_cuenta)}</i></span></a>
     <a class="soc-b" href="${D.redes.facebook}" target="_blank" rel="noopener">
      ${ICO.fb}<span>Facebook</span></a>
    </div>
   </div></div>
  </div>
 </section>

 <section class="sec sec-linea" id="donde">
  <div class="env">
   <div class="cuerpo rv">
    <p class="antetitulo">${esc(t.donde.antetitulo)}</p>
    <h2>${esc(t.donde.titulo)}</h2>
    <p class="tras-h2">${esc(t.donde.sub)}</p>
   </div>

   <div class="datos rv" data-rv="80">
    <div>
     <h3>${esc(t.donde.horarios_titulo)}</h3>
     <ul class="horario">
     ${horario}
     </ul>
     <p class="estado" hidden><span class="punto"></span><b></b><span class="detalle"></span></p>
    </div>
    <div class="contacto">
     <h3>${esc(t.donde.contacto_titulo)}</h3>
     <p>${esc(D.direccion.calle)}<br>${D.direccion.cp} ${esc(D.direccion.ciudad)}</p>
     <a class="tel" href="tel:${D.telefono}">${D.telefono_visible}</a>
     <p>${esc(t.donde.reservas)}</p>
     <div class="acciones acciones-juntas">
      <a class="btn btn-p" href="${D.mapas.comollegar}" target="_blank" rel="noopener">${ICO.mapa}${esc(t.donde.cta_llegar)}</a>
      <a class="btn btn-s" href="tel:${D.telefono}">${ICO.tel}${esc(t.donde.cta_llamar)}</a>
     </div>
    </div>
   </div>

   <a class="mapa rv" data-rv="100" href="${D.mapas.comollegar}" target="_blank" rel="noopener"
      aria-label="${esc(t.donde.cta_llegar)}">
    <picture>
     <source type="image/avif" srcset="/assets/img/mapa-720.avif 720w, /assets/img/mapa-1440.avif 1440w" sizes="(min-width:900px) 1180px, 100vw">
     <source type="image/webp" srcset="/assets/img/mapa-720.webp 720w, /assets/img/mapa-1440.webp 1440w" sizes="(min-width:900px) 1180px, 100vw">
     <img src="/assets/img/mapa-720.jpg" srcset="/assets/img/mapa-720.jpg 720w, /assets/img/mapa-1440.jpg 1440w"
      sizes="(min-width:900px) 1180px, 100vw" width="1440" height="720" loading="lazy" decoding="async"
      alt="${esc(t.donde.titulo)}, ${esc(D.direccion.ciudad)}" style="background:#121818">
    </picture>
   </a>
   <p class="nota">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>
  </div>
 </section>


</main>
${pie(l)}
${barra(l)}
<script>window.OKAERI=${JSON.stringify({
    horarios: D.horarios,
    textos: {
      abierto: t.donde.abierto, cerrado: t.donde.cerrado,
      abre: t.donde.abre, cierra: t.donde.cierra
    }
  })};</script>
<script src="${JS}" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* la carta: el visor de pdf.js, con la cabecera de la web alrededor            */
/* --------------------------------------------------------------------------- */
/* El visor de pdf.js, tal cual estaba, movido a /menu/pdf/. La carta en HTML
   se queda con /menu/, que es la ruta que ya conocen los enlaces y Google. */
function cartaPdf(l) {
  const t = T[l], b = BASE[l];
  const ruta = (b || '') + '/menu/pdf/';
  return `${cabeza(l, {
    titulo: t.meta.titulo_carta, desc: t.meta.descripcion_carta, ruta,
    jsonld: ldMigas(l, t.carta.titulo, ruta), clase: 'pag-carta',
    // El visor es un envoltorio del PDF y duplicaria a /menu/, que es la
    // canonica y la que Google si tiene que leer.
    noindex: true
  })}
<div class="visor-barra">
 <a class="marca" href="${b || '/'}">
  <img src="/assets/brand/simbolo.svg" width="30" height="30" alt="">
  <b>Ramen Okaeri</b><span>${esc(t.carta.titulo)}</span>
 </a>
 <a class="visor-volver" href="${b || ''}/menu/">${esc(t.carta.volver_carta)}</a>
 <button type="button" class="visor-pleno" hidden aria-label="${esc(t.carta.pleno)}"
  data-pleno="${esc(t.carta.pleno)}" data-salir="${esc(t.carta.salir_pleno)}">${ICO.expandir}</button>
</div>
<main class="visor" id="principal">
 <h1 class="oculto">${esc(t.carta.titulo)}</h1>
 <iframe src="/web/viewer.html?file=${encodeURIComponent(PDF)}#zoom=page-width"
  title="${esc(t.carta.titulo)}"></iframe>
 <p class="oculto">${esc(t.carta.aviso)} <a href="${PDF}">${esc(t.carta.descargar)}</a></p>
</main>
<button type="button" class="visor-salir" aria-label="${esc(t.carta.salir_pleno)}">${ICO.contraer}</button>
<script src="${JS}" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* aviso legal                                                                   */
/* --------------------------------------------------------------------------- */
function legal(l) {
  const t = T[l], b = BASE[l];
  const ruta = (b || '') + '/aviso-legal/';
  const v = {
    razon_social: D.legal.razon_social, nif: D.legal.nif,
    domicilio: D.legal.domicilio_fiscal, telefono: D.telefono_visible
  };
  const bloques = t.legal.bloques.map((x) =>
    `<h2>${esc(x.h)}</h2><p>${esc(rell(x.p, v))}</p>`).join('\n   ');
  return `${cabeza(l, {
    titulo: t.meta.titulo_legal, desc: t.legal.titulo, ruta, noindex: true
  })}
${cabecera(l, { activa: 'legal' })}
<main id="principal">
 <div class="env legal-cuerpo cuerpo">
  <h1>${esc(t.legal.titulo)}</h1>
  ${bloques}
  <p class="tras-legal"><a class="btn btn-s" href="${b || '/'}">${ICO.izq}${esc(t.legal.volver)}</a></p>
 </div>
</main>
${pie(l)}
<script src="${JS}" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* la carta en HTML                                                              */
/* --------------------------------------------------------------------------- */

/* Marcadores de plato. Van como <symbol> incrustados UNA vez en la pagina y
   cada plato los usa con <use>: 73 platos y cero peticiones de red. Se pintan
   con currentColor, asi que el color lo pone el CSS y no hay que tocarlos.
   Hoy no hay ninguna foto de plato; cuando la haya, la foto gana y esto queda
   de respaldo para los que sigan sin ella. */
const MARCADORES = `<svg class="oculto" aria-hidden="true" focusable="false"><defs>
<g id="pl-ramen"><path d="M3.5 14.5h25a12.5 12.5 0 0 1-25 0Z"/><path d="M12 10.5c0-2 2-2.2 2-4M18 10.5c0-2 2-2.2 2-4"/></g>
<g id="pl-arroz"><path d="M4.5 16.5h23a11.5 11.5 0 0 1-23 0Z"/><path d="M9.5 16.5a6.5 6.5 0 0 1 13 0"/></g>
<g id="pl-tapa"><path d="M4.5 19.5h23c0-5.7-5.1-9.8-11.5-9.8S4.5 13.8 4.5 19.5Z"/><path d="M10 19.5v-3.2M16 19.5v-4.6M22 19.5v-3.2"/></g>
<g id="pl-bebida"><path d="M10 6.5h12l-1.5 18a1.7 1.7 0 0 1-1.7 1.6h-5.6a1.7 1.7 0 0 1-1.7-1.6Z"/><path d="M10.7 14h10.6"/></g>
<g id="pl-postre"><path d="M4.5 22.5h23"/><path d="M8.5 22.5a7.5 7.5 0 0 1 15 0"/></g>
<g id="pl-coctel"><path d="M5 7h22L16 19Z"/><path d="M16 19v7M11.5 26h9"/></g>
<g id="pl-generico"><circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="6"/></g>

<g id="alg-gluten"><path d="M16 29V12"/><path d="M16 21.5c-3.2 0-5.2-1.8-5.2-4.5 3.2 0 5.2 1.8 5.2 4.5Z"/><path d="M16 21.5c3.2 0 5.2-1.8 5.2-4.5-3.2 0-5.2 1.8-5.2 4.5Z"/><path d="M16 15c-3.2 0-5.2-1.8-5.2-4.5 3.2 0 5.2 1.8 5.2 4.5Z"/><path d="M16 15c3.2 0 5.2-1.8 5.2-4.5-3.2 0-5.2 1.8-5.2 4.5Z"/><path d="M16 10c0-2.5 1-4.2 2.9-5 .5 2.5-.5 4.3-2.9 5Z"/></g>
<g id="alg-crustaceos"><path d="M24 10c-6.6 0-11.6 3.8-11.6 9 0 4.3 3.5 7.4 8.2 7.4 2.4 0 4.2-.7 5.4-1.6"/><path d="M12.6 18.4c-3.4.3-5.6 2.4-6.1 5.6"/><path d="M24 10c1.4-1.9 3.3-2.9 5.6-3"/><path d="M22.2 9.6c-.4-2.2.4-4 2.2-5.4"/><path d="M16.6 24.8c-.8 1.9-2.3 3-4.4 3.4"/></g>
<g id="alg-huevos"><path d="M16 27.5c-4.4 0-7.6-3-7.6-7.2 0-5.2 3.6-11.8 7.6-11.8s7.6 6.6 7.6 11.8c0 4.2-3.2 7.2-7.6 7.2Z"/><circle cx="16" cy="19.5" r="3.4"/></g>
<g id="alg-pescado"><path d="M4.5 16c3.4-4.6 7.6-6.9 12.6-6.9 4.6 0 8.2 2.3 10.8 6.9-2.6 4.6-6.2 6.9-10.8 6.9-5 0-9.2-2.3-12.6-6.9Z"/><path d="M27.9 16c1.3-.5 2.4-1.5 3.3-3v6c-.9-1.5-2-2.5-3.3-3Z"/><circle cx="11.5" cy="14.6" r="1.1"/></g>
<g id="alg-cacahuetes"><path d="M20.4 6.5c3.4 0 5.8 2.5 5.8 5.6 0 2.2-1.1 3.4-1.1 5.1 0 1.8 1.1 2.9 1.1 5.1 0 3.1-2.4 5.6-5.8 5.6h-8.8c-3.4 0-5.8-2.5-5.8-5.6 0-2.2 1.1-3.3 1.1-5.1 0-1.7-1.1-2.9-1.1-5.1 0-3.1 2.4-5.6 5.8-5.6Z"/><path d="M7 17.2h18"/></g>
<g id="alg-soja"><path d="M27 6.5c0 8.4-5.6 15.3-13.2 15.3-4.4 0-7.6-2.9-7.6-7 0-6.8 5.8-12.2 12.6-12.2"/><circle cx="12.4" cy="15.4" r="2.4"/><circle cx="18.6" cy="10.4" r="2.4"/><path d="M6.2 28.5c1.6-4.3 4.2-7.6 7.6-9.8"/></g>
<g id="alg-leche"><path d="M10 12.5h12v16H10Z"/><path d="M10 12.5 13 6h6l3 6.5"/><path d="M13 6V3.5h6V6"/><path d="M10 19.5h12"/></g>
<g id="alg-frutos-secos"><path d="M16 28.5c-4.8 0-8.4-4.2-8.4-9.6 0-5 3.2-9.4 8.4-9.4s8.4 4.4 8.4 9.4c0 5.4-3.6 9.6-8.4 9.6Z"/><path d="M7.8 14.2c1.8-1.7 4.8-2.7 8.2-2.7s6.4 1 8.2 2.7"/><path d="M16 11.5V4.8"/><path d="M16 5.2c-1.4-1.5-3.2-2.2-5.4-2.2.3 2.4 1.7 3.9 4 4.4"/></g>
<g id="alg-apio"><path d="M11 29c-1.4-5-1.8-10.4-1.2-16.2"/><path d="M16 29c0-5.6.3-11 1-16.2"/><path d="M21 29c1.4-5 2.2-10.4 2.4-16.2"/><path d="M8.2 12.8c-.6-3.4.8-5.8 4.2-7.2 1 2.2.8 4.4-.6 6.6"/><path d="M17 12.8c-1-3.6 0-6.4 3-8.4 1.6 2.6 1.6 5.4 0 8.4"/><path d="M23.6 12.8c1.6-2.8 1.2-5.4-1.2-7.8"/></g>
<g id="alg-mostaza"><path d="M11 12.5h10c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H11c-1.1 0-2-.9-2-2v-12c0-1.1.9-2 2-2Z"/><path d="M12 12.5v-3h8v3"/><path d="M13.5 9.5V6h5v3.5"/><path d="M9 18.5h14"/></g>
<g id="alg-sesamo"><path d="M12 6.5c2.3 0 4 1.9 4 4.3s-1.7 4.3-4 4.3-4-1.9-4-4.3 1.7-4.3 4-4.3Z"/><path d="M23 12c2.3 0 4 1.9 4 4.3s-1.7 4.3-4 4.3-4-1.9-4-4.3 1.7-4.3 4-4.3Z"/><path d="M12.5 19.5c2.3 0 4 1.9 4 4.3s-1.7 4.3-4 4.3-4-1.9-4-4.3 1.7-4.3 4-4.3Z"/></g>
<g id="alg-sulfitos"><path d="M13 4.5h6"/><path d="M14 4.5v7.2L7.6 24.4c-.9 1.8.4 3.9 2.4 3.9h12c2 0 3.3-2.1 2.4-3.9L18 11.7V4.5"/><path d="M10.4 19h11.2"/></g>
<g id="alg-altramuces"><path d="M16 29V15"/><path d="M16 15c-4.2 0-6.6-2.2-6.6-5.6 4.2 0 6.6 2.2 6.6 5.6Z"/><path d="M16 15c4.2 0 6.6-2.2 6.6-5.6-4.2 0-6.6 2.2-6.6 5.6Z"/><path d="M16 9c-2.6-1.2-3.8-3.2-3.4-5.8 2.6.6 4 2.4 4 5.2"/><path d="M16 9c2.6-1.2 3.8-3.2 3.4-5.8-2.6.6-4 2.4-4 5.2"/></g>
<g id="alg-moluscos"><path d="M16 27.5c-6.4 0-11.5-4.8-11.5-11 0-3.4 2.3-5.6 5-5.6 1.5 0 2.8.7 3.6 1.9.7-2.3 1.6-4.1 2.9-5.3 1.3 1.2 2.2 3 2.9 5.3.8-1.2 2.1-1.9 3.6-1.9 2.7 0 5 2.2 5 5.6 0 6.2-5.1 11-11.5 11Z"/><path d="M16 8.5v19"/><path d="M10.6 13.2 8.2 25.2"/><path d="M21.4 13.2 23.8 25.2"/></g>

<g id="etq-hoja"><path d="M6 26C6 14 13 7.5 26 6.5 25 19.5 18 26 6 26Z"/><path d="M6 26c3.5-6.5 8-11 13.5-13.5"/></g>
<g id="esc-chile"><path d="M21 9c1.4 7.6-3.6 15.8-11.1 16.3-3.2.2-5.4-1.8-5.4-4.5 0-2.6 2-4.3 5-4.6C16.1 15.8 20 12.9 21 9Z"/><path d="M21 9c.1-2.7 1.7-4.4 4.7-5.1"/><path d="M25.7 3.9c1.8.2 3 1.3 3.5 3.1"/></g>
<g id="esc-caldo"><path d="M3.5 16.5h25a12.5 12.5 0 0 1-25 0Z"/><path d="M12 12c0-2 2-2.2 2-4M18 12c0-2 2-2.2 2-4"/></g>
<g id="esc-nivel"><path d="M7 26V18M16 26V12M25 26V6"/></g>
</defs></svg>`;

/* Los alergenos son los 14 del Reglamento (UE) 1169/2011: una lista cerrada
   POR LEY, no un vocabulario que vaya a crecer. Por eso el icono se casa aqui
   por slug y la tabla no necesita una columna mas ni el esquema una migracion.
   Un slug que no este en la lista simplemente sale sin icono. */
const ICO_ALG = new Set(['gluten', 'crustaceos', 'huevos', 'pescado', 'cacahuetes',
  'soja', 'leche', 'frutos-secos', 'apio', 'mostaza', 'sesamo', 'sulfitos',
  'altramuces', 'moluscos']);
/* En el filtro el icono va TACHADO cuando la casilla esta marcada: "sin gluten"
   es una exclusion, y una pastilla que solo cambia de color no lo dice. La raya
   va dentro del propio <svg>, al lado del <use>, porque un SVG no admite ::after.
   Fuera del filtro no se tacha nunca. */
const marcaAlg = (slug, tachable) => ICO_ALG.has(slug)
  ? `<svg class="ico-alg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="#alg-${slug}"></use>` +
    (tachable ? '<line class="tacha" x1="4.5" y1="27.5" x2="27.5" y2="4.5"/>' : '') + '</svg>'
  : '';

/* El icono de una escala y el de una etiqueta salen de su propio campo `icono`,
   que llevaba en los datos desde el principio sin que lo leyera nadie. Lo que no
   se reconozca cae en un icono neutro, que es mejor que un hueco. */
const ICO_ESC = { chile: 'esc-chile', caldo: 'esc-caldo', punto: 'esc-nivel' };
const marcaEsc = (icono) =>
  `<svg class="ico-esc" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="#${ICO_ESC[icono] || 'esc-nivel'}"></use></svg>`;

/* "Sin Gluten" con la mayuscula intercalada es un calco del ingles, y sale en
   los tres idiomas: el nombre viene capitalizado del vocabulario porque alli va
   suelto, y en el filtro va dentro de una frase. Se le baja la inicial, que en
   los catorce son nombres comunes y ninguno es un nombre propio. */
const minusc = (s, l) => (s ? s.charAt(0).toLocaleLowerCase(l) + s.slice(1) : s);

const ICO_ETQ = { hoja: 'etq-hoja' };
const marcaEtq = (icono) => ICO_ETQ[icono]
  ? `<svg class="ico-alg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="#${ICO_ETQ[icono]}"></use></svg>`
  : '';

/* Pliega acentos y pasa a minusculas, para que "jalapeno" encuentre "jalapeño"
   y "cafe" encuentre "café". Se calcula al construir y viaja en data-buscar, asi
   que el navegador solo tiene que hacer un indexOf. */
const plegar = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* El decimal lleva coma en espanol y gallego y punto en ingles, igual que la
   nota de Google. El simbolo va detras en es/gl y delante en en. */
const precio = (n, l) => {
  const v = Number(n).toFixed(2);
  return l === 'en' ? `€${v}` : `${v.replace('.', ',')} €`;
};

const txt = (o, l) => (o && (o[l] || o.es)) || '';

/* JSON-LD de la carta. Es de donde sale que alguien encuentre el restaurante
   buscando "gyozas Santiago": hasta ahora la carta era una imagen dentro de un
   PDF y Google no leia ni un plato. */
function ldCarta(l) {
  const nomCat = Object.fromEntries(
    C.categorias.flatMap((m) => [[m.slug, txt(m.nombre, l)], ...m.hijas.map((h) => [h.slug, txt(h.nombre, l)])])
  );
  const secciones = [];
  for (const m of C.categorias) {
    const suyos = C.platos.filter((p) => p.categoria_madre === m.slug);
    if (!suyos.length) continue;
    secciones.push({
      '@type': 'MenuSection',
      name: nomCat[m.slug],
      hasMenuItem: suyos.map((p) => {
        const it = { '@type': 'MenuItem', name: txt(p.nombre, l) };
        const d = txt(p.descripcion, l);
        if (d) it.description = d;
        const ofertas = p.precios
          .filter((x) => x.precio != null)
          .map((x) => ({
            '@type': 'Offer',
            price: Number(x.precio).toFixed(2),
            priceCurrency: 'EUR',
            ...(x.etiqueta ? { name: txt(x.etiqueta, l) } : {}),
          }));
        if (ofertas.length) it.offers = ofertas.length === 1 ? ofertas[0] : ofertas;
        const dietas = [];
        if (p.etiquetas.includes('vegano')) dietas.push('https://schema.org/VeganDiet');
        else if (p.etiquetas.includes('vegetariano')) dietas.push('https://schema.org/VegetarianDiet');
        if (dietas.length) it.suitableForDiet = dietas.length === 1 ? dietas[0] : dietas;
        return it;
      }),
    });
  }
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: T[l].carta.titulo,
    inLanguage: l,
    url: D.dominio + (BASE[l] || '') + '/menu/',
    hasMenuSection: secciones,
  })}</script>`;
}

/** Una fila de plato. El detalle va en <details>: accesible de fabrica, funciona
 *  sin JavaScript y evita construir un modal que el sitio no tiene. */
function filaPlato(p, l, t) {
  const nombre = txt(p.nombre, l);
  const desc = txt(p.descripcion, l);
  const nota = txt(p.nota, l);
  const alergenos = p.alergenos.map((a) => a.slug);
  /* Se pintan TODAS las escalas que tenga el plato, no solo el picante. La
     intensidad del caldo llevaba en el modelo desde el primer dia y no se veia,
     asi que rellenarla no servia de nada: se guardaba y desaparecia. El orden
     es el de C.escalas, para que dos platos las enseñen siempre igual. */
  const escalas = C.escalas
    .map((e) => ({ ...e, suyo: p.escalas.find((x) => x.slug === e.slug) }))
    .filter((e) => e.suyo && e.suyo.valor > 0);

  /* Todo lo que filtra viaja en atributos del propio <li>. Asi la pagina no
     lleva ni un JSON duplicado: el HTML es el dato. */
  const datos = [
    `data-cat="${esc(p.categoria)}"`,
    `data-madre="${esc(p.categoria_madre)}"`,
    p.etiquetas.length ? `data-etq="${esc(p.etiquetas.join(' '))}"` : '',
    alergenos.length ? `data-alg="${esc(alergenos.join(' '))}"` : '',
    /* Un atributo por escala y no uno cableado al picante: la proxima escala
       que se cree entra sola en el HTML y el filtro no hay que tocarlo. */
    ...C.escalas.map((e) => {
      const suyo = p.escalas.find((x) => x.slug === e.slug);
      return `data-e-${esc(e.slug)}="${suyo ? suyo.valor : 0}"`;
    }),
    `data-buscar="${esc(plegar([nombre, desc, p.numero || ''].join(' ')))}"`,
  ].filter(Boolean).join(' ');

  const marcador = p.imagen
    ? `<img class="plato-ico" src="${esc(p.imagen)}" width="56" height="56" alt="" loading="lazy" decoding="async">`
    : `<svg class="plato-ico" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="#pl-${esc(p.icono)}"></use></svg>`;

  const chips = [];
  for (const e of p.etiquetas) {
    const meta = C.etiquetas.find((x) => x.slug === e);
    if (meta) chips.push(`<span class="chip chip-dieta">${marcaEtq(meta.icono)}${esc(txt(meta.nombre, l))}</span>`);
  }
  /* El icono dice QUE escala es y los puntos CUANTO tiene. La frase entera va en
     .oculto y los puntos en aria-hidden: quien ve, cuenta puntos; quien escucha,
     oye "Picante: 2 de 3". El patron ya era correcto y no se toca. */
  for (const e of escalas) {
    const tope = e.suyo.maximo || e.maximo;
    const puntos = Array.from({ length: tope }, (_, i) =>
      `<i class="${i < e.suyo.valor ? 'on' : ''}"></i>`).join('');
    chips.push(
      `<span class="chip chip-nivel">${marcaEsc(e.icono)}` +
      `<span class="oculto">${esc(txt(e.nombre, l))}: ${esc(rell(t.carta.nivel, { n: e.suyo.valor, m: tope }))}</span>` +
      `<span class="pips" aria-hidden="true">${puntos}</span></span>`
    );
  }
  for (const a of p.alergenos) {
    const meta = C.alergenos.find((x) => x.slug === a.slug);
    if (!meta) continue;
    const n = esc(txt(meta.nombre, l));
    chips.push(
      `<span class="chip chip-alg"${a.grado === 'trazas' ? ' data-trazas' : ''}>${marcaAlg(a.slug)}` +
      `<span class="oculto">${esc(a.grado === 'trazas' ? t.carta.trazas : t.carta.contiene)}: </span>${n}</span>`
    );
  }

  const precios = p.precios.map((x) => {
    const val = x.precio == null
      ? `<span class="precio-consulta">${esc(t.carta.consultar)}</span>`
      : esc(precio(x.precio, l));
    return x.etiqueta
      ? `<span class="precio-var"><span class="precio-et">${esc(txt(x.etiqueta, l))}</span>${val}</span>`
      : `<span class="precio-var">${val}</span>`;
  }).join('');

  /* Los grupos de opciones se buscan por slug en la raiz del documento: la
     definicion vive una sola vez y los nueve ramen apuntan a la misma. */
  const grupos = p.grupos.map((slug) => {
    const g = C.grupos.find((x) => x.slug === slug);
    if (!g) return '';
    const pista = g.tipo === 'multiple' ? t.carta.elige_varios : t.carta.elige_uno;
    const ops = g.opciones.map((o) => {
      const inc = o.incremento == null
        ? ` <span class="op-mas op-consulta">${esc(t.carta.consultar)}</span>`
        : o.incremento > 0
          ? ` <span class="op-mas">+${esc(precio(o.incremento, l))}</span>`
          : '';
      return `<li>${esc(txt(o.nombre, l))}${inc}</li>`;
    }).join('');
    return `<div class="plato-grupo"><h4>${esc(txt(g.nombre, l))} <span>${esc(pista)}</span></h4><ul>${ops}</ul></div>`;
  }).join('');

  const detalleAlg = p.alergenos.length
    ? `<div class="plato-grupo"><h4>${esc(t.carta.alergenos)}</h4><ul class="alg-lista">` +
      p.alergenos.map((a) => {
        const meta = C.alergenos.find((x) => x.slug === a.slug);
        return `<li>${marcaAlg(a.slug)}${esc(txt(meta.nombre, l))}${a.grado === 'trazas' ? ` <span>(${esc(t.carta.trazas)})</span>` : ''}</li>`;
      }).join('') + '</ul></div>'
    : '';

  const cuerpo = [nota ? `<p class="plato-nota">${esc(nota)}</p>` : '', detalleAlg, grupos]
    .filter(Boolean).join('');

  const abrible = Boolean(cuerpo);

  const cabezaFila =
    `${marcador}` +
    `<h3 class="plato-n">${p.numero ? `<span class="plato-num">${esc(p.numero)}</span> ` : ''}${esc(nombre)}</h3>` +
    `<span class="precio">${precios}</span>` +
    (desc ? `<span class="plato-desc">${esc(desc)}</span>` : '') +
    (chips.length ? `<span class="plato-chips">${chips.join('')}</span>` : '');

  if (!abrible) {
    return `<li class="cplato" ${datos}><div class="plato-fila">${cabezaFila}</div></li>`;
  }
  return `<li class="cplato" ${datos}><details><summary>${cabezaFila}<span class="plato-abre" aria-hidden="true"></span></summary><div class="plato-mas">${cuerpo}</div></details></li>`;
}

function menuCarta(l) {
  const t = T[l], b = BASE[l];
  const ruta = (b || '') + '/menu/';

  /* Secciones: una por categoria madre, con sus hijas dentro. */
  const secciones = C.categorias.map((m) => {
    const suyos = C.platos.filter((p) => p.categoria_madre === m.slug);
    if (!suyos.length) return '';
    const desc = txt(m.descripcion, l);

    const bloques = m.hijas.length
      ? m.hijas.map((h) => {
          const dentro = suyos.filter((p) => p.categoria === h.slug);
          if (!dentro.length) return '';
          return `<h3 class="carta-sub">${esc(txt(h.nombre, l))}</h3>\n<ul class="carta-platos">\n${dentro.map((p) => filaPlato(p, l, t)).join('\n')}\n</ul>`;
        }).join('\n') +
        (() => {
          const sueltos = suyos.filter((p) => p.categoria === m.slug);
          return sueltos.length
            ? `\n<ul class="carta-platos">\n${sueltos.map((p) => filaPlato(p, l, t)).join('\n')}\n</ul>`
            : '';
        })()
      : `<ul class="carta-platos">\n${suyos.map((p) => filaPlato(p, l, t)).join('\n')}\n</ul>`;

    return `<section class="carta-sec" id="sec-${esc(m.slug)}" data-sec="${esc(m.slug)}">
 <h2 class="antetitulo">${esc(txt(m.nombre, l))}</h2>
 ${desc ? `<p class="carta-sec-desc">${esc(desc)}</p>` : ''}
 ${bloques}
</section>`;
  }).filter(Boolean).join('\n');

  const anclas = C.categorias
    .filter((m) => C.platos.some((p) => p.categoria_madre === m.slug))
    .map((m) => `<a href="#sec-${esc(m.slug)}">${esc(txt(m.nombre, l))}</a>`)
    .join('');

  /* Solo las categorias madre: son las mismas seis de la fila de anclas, asi que
     el filtro y la navegacion dicen lo mismo. Una hija no hace falta, porque el
     plato ya cae dentro de su madre. Varias marcadas SUMAN -es una o la otra-, al
     reves que las dietas: un plato solo esta en una categoria, asi que exigirlas
     todas devolveria siempre cero. */
  const cats = C.categorias
    .filter((m) => C.platos.some((p) => p.categoria_madre === m.slug))
    .map((m) =>
      `<label class="chip-btn"><input type="checkbox" name="cat" value="${esc(m.slug)}">` +
      `<span>${esc(txt(m.nombre, l))}</span></label>`
    ).join('');

  /* Solo se ofrece filtrar por los alergenos que algun plato declara: una
     casilla de "sin apio" que no quita nada solo estorba. */
  const usados = new Set(C.platos.flatMap((p) => p.alergenos.map((a) => a.slug)));
  const casillas = C.alergenos.filter((a) => usados.has(a.slug)).map((a) =>
    `<label class="chip-btn chip-sin"><input type="checkbox" name="sin" value="${esc(a.slug)}">` +
    `<span>${marcaAlg(a.slug, true)}${esc(rell(t.carta.sin_uno, { a: minusc(txt(a.nombre, l), l) }))}</span></label>`
  ).join('');

  const dietas = C.etiquetas.map((e) =>
    `<label class="chip-btn"><input type="checkbox" name="dieta" value="${esc(e.slug)}">` +
    `<span>${marcaEtq(e.icono)}${esc(txt(e.nombre, l))}</span></label>`
  ).join('');

  /* El picante deja de ser un <select> con emojis. Un emoji no es un icono: lo
     pinta la fuente del sistema, sale de otro color que el resto de la interfaz y
     un lector de pantalla lee "pimiento picante, pimiento picante, pimiento
     picante". Ahora son radios con la misma pastilla que el resto de la barra y
     los mismos puntos que la ficha del plato, asi que el filtro y el plato se
     leen igual. La primera opcion es "da igual", que es el estado de partida.
     Y filtra el nivel EXACTO, no "como mucho": pedir dos chiles devuelve los que
     pican dos, no tambien los que no pican. */
  const escPic = C.escalas.find((e) => e.slug === 'picante');
  const pastillaPic = (valor, dentro, marcado) =>
    `<label class="chip-btn chip-pic"><input type="radio" name="pic" value="${valor}"${marcado ? ' checked' : ''}>` +
    `<span>${dentro}</span></label>`;
  const nivelesPic = escPic
    ? [pastillaPic('', esc(t.carta.picante_da_igual), true),
       pastillaPic('0', esc(t.carta.picante_nada), false)]
        .concat(Array.from({ length: escPic.maximo }, (_, i) => {
          const n = i + 1;
          const puntos = Array.from({ length: escPic.maximo }, (_, j) =>
            `<i class="${j < n ? 'on' : ''}"></i>`).join('');
          return pastillaPic(String(n),
            marcaEsc(escPic.icono) +
            `<span class="oculto">${esc(rell(t.carta.nivel, { n, m: escPic.maximo }))}</span>` +
            `<span class="pips" aria-hidden="true">${puntos}</span>`, false);
        }))
        .join('')
    : '';

  const leyenda = C.alergenos.map((a) =>
    `<li>${marcaAlg(a.slug)}${esc(txt(a.nombre, l))}</li>`).join('');

  return `${cabeza(l, {
    titulo: t.meta.titulo_carta, desc: t.meta.descripcion_carta, ruta,
    jsonld: ldMigas(l, t.carta.titulo, ruta) + '\n' + ldCarta(l), clase: 'pag-menu'
  })}
${cabecera(l)}
<main id="principal">
${MARCADORES}
 <div class="env carta-cab">
  <h1 class="display">${esc(t.carta.titulo)}</h1>
  <p class="carta-sub">${esc(t.carta.sub)}</p>
  <p><a class="btn btn-s" href="${b || ''}/menu/pdf/">${ICO.descarga}${esc(t.carta.pdf)}</a></p>
 </div>

 <nav class="carta-anclas" aria-label="${esc(t.carta.secciones)}"><span class="env">${anclas}</span></nav>

 <form class="carta-filtros" id="filtros" hidden aria-label="${esc(t.carta.filtros)}">
  <div class="env">
   <div class="filtro-buscar">
    <!-- El boton va DELANTE del campo. Es un flex en fila, asi que el orden del
         DOM es el orden en pantalla y no hace falta ningun order en la hoja.
         El aviso de "hay filtros puestos" era un <i> vacio: se veia y no decia
         nada. Ahora es un numero, y el nombre accesible del boton se recompone
         para que quien no ve tampoco se quede sin saberlo. -->
    <button type="button" class="filtro-abre" id="abre-filtros" aria-expanded="false" aria-controls="filtro-cajon"
     data-nombre="${esc(t.carta.filtros)}" data-puestos="${esc(t.carta.filtros_puestos)}" data-puesto="${esc(t.carta.filtros_uno)}">
     <span>${esc(t.carta.filtros)}</span><span class="filtro-cuenta" id="filtro-cuenta" hidden></span>
    </button>
    <label for="q" class="oculto">${esc(t.carta.buscar)}</label>
    <input type="search" id="q" name="q" placeholder="${esc(t.carta.buscar_ph)}" autocomplete="off" enterkeyhint="search">
   </div>
   <div class="filtro-cajon" id="filtro-cajon">
   <fieldset class="filtro-grupo">
    <legend>${esc(t.carta.categoria)}</legend>
    ${cats}
   </fieldset>
   <fieldset class="filtro-grupo">
    <legend>${esc(t.carta.dieta)}</legend>
    ${dietas}
   </fieldset>
   <fieldset class="filtro-grupo">
    <legend>${esc(t.carta.sin_alergenos)}</legend>
    ${casillas}
   </fieldset>
   ${escPic ? `<fieldset class="filtro-grupo">
    <legend>${esc(t.carta.picante)}</legend>
    ${nivelesPic}
   </fieldset>` : ''}
   </div>
   <p class="filtro-pie">
    <!-- aria-live="off" a proposito: <output> ya es una region viva implicita, y
         con la de abajo puesta anunciaria dos veces cada tecleo. El recuento en
         voz alta lo da #anuncio, que espera a que se pare de escribir. -->
    <output id="cuenta" for="q" aria-live="off" data-plantilla="${esc(t.carta.resultados)}" data-uno="${esc(t.carta.resultados_uno)}"></output>
    <button type="button" class="btn-t" id="limpiar">${esc(t.carta.limpiar)}</button>
   </p>
   <!-- En todo el sitio no habia ni una region viva: la carta se recortaba en
        silencio y quien no ve no se enteraba de haber pasado de 73 platos a 12. -->
   <p class="oculto" id="anuncio" role="status" aria-live="polite"></p>
  </div>
 </form>

 <div class="env">
  <p class="carta-vacio" id="vacio" hidden>${esc(t.carta.sin_resultados)}</p>
${secciones}

  <aside class="carta-leyenda">
   <h2>${esc(t.carta.alergenos)}</h2>
   <p>${esc(t.carta.aviso_alergenos)}</p>
   <ul>${leyenda}</ul>
  </aside>
 </div>
</main>
${pie(l)}
<script src="${JS}" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* el panel                                                                     */
/* --------------------------------------------------------------------------- */
/* Sin cabecera ni pie del sitio y con noindex: no es una pagina del
   restaurante, es la herramienta con la que se mantiene la carta. */
function panel() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Panel de la carta · Ramen Okaeri</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#121818">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="stylesheet" href="${ADMIN_CSS}">
</head>
<body>
<div id="app"><p class="cargando">Cargando…</p></div>
<p class="aviso" id="aviso" hidden></p>
<script src="${ADMIN_JS}" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* 404                                                                           */
/* --------------------------------------------------------------------------- */
function error404() {
  const t = T.es;
  return `${cabeza('es', {
    titulo: '404 · Ramen Okaeri', desc: t.meta.descripcion, ruta: '/404.html', noindex: true
  })}
${cabecera('es')}
<main id="principal" class="err">
 <div class="env">
  <h1 class="display">404</h1>
  <p>Esta página no existe. Puede que el enlace esté viejo o que se haya escrito mal.</p>
  <p><a class="btn btn-p" href="/">Volver al inicio</a></p>
 </div>
</main>
<script src="${JS}" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* escritura                                                                     */
/* --------------------------------------------------------------------------- */
function escribe(rel, html) {
  const p = join(RAIZ, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html, 'utf8');
  return `${rel.padEnd(30)} ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`;
}

const salida = [];
for (const l of IDIOMAS) {
  const b = BASE[l].replace(/^\//, '');
  salida.push(escribe(join(b, 'index.html'), portada(l)));
  salida.push(escribe(join(b, 'menu', 'index.html'), menuCarta(l)));
  salida.push(escribe(join(b, 'menu', 'pdf', 'index.html'), cartaPdf(l)));
  salida.push(escribe(join(b, 'aviso-legal', 'index.html'), legal(l)));
}
salida.push(escribe('404.html', error404()));
salida.push(escribe(join('admin', 'index.html'), panel()));

/* Sello de lo publicado. El panel lo pide y lo compara con la fecha del ultimo
   cambio en Supabase para poder decir "hay cambios sin publicar". Se sirve desde
   el propio dominio, asi que el panel no necesita ningun token de GitHub para
   saber como esta la cosa. */
escribe('assets/version.json', JSON.stringify({
  publicado: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  platos: (C.platos || []).length,
  carta: createHash('sha1').update(readFileSync(join(RAIZ, 'content/carta.json'))).digest('hex').slice(0, 8),
  /* La huella del PDF, para que el panel pueda decir si el que hay en la web es
     el ultimo que se subio y el registro del flujo lo cante al publicar. */
  pdf: createHash('sha1').update(readFileSync(join(RAIZ, 'assets/pdf/menu.pdf'))).digest('hex').slice(0, 8)
}, null, 1) + String.fromCharCode(10));

/* manifiesto, robots y sitemap */
escribe('site.webmanifest', JSON.stringify({
  name: 'Ramen Okaeri', short_name: 'Okaeri', start_url: '/',
  display: 'standalone', background_color: '#121818', theme_color: '#121818',
  icons: [
    { src: '/assets/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png' }
  ]
}, null, 1));

escribe('robots.txt', `User-agent: *\nAllow: /\nDisallow: /web/\nDisallow: /build/
Disallow: /admin/\n\nSitemap: ${D.dominio}/sitemap.xml\n`);

const urls = [];
for (const l of IDIOMAS) {
  for (const p of ['/', '/menu/']) {
    const loc = D.dominio + (BASE[l] || '') + p;
    const alt = IDIOMAS.map((o) =>
      `  <xhtml:link rel="alternate" hreflang="${o}" href="${D.dominio}${BASE[o] || ''}${p}"/>`).join('\n');
    urls.push(` <url>\n  <loc>${loc}</loc>\n${alt}\n  <changefreq>monthly</changefreq>\n  <priority>${p === '/' ? '1.0' : '0.8'}</priority>\n </url>`);
  }
}
escribe('sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);

console.log(salida.join('\n'));
console.log('\nlisto: ' + (salida.length + 4) + ' archivos');
