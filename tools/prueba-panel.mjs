/* =============================================================================
   Prueba del panel /admin/ con Supabase simulado
   Se ejecuta con la skill browser-automation (patchright), no con node a secas:

     python -m http.server 8080          (desde la raiz del repositorio)
     node ~/.claude/skills/browser-automation/browser.mjs about:blank --timeout 3000 \
       --script tools/prueba-panel.mjs

   Variables de entorno:
     PANEL_BASE      http://localhost:8080 (por defecto) o https://ramenokaeri.com
     PANEL_CAPTURAS  carpeta donde dejar capturas; sin ella no se hace ninguna

   QUE GARANTIZA QUE NO TOCA NADA
     Toda peticion a Supabase se contesta AQUI con datos sacados de
     content/carta.json: no sale ni una. Al sitio solo se dejan pasar GET, y
     cualquier otra cosa se aborta. Se puede pasar contra produccion sin riesgo.

   QUE MIDE
     La tabla de verificacion de la auditoria del 17 de septiembre de 2026 (nota
     «Web de Ramen Okaeri» de la boveda): estado de publicacion por contenido,
     traducciones que no se pisan, precio obligatorio, avisos, filtro y
     busqueda, alto de la lista, Guardar fijo, cambios sin guardar, areas
     tactiles, nombres accesibles, contraste, una sola escritura al guardar,
     revision de alergenos, hojas y consola. Cada comprobacion devuelve el dato
     medido, no un si/no: un cero sin su control no prueba nada.
   ============================================================================= */
import { readFileSync } from 'node:fs';

const RAIZ = new URL('../', import.meta.url);
const BASE = (process.env.PANEL_BASE || 'http://localhost:8080').replace(/\/$/, '');
const CAPTURAS = process.env.PANEL_CAPTURAS || '';
const SITIO = new URL(BASE).host;
const CARTA = JSON.parse(readFileSync(new URL('content/carta.json', RAIZ), 'utf8'));
const SUPA = new URL(JSON.parse(readFileSync(new URL('content/supabase.json', RAIZ), 'utf8')).url).host;

/* --- las tablas que devolveria PostgREST, a partir de la carta publicada --- */
function tablas(C) {
  const T = {};
  T.alergenos = C.alergenos.map((a, i) => ({ id: i + 1, slug: a.slug, nombre: a.nombre, orden: i + 1 }));
  T.etiquetas = C.etiquetas.map((e, i) => ({ id: 'et-' + e.slug, slug: e.slug, nombre: e.nombre, icono: e.icono, orden: i + 1 }));
  T.escalas = C.escalas.map((e, i) => ({ id: 'es-' + e.slug, slug: e.slug, nombre: e.nombre, maximo: e.maximo, icono: e.icono, orden: i + 1 }));
  T.grupos_opcion = C.grupos.map((g, i) => ({ id: 'g-' + g.slug, slug: g.slug, nombre: g.nombre, tipo: g.tipo, obligatorio: g.obligatorio, orden: i + 1 }));
  T.opciones = C.grupos.flatMap((g) => g.opciones.map((o, i) => ({ id: `o-${g.slug}-${o.slug}`, grupo_id: 'g-' + g.slug, slug: o.slug, nombre: o.nombre, incremento: o.incremento, orden: i + 1 })));
  T.categorias = [];
  C.categorias.forEach((m, i) => {
    T.categorias.push({ id: 'c-' + m.slug, slug: m.slug, padre_id: null, nombre: m.nombre, descripcion: m.descripcion, icono: m.icono, orden: i + 1, activa: true });
    m.hijas.forEach((h, j) => T.categorias.push({ id: 'c-' + h.slug, slug: h.slug, padre_id: 'c-' + m.slug, nombre: h.nombre, descripcion: h.descripcion, icono: h.icono, orden: j + 1, activa: true }));
  });
  const porCat = {};
  T.platos = C.platos.map((p) => {
    porCat[p.categoria] = (porCat[p.categoria] || 0) + 1;
    return { id: 'p-' + p.slug, slug: p.slug, numero: p.numero, categoria_id: 'c-' + p.categoria, nombre: p.nombre, descripcion: p.descripcion,
      imagen: p.imagen, nota: p.nota, disponible: true, destacado: p.destacado, orden: porCat[p.categoria], alergenos_revisados: null };
  });
  const alg = Object.fromEntries(T.alergenos.map((a) => [a.slug, a.id]));
  T.plato_precios = C.platos.flatMap((p) => p.precios.map((x, i) => ({ id: `pr-${p.slug}-${i}`, plato_id: 'p-' + p.slug, etiqueta: x.etiqueta, precio: x.precio, orden: i + 1 })));
  T.plato_alergenos = C.platos.flatMap((p) => p.alergenos.map((a) => ({ plato_id: 'p-' + p.slug, alergeno_id: alg[a.slug], grado: a.grado })));
  T.plato_etiquetas = C.platos.flatMap((p) => p.etiquetas.map((e) => ({ plato_id: 'p-' + p.slug, etiqueta_id: 'et-' + e })));
  T.plato_escalas = C.platos.flatMap((p) => p.escalas.map((e) => ({ plato_id: 'p-' + p.slug, escala_id: 'es-' + e.slug, valor: e.valor })));
  T.plato_grupos = C.platos.flatMap((p) => p.grupos.map((g, i) => ({ plato_id: 'p-' + p.slug, grupo_id: 'g-' + g, orden: i + 1 })));
  T.publicaciones_lista = [
    { id: '00000000-0000-4000-8000-000000000002', creado: '2026-09-12T16:13:30Z', motivo: 'publicacion', resumen: '73 platos en 6 secciones', platos: 73 },
    { id: '00000000-0000-4000-8000-000000000001', creado: '2026-09-11T18:50:20Z', motivo: 'publicacion', resumen: '73 platos en 6 secciones', platos: 73 }
  ];
  return T;
}

