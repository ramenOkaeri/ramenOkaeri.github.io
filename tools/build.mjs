/* =============================================================================
   Generador estático de ramenokaeri.com
   Se ejecuta con:  node tools/build.mjs
   Lee content/*.json y escribe el HTML de los tres idiomas.
   El texto vive en un solo sitio; aquí solo está la estructura.
   ============================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => JSON.parse(readFileSync(join(RAIZ, p), 'utf8'));

const D = leer('content/datos.json');
const IM = leer('content/imagenes.json');
const IDIOMAS = ['es', 'en', 'gl'];
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
  bolsa: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.1 11.2a1.8 1.8 0 0 1-1.8 1.6H7.9a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M9 8V6.4a3 3 0 0 1 6 0V8"/></svg>'
};

/* --------------------------------------------------------------------------- */
/* piezas comunes                                                               */
/* --------------------------------------------------------------------------- */
const cabecera = (l, { activa = 'inicio' } = {}) => {
  const t = T[l], b = BASE[l];
  const enlaces = [
    [`${b || ''}/menu/`, t.nav.carta],
    [`${b || '/'}#sitio`, t.nav.sitio],
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
<nav class="panel" id="panel" aria-label="${esc(t.nav.menu_abrir)}">
 ${enlaces.map(([h, x]) => `<a href="${h}">${esc(x)}</a>`).join('\n ')}
 <div class="idi" role="group" aria-label="${esc(t.nav.idioma)}">${idiomas}</div>
</nav>`;
};

const barra = (l) => {
  const t = T[l], b = BASE[l];
  return `<nav class="barra" aria-label="${esc(t.nav.menu_abrir)}">
 <a href="${b || ''}/menu/" class="destacado">${ICO.carta}<span>${esc(t.barra.carta)}</span></a>
 <a href="tel:${D.telefono}">${ICO.tel}<span>${esc(t.barra.llamar)}</span></a>
 <a href="${D.mapas.comollegar}" target="_blank" rel="noopener">${ICO.mapa}<span>${esc(t.barra.llegar)}</span></a>
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
function cabeza(l, { titulo, desc, ruta, jsonld = '', noindex = false }) {
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
<link rel="stylesheet" href="/css/style.css">
${jsonld}
</head>
<body>
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
      ratingValue: D.resenas.nota, reviewCount: D.resenas.total,
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
   </div>
   <p class="estrellas">${ICO.estrella}<span>${rell(esc(t.hero.resenas), {
      /* el decimal va con coma en español y gallego, con punto en inglés */
      nota: `</span><b>${l === 'en' ? String(D.resenas.nota) : String(D.resenas.nota).replace('.', ',')}</b><span>`,
      total: `</span><b>${String(D.resenas.total).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}</b><span>`
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
    <a class="btn btn-s" href="${D.redes.glovo}" target="_blank" rel="noopener">${ICO.bolsa}${esc(t.donde.cta_glovo)}</a>
   </div>
  </div>
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
  <div class="galeria rv" data-rv="120">
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
<script src="/js/main.js" defer></script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------- */
/* la carta: el visor de pdf.js, con la cabecera de la web alrededor            */
/* --------------------------------------------------------------------------- */
function carta(l) {
  const t = T[l], b = BASE[l];
  const ruta = (b || '') + '/menu/';
  return `${cabeza(l, {
    titulo: t.meta.titulo_carta, desc: t.meta.descripcion_carta, ruta,
    jsonld: ldMigas(l, t.carta.titulo, D.dominio + ruta)
  })}
${cabecera(l, { activa: 'carta' })}
<main id="principal">
 <div class="env carta-cab">
  <h1>${esc(t.carta.titulo)}</h1>
  <p>${esc(t.carta.sub)}</p>
  <div class="carta-acciones">
   <a class="btn btn-s" href="/assets/pdf/menu.pdf" download="carta-ramen-okaeri.pdf">${ICO.descarga}${esc(t.carta.descargar)}</a>
   <a class="btn btn-s" href="${b || '/'}">${ICO.izq}${esc(t.carta.volver)}</a>
  </div>
 </div>
 <div class="visor">
  <iframe src="/web/viewer.html?file=/assets/pdf/menu.pdf#zoom=page-width"
   title="${esc(t.carta.titulo)}" loading="lazy"></iframe>
 </div>
 <div class="env carta-aviso"><p>${esc(t.carta.aviso)}</p></div>
</main>
${barra(l)}
<script src="/js/main.js" defer></script>
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
<script src="/js/main.js" defer></script>
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
  salida.push(escribe(join(b, 'menu', 'index.html'), carta(l)));
  salida.push(escribe(join(b, 'aviso-legal', 'index.html'), legal(l)));
}
salida.push(escribe('404.html', error404()));

/* manifiesto, robots y sitemap */
escribe('site.webmanifest', JSON.stringify({
  name: 'Ramen Okaeri', short_name: 'Okaeri', start_url: '/',
  display: 'standalone', background_color: '#121818', theme_color: '#121818',
  icons: [
    { src: '/assets/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png' }
  ]
}, null, 1));

escribe('robots.txt', `User-agent: *\nAllow: /\nDisallow: /web/\nDisallow: /build/\n\nSitemap: ${D.dominio}/sitemap.xml\n`);

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
