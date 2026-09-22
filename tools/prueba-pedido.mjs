/* =============================================================================
   Prueba del asistente de pedido de /menu/
   Se ejecuta con la skill browser-automation (patchright), no con node a secas:

     python -m http.server 8080          (desde la raiz del repositorio)
     node ~/.claude/skills/browser-automation/browser.mjs about:blank --timeout 3000 \
       --script tools/prueba-pedido.mjs

   Variables de entorno:
     PEDIDO_BASE      http://localhost:8080 (por defecto) o https://ramenokaeri.com
     PEDIDO_CAPTURAS  carpeta donde dejar capturas; sin ella no se hace ninguna

   QUE GARANTIZA QUE NO TOCA NADA
     El asistente no habla con ningun servidor: todo vive en el localStorage de
     este navegador de usar y tirar. Los casos raros se fabrican aqui, cambiando
     la isla de datos de la respuesta o lo guardado, nunca en el sitio. Se puede
     pasar contra produccion sin riesgo.

   QUE MIDE
     Privacidad antes de usarlo, la linea de ayuda de la cabecera, geometria
     de los globos y de su cara, añadir, configurar,
     fusion de lineas, obligatorios, precios a consultar, lineas caducadas,
     persistencia, vaciar y deshacer, dialogos y foco, arrastre, la pantalla del
     camarero, maqueta en cinco anchos, sin JavaScript y consola. Cada
     comprobacion devuelve el dato medido, no un si/no, y los casos se fabrican
     antes de medirlos: un cero sin su control no prueba nada.
   ============================================================================= */