/* La carta con un cambio sin publicar: el Tonkotsu pasa de 12,95 a 13,50. */
const CARTA_CAMBIADA = JSON.parse(JSON.stringify(CARTA));
CARTA_CAMBIADA.platos.find((p) => p.slug === 'tonkotsu-ramen').precios[0].precio = 13.5;

async function monta(page, esc) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    const m = req.method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });

    if (u.host === SUPA) {
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const cuerpo = req.postData() || '';
      const p = u.pathname;
      if (m !== 'GET' && !/rpc\/carta_json|object\/list/.test(p)) esc.escrituras.push(m + ' ' + p);
      if (p === '/auth/v1/token') {
        if (esc.loginFalla && u.searchParams.get('grant_type') === 'password') {
          esc.loginFalla = false;
          return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        }
        return json(200, { access_token: 'simulado', token_type: 'bearer', expires_in: 3600, refresh_token: 'simulado-r', user: { id: 'u1' } });
      }
      if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
      if (p === '/rest/v1/rpc/carta_json') return json(200, esc.pendiente ? CARTA_CAMBIADA : CARTA);
      if (p === '/rest/v1/rpc/guarda_plato') {
        const d = JSON.parse(cuerpo).p;
        esc.guardados.push(d);
        return json(200, { id: d.id || 'p-nuevo', slug: d.slug });
      }
      if (p === '/rest/v1/rpc/guarda_alergenos') {
        const d = JSON.parse(cuerpo);
        esc.revisiones.push(d);
        const ahora = new Date().toISOString();
        const fila = esc.T.platos.find((x) => x.id === d.p_plato);
        if (fila) fila.alergenos_revisados = ahora;
        esc.T.plato_alergenos = esc.T.plato_alergenos.filter((x) => x.plato_id !== d.p_plato)
          .concat(d.p_alergenos.map((a) => ({ plato_id: d.p_plato, alergeno_id: a.id, grado: a.grado })));
        return json(200, { id: d.p_plato, alergenos_revisados: ahora });
      }
      if (p === '/rest/v1/rpc/guarda_grupo') { esc.grupos.push(JSON.parse(cuerpo).g); return json(200, { id: 'g', slug: 's' }); }
      if (p.startsWith('/rest/v1/')) {
        const tabla = p.slice(9);
        if (m === 'GET') return json(200, esc.T[tabla] || []);
        if (m === 'PATCH') {
          if (esc.falloPatch) return json(500, { message: 'fallo simulado' });
          return json(200, [{}]);
        }
        if (m === 'DELETE') return json(200);
        if (m === 'POST') return json(201, JSON.parse(cuerpo || '[]'));
      }
      if (p === '/storage/v1/object/list/buzon') return json(200, []);
      if (p === '/functions/v1/publicar') { esc.publicaciones += 1; return json(200, { ok: true, lanzado: new Date().toISOString() }); }
      return json(404, { message: 'sin simular: ' + p });
    }
    if (u.host === SITIO && m === 'GET') {
      if (u.pathname === '/content/carta.json' && esc.publicada) {
        return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(esc.publicada) });
      }
      return route.continue();
    }
    esc.bloqueadas.push(m + ' ' + u.host + u.pathname.slice(0, 40));
    return route.abort();
  });
}

const CONTRASTE = `(function(){
  function lum(c){ return c.map(function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); })
    .reduce(function(a,v,i){ return a+v*[0.2126,0.7152,0.0722][i]; },0); }
  function rgb(s){ return s.match(/[\\d.]+/g).slice(0,3).map(Number); }
  return function(color, fondo){ var l1=lum(rgb(color)), l2=lum(rgb(fondo)); return +((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2); };
})()`;

/* Areas tactiles por debajo de 44 px, con identidad y no solo cuantas. Los
   radios y casillas escondidos no cuentan: el objetivo es su <label>. */
const PEQUENAS = () => {
  const r = {};
  document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea, label.seg-op, label.casilla, label.icono-op').forEach((e) => {
    const b = e.getBoundingClientRect();
    if (!b.width || !b.height) return;
    if (getComputedStyle(e).visibility === 'hidden') return;
    if (b.height >= 44 && b.width >= 44) return;
    const k = `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0] || '-'} ${Math.round(b.width)}x${Math.round(b.height)}`;
    r[k] = (r[k] || 0) + 1;
  });
  return r;
};
/* Controles sin nombre accesible: ni label[for], ni label que lo envuelva, ni
   aria-label, ni aria-labelledby. */
const SIN_NOMBRE = () => [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')]
  .filter((c) => !(c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) && !c.closest('label')
    && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby'))
  .map((c) => `${c.tagName.toLowerCase()}[${c.type || ''}] ${c.placeholder || ''}`);

export default async (page0) => {
  const browser = page0.context().browser();
  const R = { base: BASE };
  const esc = { T: tablas(CARTA), escrituras: [], guardados: [], revisiones: [], grupos: [], publicaciones: 0, bloqueadas: [],
    loginFalla: true, pendiente: false, publicada: null, falloPatch: false };
  /* PANEL_ESCRITORIO=1 lo pasa en un ordenador de 1280×800 en vez de en un móvil de 390×844. */
  const escritorio = process.env.PANEL_ESCRITORIO === '1';
  R.pantalla = escritorio ? 'escritorio 1280x800' : 'movil 390x844';
  const ctx = await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid',
    viewport: escritorio ? { width: 1280, height: 800 } : { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: !escritorio, hasTouch: !escritorio, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (400|500)/.test(m.text())) errores.push(m.text().slice(0, 200)); });
  await monta(page, esc);
  const captura = async (nombre) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` }); };
  const paso = async (nombre, fn) => { try { await fn(); } catch (e) { R['FALLO_' + nombre] = String(e).split('\n')[0].slice(0, 300); } };
  const avisoTexto = () => page.evaluate(() => { const a = document.querySelector('#avisos .aviso'); return a ? a.querySelector('.aviso-txt').textContent : null; });
  const dialogosAbiertos = () => page.evaluate(() => document.querySelectorAll('dialog[open]').length);

  await paso('carga', async () => {
    await page.goto(BASE + '/menu/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('form.entrada input[type=email]', { timeout: 20000 });
  });

  await paso('entrada', async () => {
    await page.fill('form.entrada input[type=email]', 'panel@ejemplo.test');
    await page.fill('form.entrada input[type=password]', 'mal');
    await page.click('form.entrada button[type=submit]');
    await page.waitForFunction(() => document.querySelector('.error-form').textContent.trim().length > 0, null, { timeout: 8000 });
    R.entrada = await page.evaluate(() => {
      const e = document.querySelector('.error-form'), b = document.querySelector('form.entrada button[type=submit]');
      return { texto: e.textContent, role: e.getAttribute('role'), debajoDelBoton: Math.round(e.getBoundingClientRect().top - b.getBoundingClientRect().bottom),
        verClave: !!document.querySelector('.clave-ver') };
    });
    await captura('01-entrada-error');
    await page.fill('form.entrada input[type=password]', 'bien');
    await page.click('form.entrada button[type=submit]');
    await page.waitForSelector('.fila', { timeout: 20000 });
  });

  await paso('lista', async () => {
    await page.waitForTimeout(800);
    R.lista = await page.evaluate(() => {
      const f = document.querySelector('.fila').getBoundingClientRect();
      const nav = [...document.querySelectorAll('.nav-i')].map((a) => { const r = a.getBoundingClientRect(); return a.textContent.trim() + (r.right <= innerWidth && r.bottom <= innerHeight ? '' : ' FUERA'); });
      const secciones = [...document.querySelectorAll('.seccion-tit')].map((h) => h.textContent);
      const nombre = document.querySelector('.fila-nombre').getBoundingClientRect().width;
      return { primerPlatoY: Math.round(f.top), anchoNombre: Math.round(nombre), destinos: nav, primerasSecciones: secciones.slice(0, 4), filas: document.querySelectorAll('.fila').length,
        franjaVisible: !document.querySelector('#franja').hidden, tarjetaRevision: (document.querySelector('.tarjeta-rev') || {}).textContent || null };
    });
    R.lista.pequenas = await page.evaluate(PEQUENAS);
    await captura('02-lista');
  });

  await paso('filtroYBusqueda', async () => {
    const cuenta = () => page.evaluate(() => document.querySelectorAll('.fila').length);
    const opciones = await page.$$eval('select.filtro option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
    const tapas = opciones.find((o) => /^Tapas \(/.test(o.t));
    await page.selectOption('select.filtro', tapas.v);
    const nTapas = await cuenta();
    await page.selectOption('select.filtro', '');
    const busca = async (q) => { await page.fill('.buscador input', q); return cuenta(); };
    R.filtro = { tapas: nTapas, bambu: await busca('bambu'), 'bambú': await busca('bambú'), 'gyoza pollo': await busca('gyoza pollo'), control_gyoza: await busca('gyoza') };
    await page.fill('.buscador input', '');
  });

  await paso('interruptorYAvisos', async () => {
    const fila = page.locator('.fila').first();
    const nombre = await fila.locator('.fila-nombre').textContent();
    await fila.locator('.interruptor').click();
    await page.waitForSelector('.fila.fuera', { timeout: 5000 });
    R.fuera = await page.evaluate((src) => {
      const contraste = eval(src);
      const f = document.querySelector('.fila.fuera');
      return { chip: (f.querySelector('.chip-aviso') || {}).textContent, contrasteNombre: contraste(getComputedStyle(f.querySelector('.fila-nombre')).color, getComputedStyle(document.body).backgroundColor),
        contrastePrecio: contraste(getComputedStyle(f.querySelector('.fila-meta')).color, getComputedStyle(document.body).backgroundColor), opacidad: getComputedStyle(f).opacity };
    }, CONTRASTE);
    R.fuera.nombre = nombre;
    R.fuera.aviso = await avisoTexto();
    R.fuera.conDeshacer = await page.evaluate(() => !!document.querySelector('#avisos .aviso-accion'));
    /* carrera: aviso de exito y, un segundo despues, un error */
    await page.waitForTimeout(1000);
    esc.falloPatch = true;
    await page.locator('.fila.fuera .interruptor').first().click();
    await page.waitForFunction(() => document.querySelector('#avisos .aviso-error'), null, { timeout: 5000 });
    R.avisos = { error: await avisoTexto(), role: await page.evaluate(() => document.querySelector('#avisos .aviso-error').getAttribute('role')) };
    await page.waitForTimeout(5500);
    R.avisos.errorSigueTras5s = await page.evaluate(() => !!document.querySelector('#avisos .aviso-error'));
    esc.falloPatch = false;
    await page.locator('.fila.fuera .interruptor').first().click();
    await page.waitForFunction(() => !document.querySelector('.fila.fuera'), null, { timeout: 5000 });
  });

  await paso('ficha', async () => {
    await page.goto(BASE + '/admin/#/plato/alitas-pollo-japonesas', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form.ficha', { timeout: 20000 });
    await page.waitForTimeout(500);
    await captura('03-ficha');
    R.ficha = await page.evaluate(() => {
      const vh = innerHeight, docH = document.documentElement.scrollHeight;
      scrollTo(0, Math.round(docH / 2));
      const g = [...document.querySelectorAll('.acciones-fijas button')].pop().getBoundingClientRect();
      return { pantallas: +(docH / vh).toFixed(1), guardarVisibleAMitad: g.top >= 0 && g.bottom <= vh, guardarY: Math.round(g.top),
        barraDestinosVisible: getComputedStyle(document.querySelector('.nav')).display !== 'none', variantes: [...document.querySelectorAll('.precio-var input')].map((i) => i.value) };
    });
    await page.evaluate(() => scrollTo(0, 0));
    R.ficha.sinNombreAccesible = await page.evaluate(SIN_NOMBRE);
    R.ficha.pequenas = await page.evaluate(PEQUENAS);
    await page.evaluate(() => document.querySelector('.alergenos').scrollIntoView({ block: 'start' }));
    await captura('04-ficha-alergenos');
    await page.evaluate(() => scrollTo(0, 0));
  });

  await paso('traducciones', async () => {
    const et = page.locator('.precio-var input').first();
    await et.click();
    await page.keyboard.press('End');
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    esc.escrituras.length = 0;
    await page.locator('.acciones-fijas .btn-p').click();
    await page.waitForFunction(() => /Guardado/.test((document.querySelector('#avisos .aviso-txt') || {}).textContent || ''), null, { timeout: 8000 });
    const d = esc.guardados[esc.guardados.length - 1];
    R.traducciones = { etiquetasEnviadas: d.precios.map((x) => x.etiqueta), escrituras: esc.escrituras.slice(),
      alVolver: await page.evaluate(() => ({ ruta: location.hash, foco: (document.activeElement.closest('.fila') || {}).dataset?.slug || null })) };
  });

  await paso('cambiosSinGuardar', async () => {
    await page.goto(BASE + '/admin/#/platos', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fila');
    await page.locator('.fila .fila-abre').first().click();
    await page.waitForSelector('form.ficha');
    const nombre = page.locator('.campo-idiomas input[lang=es]').first();
    await nombre.fill((await nombre.inputValue()) + ' CAMBIADO');
    await page.locator('.acciones-fijas .btn-s').click();
    await page.waitForTimeout(300);
    const conCancelar = await dialogosAbiertos();
    await page.getByRole('button', { name: 'Seguir editando' }).click();
    await page.waitForTimeout(200);
    await page.goBack();
    await page.waitForTimeout(500);
    const conAtras = await dialogosAbiertos();
    const rutaTrasAtras = await page.evaluate(() => location.hash);
    await page.getByRole('button', { name: 'Salir sin guardar' }).click();
    await page.waitForSelector('.fila', { timeout: 5000 });
    R.cambiosSinGuardar = { dialogoAlCancelar: conCancelar, dialogoConAtras: conAtras, rutaTrasAtras, rutaFinal: await page.evaluate(() => location.hash) };
  });

  await paso('platoSinPrecio', async () => {
    await page.goto(BASE + '/admin/#/plato/nuevo', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form.ficha');
    await page.locator('.campo-idiomas input[lang=es]').first().fill('Plato de prueba');
    const antes = esc.guardados.length;
    await page.locator('.acciones-fijas .btn-p').click();
    await page.waitForTimeout(600);
    R.sinPrecio = { seGuardo: esc.guardados.length > antes,
      error: await page.evaluate(() => [...document.querySelectorAll('.error-campo')].map((e) => e.textContent)),
      foco: await page.evaluate(() => document.activeElement.className) };
    await page.locator('.precio-in').first().fill('2,99');
    await page.locator('.acciones-fijas .btn-p').click();
    await page.waitForFunction(() => /Plato creado/.test((document.querySelector('#avisos .aviso-txt') || {}).textContent || ''), null, { timeout: 8000 });
    const d = esc.guardados[esc.guardados.length - 1];
    R.sinPrecio.con299 = { precios: d.precios, slug: d.slug };
  });

  await paso('revision', async () => {
    await page.goto(BASE + '/admin/#/alergenos', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.revision', { timeout: 20000 });
    const antes = await page.evaluate(() => ({ progreso: document.querySelector('.progreso-txt').textContent, plato: document.querySelector('.rev-nombre').textContent }));
    await captura('05-revision');
    await page.locator('.alg-fila').first().locator('.seg-si').click();
    esc.escrituras.length = 0;
    await page.getByRole('button', { name: 'Guardar y siguiente' }).click();
    await page.waitForFunction((n) => document.querySelector('.rev-nombre') && document.querySelector('.rev-nombre').textContent !== n, antes.plato, { timeout: 8000 });
    const despues = await page.evaluate(() => ({ progreso: document.querySelector('.progreso-txt').textContent, plato: document.querySelector('.rev-nombre').textContent }));
    R.revision = { antes, despues, escrituras: esc.escrituras.slice(), enviado: esc.revisiones[esc.revisiones.length - 1] };
  });

  await paso('publicar', async () => {
    esc.pendiente = true;
    await page.goto(BASE + '/admin/#/platos', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#franja').hidden, null, { timeout: 15000 });
    R.publicar = await page.evaluate(() => ({ franja: document.querySelector('#franja').textContent, badge: document.querySelector('[data-badge]').textContent }));
    await page.goto(BASE + '/admin/#/publicar', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tarjeta-pendiente', { timeout: 15000 });
    R.publicar.tarjeta = await page.evaluate(() => ({ titulo: document.querySelector('.tarjeta-tit').textContent, cambios: [...document.querySelectorAll('.pub-cambios li')].map((l) => l.textContent) }));
    await captura('06-publicar');
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForSelector('.tarjeta-curso', { timeout: 10000 });
    R.publicar.enCurso = await page.evaluate(() => document.querySelector('.tarjeta-tit').textContent);
    esc.publicada = CARTA_CAMBIADA;
    await page.waitForSelector('.tarjeta-bien', { timeout: 40000 });
    R.publicar.alLlegar = await page.evaluate(() => document.querySelector('.tarjeta-tit').textContent);
    R.publicar.llamadasAPublicar = esc.publicaciones;
    esc.pendiente = false;
    esc.publicada = null;
  });

  await paso('hoja', async () => {
    await page.goto(BASE + '/admin/#/ajustes/categorias', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fila .fila-abre', { timeout: 15000 });
    await page.locator('.fila .fila-abre').first().click();
    await page.waitForSelector('dialog.hoja[open]');
    R.hoja = await page.evaluate(() => {
      const d = document.querySelector('dialog.hoja[open]');
      return { titulo: d.querySelector('h2').textContent, focoDentro: d.contains(document.activeElement),
        tieneActiva: /Sale en la carta/.test(d.textContent), tieneDescripcion: /Descripción/.test(d.textContent),
        marcadores: [...d.querySelectorAll('.icono-op')].map((l) => l.textContent) };
    });
    await captura('07-hoja');
    await page.locator('dialog.hoja[open] .campo-idiomas input[lang=es]').fill('Ramen CAMBIADO');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    R.hoja.dialogosTrasEscape = await dialogosAbiertos();
    await page.getByRole('button', { name: 'Seguir editando' }).click();
    await page.waitForTimeout(200);
    /* En el movil la hoja ocupa la pantalla entera: no hay fondo que tocar, asi
       que se cierra con la X, que tiene que preguntar igual. */
    await page.locator('dialog.hoja[open] .hoja-cab .btn-icono').click();
    await page.waitForTimeout(300);
    R.hoja.dialogosTrasCerrarConX = await dialogosAbiertos();
    await page.getByRole('button', { name: 'Cerrar sin guardar' }).click();
    await page.waitForTimeout(300);
    R.hoja.dialogosAlFinal = await dialogosAbiertos();
  });

  await paso('opciones', async () => {
    await page.goto(BASE + '/admin/#/ajustes/opciones', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fila .fila-abre', { timeout: 15000 });
    await page.locator('.fila .fila-abre').first().click();
    await page.waitForSelector('dialog.hoja[open] .opcion-fila');
    const filas = await page.locator('dialog.hoja[open] .opcion-fila').count();
    const antes = esc.grupos.length;
    await page.locator('dialog.hoja[open] .hoja-pie .btn-p').click();
    await page.waitForFunction(() => !document.querySelector('dialog.hoja[open]'), null, { timeout: 8000 });
    const g = esc.grupos[esc.grupos.length - 1];
    const original = CARTA.grupos.find((x) => x.slug === g.slug);
    R.opciones = {
      grupo: g.slug, filasEnPantalla: filas, enviadas: g.opciones.length, llamadas: esc.grupos.length - antes,
      traduccionesIntactas: g.opciones.every((o, i) => JSON.stringify(o.nombre) === JSON.stringify(Object.fromEntries(Object.entries(original.opciones[i].nombre).filter(([, v]) => v)))),
      incrementosIntactos: g.opciones.every((o, i) => o.incremento === original.opciones[i].incremento)
    };
  });

  await paso('niveles', async () => {
    await page.goto(BASE + '/admin/#/ajustes/niveles', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fila .fila-abre', { timeout: 15000 });
    await page.locator('.fila .fila-abre').first().click();
    await page.waitForSelector('dialog.hoja[open]');
    const max = page.locator('dialog.hoja[open] input.corto').first();
    await max.fill('1');
    await page.locator('dialog.hoja[open] .hoja-pie .btn-p').click();
    await page.waitForTimeout(400);
    R.niveles = { errorAlAcortar: await page.evaluate(() => [...document.querySelectorAll('dialog.hoja[open] .error-campo')].map((e) => e.textContent)) };
    await page.locator('dialog.hoja[open] .hoja-cab .btn-icono').click();
    await page.getByRole('button', { name: 'Cerrar sin guardar' }).click();
  });

  await paso('historial', async () => {
    await page.goto(BASE + '/admin/#/historial', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.filas .fila', { timeout: 15000 });
    R.historial = await page.evaluate(() => ({ filas: [...document.querySelectorAll('.filas .fila')].map((f) => f.textContent.replace(/\s+/g, ' ').trim()) }));
    await page.getByRole('button', { name: 'Volver a esta' }).first().click();
    await page.waitForSelector('dialog.dialogo[open]');
    R.historial.pregunta = await page.evaluate(() => document.querySelector('dialog.dialogo[open] h2').textContent);
    R.historial.focoEnLaSalidaSegura = await page.evaluate(() => document.activeElement.textContent);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    R.historial.publicacionesLanzadas = esc.publicaciones;
  });

  await paso('estrecho', async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(BASE + '/admin/#/platos', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fila');
    R.estrecho360 = await page.evaluate(() => ({
      destinos: [...document.querySelectorAll('.nav-i')].map((a) => { const r = a.getBoundingClientRect(); return a.textContent.trim() + (r.right <= innerWidth && r.bottom <= innerHeight ? '' : ' FUERA'); }),
      desbordeLateral: document.documentElement.scrollWidth > innerWidth
    }));
  });

  R.erroresConsola = [...new Set(errores)];
  R.bloqueadas = [...new Set(esc.bloqueadas)].slice(0, 8);
  await ctx.close();
  return R;
};