const BASE = (process.env.PEDIDO_BASE || 'http://localhost:8080').replace(/\/$/, '');
const CAPTURAS = process.env.PEDIDO_CAPTURAS || '';
const HOST = new URL(BASE).host;
const CLAVE = 'okaeri.pedido';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run(page) {
  const R = {};
  const errores = [];
  const externas = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('request', (q) => {
    const u = new URL(q.url());
    if (!/^(http|https):$/.test(u.protocol)) return;
    if (u.host !== HOST) externas.push(q.url());
  });
  /* Wake Lock simulado: se cuenta cuantas veces se pide y se suelta.
     patchright ejecuta evaluate (y addInitScript) en un mundo aislado: el DOM y
     el localStorage se comparten, pero navigator y window no, asi que un
     simulacro puesto desde ahi no lo ve la pagina (medido: salia a 0). Se
     inyecta como <script>, que corre en el mundo de la pagina, y los
     contadores van en atributos del <html>, que se leen desde los dos. El
     asistente lo pide al abrir la comanda, no al cargar. */
  const simulaCandado = () => page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = [
      '(function () {',
      '  var h = document.documentElement;',
      "  h.dataset.candados = '0';",
      "  h.dataset.sueltos = '0';",
      "  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: function () {",
      '    h.dataset.candados = String(+h.dataset.candados + 1);',
      '    return Promise.resolve({ release: function () { h.dataset.sueltos = String(+h.dataset.sueltos + 1); return Promise.resolve(); } });',
      '  } } });',
      '})();'
    ].join('\n');
    document.head.appendChild(s);
    s.remove();
  });

  const captura = async (nombre) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` }); };
  const ir = async (ruta, ancho = 390, alto = 844) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await page.goto(BASE + ruta, { waitUntil: 'load' });
  };
  const abierta = (clase) => page.evaluate((c) => !!document.querySelector('dialog.' + c + '[open]'), clase);
  /* Espera a que la hoja este quieta: abierta, con la caja en su sitio y sin
     ninguna animacion en marcha. Medir en la cola de la entrada daba areas de
     43,99 px por la escala que aun no habia llegado a 1. */
  const quieta = (clase) => page.waitForFunction((c) => {
    const d = document.querySelector('dialog.' + c + '[open]');
    if (!d) return false;
    const caja = d.querySelector('.ped-caja');
    const m = new DOMMatrix(getComputedStyle(caja).transform);
    const enMarcha = caja.getAnimations().some((a) => a.playState === 'running');
    return !enMarcha && Math.abs(m.m42) < 0.5 && Math.abs(m.a - 1) < 1e-6 && parseFloat(getComputedStyle(caja).opacity) > 0.999;
  }, clase, { timeout: 5000 });
  const cerrada = (clase) => page.waitForFunction((c) => !document.querySelector('dialog.' + c + '[open]'), clase, { timeout: 5000 });
  const guardado = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), CLAVE);
  const limpia = () => page.evaluate(() => localStorage.clear());
  const globo = (slug) => page.locator(`.cplato[data-plato="${slug}"] .ped-globo`);

  /* --- 1. privacidad antes de usarlo ------------------------------------- */
  R.privacidad = {};
  for (const ruta of ['/menu/', '/en/menu/', '/gl/menu/']) {
    await ir(ruta);
    await limpia();
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.ped-globo');
    R.privacidad[ruta] = {
      claves: await page.evaluate(() => localStorage.length),
      sesion: await page.evaluate(() => sessionStorage.length),
      cookies: (await page.context().cookies()).length,
      globos: await page.locator('.ped-globo').count(),
      ayuda: await page.evaluate(() => {
        const p = document.querySelector('.carta-cab .ped-ayuda');
        if (!p) return null;
        const b = p.getBoundingClientRect();
        return { texto: p.textContent, globos: p.querySelectorAll('.ped-ayuda-c svg').length,
          dentro: b.left >= 0 && b.right <= innerWidth, lineas: Math.round(b.height / parseFloat(getComputedStyle(p).lineHeight)) };
      }),
      filas: await page.locator('.cplato').count()
    };
  }
  R.sinPedidoJs = {};
  for (const ruta of ['/', '/en/', '/gl/', '/aviso-legal/']) {
    const html = await (await page.request.get(BASE + ruta)).text();
    R.sinPedidoJs[ruta] = (html.match(/pedido\.js/g) || []).length;
  }

  /* --- 2. sin JavaScript: el HTML crudo ---------------------------------- */
  const crudo = await (await page.request.get(BASE + '/menu/')).text();
  R.sinJs = {
    filas: (crudo.match(/<li class="cplato"/g) || []).length,
    globosEnHtml: (crudo.match(/ped-globo/g) || []).length,
    ayudaEnHtml: (crudo.match(/ped-ayuda/g) || []).length,
    isla: /<script type="application\/json" id="pedido-datos">/.test(crudo)
  };

  /* --- 3. geometria de los globos, en los dos puntos de ruptura ---------- */
  R.globos = {};
  for (const ancho of [390, 1280]) {
    await ir('/menu/', ancho, 900);
    await page.waitForSelector('.ped-globo');
    R.globos[ancho] = await page.evaluate(async () => {
      const fuera = { total: 0, menos44: 0, roba: 0, noSuyo: 0, desvio: 0, caraMin: Infinity, holguraMin: Infinity };
      const lis = Array.from(document.querySelectorAll('.cplato'));
      for (const li of lis) {
        const b = li.querySelector('.ped-globo');
        const ico = li.querySelector('.plato-ico');
        /* instant: el html lleva scroll-behavior:smooth, y con el scroll a
           medias la fila aun no esta en pantalla cuando se mide */
        li.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(r));
        const rb = b.getBoundingClientRect();
        const ri = ico.getBoundingClientRect();
        fuera.total++;
        if (rb.width < 44 || rb.height < 44) fuera.menos44++;
        /* el centro del globo tiene que ser el globo (la leccion de la X) */
        const e1 = document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2);
        if (!e1 || !b.contains(e1)) fuera.noSuyo++;
        /* y el centro del icono tiene que seguir siendo la fila */
        const e2 = document.elementFromPoint(ri.left + ri.width / 2, ri.top + ri.height / 2);
        if (!e2 || b.contains(e2)) fuera.roba++;
        /* el centro del globo, 6 px por dentro de la esquina del icono */
        const dx = Math.abs(rb.left + rb.width / 2 - (ri.right - 6));
        const dy = Math.abs(rb.top + rb.height / 2 - (ri.bottom - 6));
        fuera.desvio = Math.max(fuera.desvio, Math.round(Math.max(dx, dy) * 10) / 10);
        /* la cara, y lo que queda entre ella (con su aro de 3) y el texto */
        const rc = li.querySelector('.ped-globo-c').getBoundingClientRect();
        fuera.caraMin = Math.min(fuera.caraMin, rc.width, rc.height);
        const texto = Array.from(li.querySelectorAll('.plato-n, .plato-desc, .plato-chips')).map((n) => n.getBoundingClientRect().left);
        fuera.holguraMin = Math.min(fuera.holguraMin, Math.round((Math.min(...texto) - (rc.right + 3)) * 10) / 10);
      }
      return fuera;
    });
  }

  /* --- 4. añadir un plato simple ----------------------------------------- */
  await ir('/menu/');
  await limpia();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  const simple = await page.evaluate(() => {
    const D = JSON.parse(document.getElementById('pedido-datos').textContent);
    return D.platos.find((p) => p.precios.length === 1 && !p.grupos.length).slug;
  });
  await globo(simple).scrollIntoViewIfNeeded();
  await globo(simple).click();
  await espera(400);
  const g1 = await guardado();
  R.anadirSimple = {
    plato: simple,
    lineas: g1 ? g1.lineas.length : 0,
    cantidad: g1 ? g1.lineas[0].cantidad : 0,
    globo: (await globo(simple).innerText()).trim(),
    etiqueta: await globo(simple).getAttribute('aria-label'),
    pastilla: await page.evaluate(() => document.querySelector('.ped-pastilla').classList.contains('visible')),
    anuncio: await page.evaluate(() => Array.from(document.querySelectorAll('p.oculto[role=status]')).map((p) => p.textContent).filter(Boolean).join(' | '))
  };
  await captura('1-simple');

  /* --- 5. configurar, fundir y abrir linea nueva -------------------------- */
  await limpia();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  const configura = async (caldo, extras, veces) => {
    await globo('tonkotsu-ramen').scrollIntoViewIfNeeded();
    await globo('tonkotsu-ramen').click();
    await quieta('ped-hoja-config');
    await page.locator('.ped-hoja-config label.ped-seg-op', { hasText: caldo }).click();
    for (const x of extras) await page.locator('.ped-hoja-config label.ped-extra', { hasText: x }).click();
    for (let i = 1; i < veces; i++) await page.locator('.ped-hoja-config .ped-cant-b[aria-label]').nth(1).click();
    const boton = (await page.locator('.ped-anadir').innerText()).trim();
    await page.locator('.ped-anadir').click();
    await cerrada('ped-hoja-config');
    return boton;
  };
  const b1 = await configura('Alto', ['Extra huevo', 'Extra gambas'], 2);
  const tras1 = await guardado();
  const b2 = await configura('Alto', ['Extra huevo', 'Extra gambas'], 2);
  const tras2 = await guardado();
  const b3 = await configura('Medio', [], 1);
  const tras3 = await guardado();
  R.configurar = {
    boton: b1,
    tras1: tras1.lineas.map((l) => ({ c: l.cantidad, o: l.opciones })),
    fundida: { boton: b2, lineas: tras2.lineas.length, cantidad: tras2.lineas[0].cantidad },
    distinta: { boton: b3, lineas: tras3.lineas.length },
    pastilla: (await page.locator('.ped-pastilla').getAttribute('aria-label')),
    /* 4 x 16,95 + 12,95 = 80,75 */
    esperado: '80,75 €'
  };
  await captura('2-configurado');

  /* --- 6. casos fabricados ------------------------------------------------ */
  /* 6a. un grupo obligatorio: se cambia en la isla de la respuesta */
  await page.route(BASE + '/menu/', async (route) => {
    const resp = await route.fetch();
    let html = await resp.text();
    html = html.replace('"sabor-ramen":{"tipo":"unica","obligatorio":false', '"sabor-ramen":{"tipo":"unica","obligatorio":true');
    await route.fulfill({ response: resp, body: html });
  });
  await limpia();
  await page.goto(BASE + '/menu/', { waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  const obligatorioEnIsla = await page.evaluate(() => JSON.parse(document.getElementById('pedido-datos').textContent).grupos['sabor-ramen'].obligatorio);
  await globo('tonkotsu-ramen').click();
  await quieta('ped-hoja-config');
  await page.locator('.ped-anadir').click();
  await espera(500);
  const falta = await page.evaluate(() => {
    const f = document.querySelector('.ped-hoja-config fieldset[data-falta]');
    return {
      grupo: f ? f.querySelector('legend span').textContent : null,
      aviso: f ? !f.querySelector('.ped-falta').hidden : false,
      foco: f ? f.contains(document.activeElement) : false,
      describe: f ? f.getAttribute('aria-describedby') === f.querySelector('.ped-falta').id : false
    };
  });
  const sigueAbierta = await abierta('ped-hoja-config');
  const nadaGuardado = await guardado();
  await page.locator('.ped-hoja-config label.ped-seg-op', { hasText: 'Normal' }).click();
  const avisoQuitado = await page.evaluate(() => !document.querySelector('.ped-hoja-config fieldset[data-falta]'));
  await page.locator('.ped-anadir').click();
  await cerrada('ped-hoja-config');
  R.obligatorio = {
    enIsla: obligatorioEnIsla, bloquea: sigueAbierta, falta, guardadoAntes: nadaGuardado,
    avisoQuitadoAlElegir: avisoQuitado, lineasDespues: ((await guardado()) || { lineas: [] }).lineas.length
  };
  await page.unroute(BASE + '/menu/');

  /* 6b. un extra sin precio */
  await limpia();
  await page.goto(BASE + '/menu/', { waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  await configura('Bajo', ['Extra cerdo chashu'], 1);
  await page.locator('.ped-pastilla').click();
  await quieta('ped-hoja-lista');
  R.consultar = await page.evaluate(() => ({
    total: document.querySelector('.ped-hoja-lista .ped-total b').textContent,
    nota: (document.querySelector('.ped-hoja-lista .ped-total-nota') || {}).textContent || null,
    resumen: document.querySelector('.ped-hoja-lista .ped-linea-r').textContent
  }));
  await page.keyboard.press('Escape');
  await cerrada('ped-hoja-lista');

  /* 6c. lineas caducadas y una variante reordenada */
  const antiguo = {
    v: 1, id: 'prueba', creado: '2026-01-01T12:00:00Z', actualizado: '2026-01-01T12:00:00Z', mesa: null, estado: 'borrador',
    lineas: [
      { id: 'a', plato: 'plato-que-no-existe', nombre: 'Plato borrado', variante: null, varianteEt: null, opciones: {}, cantidad: 1, nota: '' },
      { id: 'b', plato: 'cerveza-tirada', nombre: 'Cerveza de barril', variante: 0, varianteEt: 'Jarra', opciones: {}, cantidad: 1, nota: '' },
      { id: 'c', plato: 'cerveza-tirada', nombre: 'Cerveza de barril', variante: 0, varianteEt: 'Pinta', opciones: {}, cantidad: 2, nota: '' },
      { id: 'd', plato: 'tonkotsu-ramen', nombre: 'Tonkotsu Ramen', variante: null, varianteEt: null, opciones: { 'extras-ramen': ['no-existe'] }, cantidad: 1, nota: '' }
    ]
  };
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [CLAVE, antiguo]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  await page.locator('.ped-pastilla').click();
  await quieta('ped-hoja-lista');
  R.caducadas = await page.evaluate(() => ({
    rotas: document.querySelectorAll('.ped-hoja-lista .ped-linea-rota').length,
    validas: document.querySelectorAll('.ped-hoja-lista .ped-linea:not(.ped-linea-rota)').length,
    /* la «c» guardaba el indice 0 con la etiqueta Pinta: tiene que casar por
       etiqueta con la Pinta, 2 x 3,50 */
    total: document.querySelector('.ped-hoja-lista .ped-total b').textContent,
    resumenValida: (document.querySelector('.ped-hoja-lista .ped-linea:not(.ped-linea-rota) .ped-linea-r') || {}).textContent,
    vieja: (document.querySelector('.ped-hoja-lista .ped-vieja p') || {}).textContent || null,
    pastilla: document.querySelector('.ped-pastilla-e').textContent
  }));
  await captura('3-caducadas');
  await page.keyboard.press('Escape');
  await cerrada('ped-hoja-lista');

  /* --- 7. persistencia, vaciar y deshacer --------------------------------- */
  await limpia();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  await globo(simple).click();
  await configura('Alto', ['Extra huevo'], 1);
  const antesRecarga = (await guardado()).lineas.length;
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  const trasRecarga = (await guardado()).lineas.length;
  const globosTras = await page.evaluate(() => Array.from(document.querySelectorAll('.ped-globo.lleno')).length);
  await page.locator('.ped-pastilla').click();
  await quieta('ped-hoja-lista');
  await page.locator('.ped-hoja-lista [data-accion="vaciar"]').click();
  await espera(300);
  const vaciada = {
    claves: await page.evaluate(() => localStorage.length),
    vacia: await page.evaluate(() => (document.querySelector('.ped-hoja-lista .ped-vacia') || {}).textContent || null),
    aviso: await page.evaluate(() => { const a = document.querySelector('.ped-aviso'); return { visible: a.classList.contains('visible'), enHoja: !!a.closest('dialog'), texto: a.querySelector('.ped-aviso-t').textContent }; })
  };
  await page.locator('.ped-aviso-b').click();
  await espera(300);
  const deshecho = (await guardado() || { lineas: [] }).lineas.length;
  R.persistencia = { antesRecarga, trasRecarga, globosTras, vaciada, deshecho };
  await page.keyboard.press('Escape');
  await cerrada('ped-hoja-lista');

  /* --- 8. dialogos: foco, tabulador, Escape y fondo ----------------------- */
  await page.locator('.ped-pastilla').focus();
  await page.keyboard.press('Enter');
  await quieta('ped-hoja-lista');
  const focoAlAbrir = await page.evaluate(() => document.activeElement.className);
  /* Con un dialogo modal el foco puede salir a la barra del navegador, y
     entonces activeElement es el body: eso no es una fuga. Una fuga es un
     elemento de la pagina fuera del dialogo. */
  let fugas = 0;
  let aLaBarra = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const donde = await page.evaluate(() => document.activeElement === document.body ? 'barra'
      : document.activeElement.closest('dialog.ped-hoja-lista') ? 'dentro' : 'fuera');
    if (donde === 'fuera') fugas++;
    if (donde === 'barra') aLaBarra++;
  }
  const fondo = await page.evaluate(() => {
    const a = document.querySelector('main a, main button');
    a.focus();
    return document.activeElement === a;
  });
  await page.keyboard.press('Escape');
  await cerrada('ped-hoja-lista');
  R.dialogos = {
    focoAlAbrir, fugasEn25Tabs: fugas, vecesALaBarraDelNavegador: aLaBarra, fondoEnfocable: fondo,
    focoAlCerrar: await page.evaluate(() => document.activeElement.className),
    scrollBloqueadoTrasCerrar: await page.evaluate(() => document.body.style.position)
  };

  /* --- 9. el arrastre ------------------------------------------------------ */
  const cab = async () => {
    const b = await page.locator('dialog.ped-hoja-lista[open] .ped-cab').boundingBox();
    return { x: b.x + b.width / 3, y: b.y + b.height / 2 };
  };
  await page.locator('.ped-pastilla').click();
  await quieta('ped-hoja-lista');
  let p = await cab();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(p.x, p.y + i * 50); await espera(8); }
  await page.mouse.up();
  await espera(900);
  const cierraConGolpe = !(await abierta('ped-hoja-lista'));

  await page.locator('.ped-pastilla').click();
  await quieta('ped-hoja-lista');
  p = await cab();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(p.x, p.y + i * 6); await espera(30); }
  const enMedio = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('dialog.ped-hoja-lista .ped-caja')).transform).m42);
  await espera(150);
  await page.mouse.up();
  await espera(900);
  const vuelve = await page.evaluate(() => ({
    abierta: !!document.querySelector('dialog.ped-hoja-lista[open]'),
    y: new DOMMatrix(getComputedStyle(document.querySelector('dialog.ped-hoja-lista .ped-caja')).transform).m42
  }));
  /* hacia arriba, goma: 200 px de dedo no pueden ser 200 px de hoja */
  p = await cab();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x, p.y - i * 20); await espera(16); }
  const goma = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('dialog.ped-hoja-lista .ped-caja')).transform).m42);
  await page.mouse.up();
  await espera(900);
  R.arrastre = {
    cierraConGolpe,
    arrastreCorto: { sigueAlDedo: Math.round(enMedio), abierta: vuelve.abierta, yFinal: Math.round(vuelve.y * 10) / 10 },
    gomaConDedo200: Math.round(goma)
  };
  await page.keyboard.press('Escape');
  await cerrada('ped-hoja-lista');

  /* --- 9b. arrastre tactil desde el contenido ----------------------------- */
  /* Toques de verdad por CDP (solo Chromium). Con el contenido arriba del todo,
     bajar el dedo cierra la hoja; con el contenido desplazado, el mismo gesto
     tiene que ser scroll y la hoja no se mueve. */
  R.tactil = null;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const gesto = async (x, y0, y1, pasos, ms) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= pasos; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / pasos }] });
        await espera(ms);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await globo('tonkotsu-ramen').scrollIntoViewIfNeeded();
    await globo('tonkotsu-ramen').click();
    await quieta('ped-hoja-config');
    const zona = await page.locator('dialog.ped-hoja-config .ped-campos').boundingBox();
    /* desplazado: primero se baja el contenido, y luego el gesto hacia abajo */
    await page.evaluate(() => { document.querySelector('dialog.ped-hoja-config .ped-rollo').scrollTop = 200; });
    const antes = await page.evaluate(() => document.querySelector('dialog.ped-hoja-config .ped-rollo').scrollTop);
    await gesto(zona.x + 40, zona.y + 40, zona.y + 200, 8, 16);
    await espera(700);
    const desplazado = await page.evaluate(() => ({
      abierta: !!document.querySelector('dialog.ped-hoja-config[open]'),
      scrollTop: Math.round(document.querySelector('dialog.ped-hoja-config .ped-rollo').scrollTop),
      y: Math.round(new DOMMatrix(getComputedStyle(document.querySelector('dialog.ped-hoja-config .ped-caja')).transform).m42)
    }));
    /* arriba del todo: el mismo gesto cierra */
    await page.evaluate(() => { document.querySelector('dialog.ped-hoja-config .ped-rollo').scrollTop = 0; });
    await espera(100);
    await gesto(zona.x + 40, zona.y + 40, zona.y + 340, 8, 12);
    await espera(900);
    const arriba = !(await abierta('ped-hoja-config'));
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    R.tactil = { desplazado: { scrollAntes: antes, ...desplazado }, arribaCierra: arriba };
  } catch (e) {
    R.tactil = { error: String(e).slice(0, 200) };
  }
  if (await abierta('ped-hoja-config')) { await page.keyboard.press('Escape'); await cerrada('ped-hoja-config'); }

  /* --- 10. la pantalla del camarero, en ingles ---------------------------- */
  await ir('/en/menu/');
  await limpia();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ped-globo');
  await globo('tonkotsu-ramen').click();
  await quieta('ped-hoja-config');
  await page.locator('.ped-hoja-config label.ped-seg-op', { hasText: 'High' }).click();
  await page.locator('.ped-nota-abre').click();
  await page.locator('.ped-nota-t').fill('Sin cebolleta');
  await page.locator('.ped-anadir').click();
  await cerrada('ped-hoja-config');
  await page.locator('.ped-pastilla').click();
  await quieta('ped-hoja-lista');
  await simulaCandado();
  await page.locator('.ped-hoja-lista [data-accion="camarero"]').click();
  await quieta('ped-hoja-comanda');
  R.camarero = await page.evaluate(() => {
    const d = document.querySelector('dialog.ped-hoja-comanda');
    const li = d.querySelector('.ped-com-lista li');
    return {
      titulo: d.querySelector('h2').textContent,
      lang: d.querySelector('.ped-com-sec').getAttribute('lang'),
      seccion: d.querySelector('.ped-com-h').textContent,
      nombre: li.querySelector('.ped-com-n').textContent,
      opciones: li.querySelector('.ped-com-o').textContent,
      nota: li.querySelector('.ped-com-nota').textContent,
      otro: li.querySelector('.ped-com-otro') ? [li.querySelector('.ped-com-otro').getAttribute('lang'), li.querySelector('.ped-com-otro').textContent] : null,
      importe: li.querySelector('.ped-com-imp').textContent,
      total: d.querySelector('.ped-com-total b').textContent,
      alergias: d.querySelector('.ped-com-alergias').textContent,
      candados: +document.documentElement.dataset.candados
    };
  });
  await captura('4-comanda-en');
  await page.locator('dialog.ped-hoja-comanda .ped-pie .btn').click();
  await page.waitForFunction(() => !document.querySelector('dialog.ped-hoja[open]'), null, { timeout: 5000 });
  await espera(300);
  R.camarero.hecho = await page.evaluate((k) => ({
    abiertas: document.querySelectorAll('dialog.ped-hoja[open]').length,
    clave: localStorage.getItem(k),
    candadoSuelto: +document.documentElement.dataset.sueltos,
    aviso: document.querySelector('.ped-aviso').classList.contains('visible') ? document.querySelector('.ped-aviso-t').textContent : null,
    scroll: document.body.style.position
  }), CLAVE);

  /* --- 11. maqueta en cinco anchos ---------------------------------------- */
  R.maqueta = {};
  for (const ancho of [360, 390, 430, 768, 1440]) {
    await ir('/menu/', ancho, ancho < 900 ? 800 : 900);
    await page.waitForSelector('.ped-globo');
    await limpia();
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.ped-globo');
    await globo(simple).click();
    await espera(500);
    const pagina = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return new Promise((r) => setTimeout(() => {
        const pie = Array.from(document.querySelectorAll('.pie-bajo a'));
        const tapado = pie.filter((a) => { const b = a.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e && !a.contains(e); }).length;
        r({ desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, pieTapado: tapado });
      }, 400));
    });
    const hojas = {};
    for (const [clase, abre] of [['ped-hoja-config', async () => { await globo('tonkotsu-ramen').scrollIntoViewIfNeeded(); await globo('tonkotsu-ramen').click(); }],
      ['ped-hoja-lista', async () => page.locator('.ped-pastilla').click()]]) {
      await abre();
      await quieta(clase);
      hojas[clase] = await page.evaluate((c) => {
        const d = document.querySelector('dialog.' + c + '[open]');
        const caja = d.querySelector('.ped-caja').getBoundingClientRect();
        const cortos = Array.from(d.querySelectorAll('button, label.ped-seg-op, label.ped-op, label.ped-extra'))
          .filter((n) => n.offsetParent !== null && !n.closest('.ped-caja [hidden]'))
          .map((n) => ({ n, b: n.getBoundingClientRect() }))
          .filter((x) => x.b.width > 0 && (x.b.width < 44 || x.b.height < 44))
          .map((x) => x.n.className + ' ' + Math.round(x.b.width) + 'x' + Math.round(x.b.height));
        return { dentro: caja.left >= -0.5 && caja.right <= innerWidth + 0.5, ancho: Math.round(caja.width), cortos };
      }, clase);
      await page.keyboard.press('Escape');
      await cerrada(clase);
    }
    const globosCortos = await page.evaluate(() => Array.from(document.querySelectorAll('.ped-globo')).filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
    R.maqueta[ancho] = { ...pagina, globosCortos, hojas, modo: await page.evaluate(() => document.querySelector('dialog.ped-hoja-lista').getAttribute('data-modo')) };
  }

  /* --- 12. movimiento reducido -------------------------------------------- */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ir('/menu/');
  await page.waitForSelector('.ped-globo');
  await page.locator('.ped-pastilla').click();
  await page.waitForTimeout(60);
  const rm = await page.evaluate(() => ({
    abierta: !!document.querySelector('dialog.ped-hoja-lista[open]'),
    transform: document.querySelector('dialog.ped-hoja-lista .ped-caja').style.transform || 'ninguno'
  }));
  await page.keyboard.press('Escape');
  await cerrada('ped-hoja-lista');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  R.movimientoReducido = rm;

  await limpia();
  R.consola = errores;
  R.externas = externas;
  return R;
}
