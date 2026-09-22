/* =============================================================================
   Ramen Okaeri — el asistente de pedido de la carta (/menu/)

   QUÉ HACE (v1)
     El cliente va apuntando platos desde la carta, con su formato, sus niveles
     y sus extras, en una lista que se queda en su móvil. Cuando llega el
     camarero se la enseña en una pantalla hecha para eso: en español, por
     secciones y con letra grande.

   LO QUE NO HACE TODAVÍA, Y CÓMO ESTÁ PREPARADO PARA HACERLO (v2)
     La v2 mandará el pedido de la mesa a cocina. Lo que ya está listo:
     - El pedido lleva id, fechas, `mesa` (saldrá del QR de cada mesa) y
       `estado` (borrador → enviado → en cocina → servido).
     - Cada línea apunta a claves estables: el slug del plato, que el panel
       genera una sola vez al crearlo; los slugs de las opciones; y el índice
       de la variante con su etiqueta en español de testigo.
     - LOS PRECIOS NO SE GUARDAN. Se calculan siempre con la carta de la
       página y en céntimos enteros. El servidor de la v2 tendrá que hacer lo
       mismo contra la base de datos y no fiarse nunca de un precio que llegue
       del navegador.
     - Todo lo que se guarda pasa por `Almacen`. El envío a cocina se enchufa
       ahí, detrás de un botón que sustituya o acompañe a «Enseñar al
       camarero», y la pantalla del camarero ya es el formato del ticket.
     Lo que le faltará a la v2: una clave estable para cada variante de precio
     (hoy carta_json() no emite ids, a propósito) y, el día que /menu/ hable
     con Supabase, revisar privacidad y banner, porque será la primera petición
     a un tercero de la web pública.

   PRIVACIDAD
     No se escribe nada hasta que el cliente añade el primer plato, y la clave
     se borra en cuanto la lista se queda vacía: quien no lo usa sigue con cero
     almacenamiento, que es una propiedad medida del sitio. Va en localStorage
     porque es un servicio que pide el propio cliente, la excepción del carrito
     de la compra, y por eso no necesita banner.

   Sin dependencias. Si el navegador no tiene <dialog>, no se pinta nada y la
   carta se queda como estaba.
   ============================================================================= */
(function () {
  'use strict';

  var isla = document.getElementById('pedido-datos');
  if (!isla || typeof HTMLDialogElement !== 'function' ||
      !('showModal' in HTMLDialogElement.prototype)) return;

  var D;
  try { D = JSON.parse(isla.textContent); } catch (e) { return; }

  var T = D.textos;
  var L = D.idioma;
  var quieto = window.matchMedia('(prefers-reduced-motion: reduce)');
  var ancho = window.matchMedia('(min-width: 900px)');
  var SAL = 'cubic-bezier(.23,1,.32,1)';
  var MAX = 99;
  var NOTA_MAX = 140;
  var VERSION = 1;

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var rell = function (s, v) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return k in v ? v[k] : m; });
  };

  /* Crea un elemento. Los hijos pueden ser nodos o cadenas, y las cadenas
     entran como texto y nunca como HTML: los nombres vienen del panel. */
  function el(tag, attrs, hijos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'texto') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (hijos || []).forEach(function (h) {
      if (h == null || h === false) return;
      n.appendChild(typeof h === 'string' ? document.createTextNode(h) : h);
    });
    return n;
  }

  /* Mismo trazo que los iconos del sitio. Son cadenas fijas de este archivo,
     no datos, así que aquí sí se puede usar innerHTML. */
  var TRAZOS = {
    mas: '<path d="M12 5.5v13M5.5 12h13"/>',
    menos: '<path d="M5.5 12h13"/>',
    papelera: '<path d="M4.5 7h15M9.5 7V5.2h5V7M6.6 7l.9 12a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12M10 11v5.5M14 11v5.5"/>',
    cierra: '<path d="M7 7l10 10M17 7 7 17"/>',
    sube: '<path d="M7 14l5-5 5 5"/>',
    marca: '<path d="M6 12.5l4 4 8-9"/>'
  };
  function ico(nombre) {
    var s = document.createElement('span');
    s.innerHTML = '<svg class="ped-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + TRAZOS[nombre] + '</svg>';
    return s.firstChild;
  }

  /* ------------------------------------------------------------------ */
  /* La carta de esta página                                             */
  /* ------------------------------------------------------------------ */
  var PLATOS = {};
  D.platos.forEach(function (p) { PLATOS[p.slug] = p; });
  var GRUPOS = D.grupos;
  var CATS = {};
  D.categorias.forEach(function (c, i) { CATS[c.slug] = { c: c, orden: i }; });

  /* Simple = un solo precio y ningún grupo: se añade de un toque. */
  var esSimple = function (p) { return p.precios.length === 1 && !p.grupos.length; };

  /* ------------------------------------------------------------------ */
  /* El modelo: funciones puras, sin DOM                                 */
  /* ------------------------------------------------------------------ */

  /* Opciones en forma canónica: claves ordenadas, slugs ordenados y sin
     grupos vacíos. Es lo que permite reconocer dos líneas iguales. */
  function limpiaOpciones(o) {
    var r = {};
    if (!o || typeof o !== 'object') return r;
    Object.keys(o).sort().forEach(function (g) {
      var v = Array.isArray(o[g]) ? o[g].filter(function (s) { return typeof s === 'string'; }).sort() : [];
      if (v.length) r[g] = v;
    });
    return r;
  }

  /* Dos líneas con la misma clave son el mismo plato pedido igual: al
     añadirla otra vez se suma cantidad en vez de abrir otra línea. */
  function claveDe(l) {
    return [l.plato, l.variante == null ? '' : l.variante,
      JSON.stringify(limpiaOpciones(l.opciones)), (l.nota || '').trim().toLowerCase()].join('|');
  }

  /* Casa una línea guardada con la carta de ESTA página. La lista puede venir
     de otro día, y entre medias el restaurante puede haber quitado un plato,
     una opción o una variante: entonces devuelve null y la línea sale como
     «ya no está en la carta», fuera del total. El precio sale de aquí y nunca
     de lo guardado. */
  function resuelve(l) {
    var p = PLATOS[l.plato];
    if (!p) return null;

    var vi = null;
    if (p.precios.length > 1) {
      if (typeof l.variante !== 'number') return null;
      vi = l.variante;
      /* El índice solo vale si la etiqueta sigue siendo la misma. Si el
         restaurante reordenó las variantes, se busca por la etiqueta. */
      if (!p.precios[vi] || p.precios[vi].etiquetaEs !== l.varianteEt) {
        vi = null;
        p.precios.forEach(function (x, i) { if (vi === null && x.etiquetaEs === l.varianteEt) vi = i; });
        if (vi === null) return null;
      }
    } else if (l.variante != null) {
      return null;
    }
    var precio = p.precios[vi === null ? 0 : vi];

    var opc = l.opciones || {};
    var ajenos = Object.keys(opc).some(function (g) { return p.grupos.indexOf(g) === -1 || !GRUPOS[g]; });
    if (ajenos) return null;

    var unidad = precio.centimos || 0;
    var consultar = precio.centimos == null;
    var elegidas = [];
    var faltan = [];
    var roto = false;
    p.grupos.forEach(function (g) {
      var G = GRUPOS[g];
      var suyas = opc[g] || [];
      if (G.tipo !== 'multiple' && suyas.length > 1) roto = true;
      var halladas = G.opciones.filter(function (o) { return suyas.indexOf(o.slug) !== -1; });
      if (halladas.length !== suyas.length) roto = true;
      if (!halladas.length && G.obligatorio) faltan.push(g);
      halladas.forEach(function (o) {
        elegidas.push({ grupo: G, op: o });
        if (o.centimos == null) consultar = true;
        else unidad += o.centimos;
      });
    });
    if (roto) return null;

    return { plato: p, variante: vi, precio: precio, elegidas: elegidas, faltan: faltan,
      unidad: unidad, consultar: consultar };
  }

  /* «Pinta · Intensidad del caldo: Alto · Extra huevo, Extra gambas». En un
     grupo de elección única se dice el grupo, porque «Alto» suelto no dice
     de qué; en uno de varias bastan las opciones. */
  function resumen(r, es) {
    var n = es ? 'nombreEs' : 'nombre';
    var partes = [];
    if (r.variante !== null) partes.push(r.precio[es ? 'etiquetaEs' : 'etiqueta']);
    var porGrupo = [];
    r.elegidas.forEach(function (e) {
      var ult = porGrupo[porGrupo.length - 1];
      if (ult && ult.g === e.grupo) ult.ops.push(e.op[n]);
      else porGrupo.push({ g: e.grupo, ops: [e.op[n]] });
    });
    porGrupo.forEach(function (x) {
      partes.push(x.g.tipo === 'multiple' ? x.ops.join(', ') : x.g[n] + ': ' + x.ops[0]);
    });
    return partes.join(' · ');
  }

  /* El decimal lleva coma en español y gallego y punto en inglés, y el
     símbolo va detrás o delante: lo mismo que precio() en tools/build.mjs,
     para que la lista y la carta escriban igual el mismo importe. */
  function euros(c, lengua) {
    var v = (c / 100).toFixed(2);
    return (lengua || L) === 'en' ? '€' + v : v.replace('.', ',') + ' €';
  }
  var platos = function (n) { return n === 1 ? T.platos_uno : rell(T.platos, { n: n }); };

  /* ------------------------------------------------------------------ */
  /* El almacén                                                          */
  /* ------------------------------------------------------------------ */
  /* Todo en try/catch: en una ventana privada, con el almacenamiento lleno o
     bloqueado, la lista sigue funcionando en memoria mientras dure la visita.
     La v2 pone aquí al lado el envío a cocina; nada más lee ni escribe. */
  var CLAVE = 'okaeri.pedido';
  var Almacen = {
    lee: function () {
      try { return sana(JSON.parse(window.localStorage.getItem(CLAVE))); } catch (e) { return null; }
    },
    escribe: function (p) {
      try { window.localStorage.setItem(CLAVE, JSON.stringify(p)); } catch (e) { /* sigue en memoria */ }
    },
    borra: function () {
      try { window.localStorage.removeItem(CLAVE); } catch (e) { /* nada que borrar */ }
    }
  };

  /* Lo guardado viene de fuera del código, así que se revisa campo a campo
     antes de usarlo. */
  function sana(p) {
    if (!p || p.v !== VERSION || !Array.isArray(p.lineas)) return null;
    p.lineas = p.lineas.filter(function (l) {
      return l && typeof l.plato === 'string' && typeof l.id === 'string';
    }).map(function (l) {
      var n = parseInt(l.cantidad, 10);
      return {
        id: l.id, plato: l.plato,
        nombre: typeof l.nombre === 'string' ? l.nombre : l.plato,
        variante: typeof l.variante === 'number' ? l.variante : null,
        varianteEt: typeof l.varianteEt === 'string' ? l.varianteEt : null,
        opciones: limpiaOpciones(l.opciones),
        cantidad: Math.min(MAX, Math.max(1, isNaN(n) ? 1 : n)),
        nota: typeof l.nota === 'string' ? l.nota.slice(0, NOTA_MAX) : ''
      };
    });
    return p;
  }

  function nuevoId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* Crear un pedido no escribe nada: solo guarda() lo hace, y solo si hay
     alguna línea. */
  function nuevo() {
    var t = new Date().toISOString();
    return { v: VERSION, id: nuevoId(), creado: t, actualizado: t, mesa: null, estado: 'borrador', lineas: [] };
  }

  var pedido = Almacen.lee() || nuevo();

  /* ------------------------------------------------------------------ */
  /* Operaciones sobre el pedido                                         */
  /* ------------------------------------------------------------------ */
  var indice = function (id) {
    for (var i = 0; i < pedido.lineas.length; i++) if (pedido.lineas[i].id === id) return i;
    return -1;
  };

  function guarda() {
    pedido.actualizado = new Date().toISOString();
    if (pedido.lineas.length) Almacen.escribe(pedido);
    else Almacen.borra();
    pinta();
  }

  /* Mete una línea donde toque. Si ya hay una igual, suma la cantidad. */
  function mete(l, pos) {
    var k = claveDe(l);
    var igual = pedido.lineas.filter(function (x) { return claveDe(x) === k; })[0];
    if (igual) {
      igual.cantidad = Math.min(MAX, igual.cantidad + l.cantidad);
      return;
    }
    if (!l.id) l.id = nuevoId();
    if (pos == null || pos > pedido.lineas.length) pedido.lineas.push(l);
    else pedido.lineas.splice(pos, 0, l);
  }

  function anade(l) {
    /* Una lista que se vació y vuelve a empezar es un pedido nuevo. */
    if (!pedido.lineas.length) pedido = nuevo();
    mete(l);
    guarda();
  }

  function reemplaza(id, l) {
    var i = indice(id);
    if (i === -1) return anade(l);
    pedido.lineas.splice(i, 1);
    l.id = id;
    mete(l, i);
    guarda();
  }

  function cambia(id, delta) {
    var i = indice(id);
    if (i === -1) return;
    var l = pedido.lineas[i];
    l.cantidad = Math.min(MAX, Math.max(1, l.cantidad + delta));
    guarda();
  }

  /* Ni quitar ni vaciar piden confirmación: se hace y se ofrece deshacer. */
  function quita(id) {
    var i = indice(id);
    if (i === -1) return;
    var l = pedido.lineas.splice(i, 1)[0];
    guarda();
    var r = resuelve(l);
    avisa(rell(T.quitado, { plato: r ? r.plato.nombre : l.nombre }), function () {
      mete(l, i);
      guarda();
    });
  }

  function vacia(texto) {
    var antes = pedido;
    pedido = nuevo();
    guarda();
    avisa(texto, function () {
      if (!pedido.lineas.length) pedido = antes;
      else antes.lineas.forEach(function (l) { mete(l); });
      guarda();
    });
  }

  /* Otra pestaña con la carta abierta cambió la lista. */
  window.addEventListener('storage', function (e) {
    if (e.key !== CLAVE && e.key !== null) return;
    pedido = Almacen.lee() || nuevo();
    pinta();
  });

  /* ------------------------------------------------------------------ */
  /* Avisos: la región viva y el aviso con «Deshacer»                    */
  /* ------------------------------------------------------------------ */
  var anuncio = el('p', { class: 'oculto', role: 'status', 'aria-live': 'polite' });
  document.body.appendChild(anuncio);
  function anuncia(texto) {
    /* Se vacía antes para que un mensaje igual al anterior se vuelva a leer. */
    anuncio.textContent = '';
    setTimeout(function () { anuncio.textContent = texto; }, 60);
  }

  var avisoTxt = el('span', { class: 'ped-aviso-t' });
  var avisoBtn = el('button', { type: 'button', class: 'ped-aviso-b', texto: T.deshacer });
  var aviso = el('div', { class: 'ped-aviso', role: 'status' }, [avisoTxt, avisoBtn]);
  document.body.appendChild(aviso);
  var relojAviso = 0;
  var alDeshacer = null;

  function escondeAviso() {
    clearTimeout(relojAviso);
    aviso.classList.remove('visible');
    alDeshacer = null;
  }
  /* Con una hoja abierta, todo lo que está fuera de ella es inert: el aviso
     tiene que vivir dentro de la hoja de arriba o su botón no se podría pulsar. */
  function avisa(texto, deshacer) {
    var arriba = abiertas[abiertas.length - 1];
    (arriba ? arriba.dlg : document.body).appendChild(aviso);
    aviso.classList.toggle('en-hoja', !!arriba);
    alDeshacer = deshacer || null;
    avisoBtn.hidden = !deshacer;
    avisoTxt.textContent = '';
    setTimeout(function () { avisoTxt.textContent = texto; }, 60);
    aviso.classList.add('visible');
    clearTimeout(relojAviso);
    relojAviso = setTimeout(escondeAviso, 5000);
  }
  avisoBtn.addEventListener('click', function () {
    var f = alDeshacer;
    escondeAviso();
    if (f) f();
  });
  /* Mientras alguien lo está mirando o lo tiene enfocado, no se va. */
  ['pointerenter', 'focusin'].forEach(function (ev) {
    aviso.addEventListener(ev, function () { clearTimeout(relojAviso); });
  });
  ['pointerleave', 'focusout'].forEach(function (ev) {
    aviso.addEventListener(ev, function () {
      clearTimeout(relojAviso);
      if (aviso.classList.contains('visible')) relojAviso = setTimeout(escondeAviso, 3000);
    });
  });

  /* ------------------------------------------------------------------ */
  /* El muelle                                                           */
  /* ------------------------------------------------------------------ */
  /* Los dos parámetros de Apple: amortiguación (1 = sin rebote) y respuesta
     (en segundos). Con masa 1, rigidez = (2π/respuesta)² y rozamiento =
     4π·amortiguación/respuesta. La posición vive aquí y no se lee del DOM,
     así que una animación interrumpida arranca siempre desde lo que se ve
     en pantalla, con la velocidad que llevaba. */
  function Muelle(aplica) {
    var x = 0, v = 0, meta = 0, k = 0, c = 0, raf = 0, ultimo = 0;
    var alFin = null, basta = null;

    function paso(ahora) {
      var dt = Math.min((ahora - ultimo) / 1000, 1 / 30);
      ultimo = ahora;
      var n = Math.max(1, Math.ceil(dt * 240));
      var h = dt / n;
      for (var i = 0; i < n; i++) {
        v += (-k * (x - meta) - c * v) * h;
        x += v * h;
      }
      var quieta = Math.abs(x - meta) < 0.5 && Math.abs(v) < 20;
      if (quieta || (basta && basta(x))) {
        if (quieta) { x = meta; v = 0; }
        aplica(x);
        raf = 0;
        var f = alFin;
        alFin = null;
        basta = null;
        if (f) f();
        return;
      }
      aplica(x);
      raf = requestAnimationFrame(paso);
    }
    function para() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      alFin = null;
      basta = null;
    }
    return {
      valor: function () { return x; },
      para: para,
      pon: function (y) { para(); x = y; v = 0; aplica(x); },
      va: function (destino, vel, amort, resp, fin, corta) {
        meta = destino;
        if (vel != null) v = vel;
        k = Math.pow(2 * Math.PI / resp, 2);
        c = 4 * Math.PI * amort / resp;
        alFin = fin || null;
        basta = corta || null;
        if (!raf) {
          ultimo = performance.now();
          raf = requestAnimationFrame(paso);
        }
      }
    };
  }

  /* Pasado el tope, cada píxel de dedo mueve menos la hoja: nada se para en
     seco. La fórmula es la de la goma elástica de iOS. */
  var goma = function (sobra, dim) { return (sobra * dim * 0.55) / (dim + 0.55 * sobra); };

  /* ------------------------------------------------------------------ */
  /* El bloqueo del scroll de la página                                   */
  /* ------------------------------------------------------------------ */
  /* iOS ignora overflow:hidden en el body; fijarlo es lo único fiable. Es la
     misma técnica que el menú de móvil de main.js. Lleva cuenta porque las
     hojas se pueden apilar. */
  var bloqueos = 0;
  var scrollAntes = 0;
  function bloquea() {
    if (bloqueos++ > 0) return;
    scrollAntes = window.scrollY;
    var s = document.body.style;
    s.position = 'fixed';
    s.top = -scrollAntes + 'px';
    s.width = '100%';
  }
  function desbloquea() {
    if (bloqueos === 0 || --bloqueos > 0) return;
    var s = document.body.style;
    s.position = '';
    s.top = '';
    s.width = '';
    /* El html lleva scroll-behavior:smooth, y la vuelta al sitio se vería
       como un paseo desde arriba del todo. Se apaga un instante. */
    var h = document.documentElement.style;
    var antes = h.scrollBehavior;
    h.scrollBehavior = 'auto';
    window.scrollTo(0, scrollAntes);
    h.scrollBehavior = antes;
  }

  /* ------------------------------------------------------------------ */
  /* La hoja                                                             */
  /* ------------------------------------------------------------------ */
  /* Un <dialog> con showModal(): capa superior, fondo inert, Escape y foco
     atrapado de fábrica. En el móvil es una hoja que sube desde abajo y se
     cierra arrastrándola; a partir de 900 px, un diálogo centrado. */
  var abiertas = [];
  var nHoja = 0;

  function Hoja(clase, ganchos) {
    ganchos = ganchos || {};
    var idTitulo = 'ped-h' + (++nHoja) + '-t';
    var cerrar = el('button', { type: 'button', class: 'ped-cerrar', 'aria-label': T.cerrar }, [ico('cierra')]);
    var cab = el('div', { class: 'ped-cab' }, [el('span', { class: 'ped-asa', 'aria-hidden': 'true' }), cerrar]);
    var cuerpo = el('div', { class: 'ped-cuerpo' });
    var pie = el('div', { class: 'ped-pie' });
    var rollo = el('div', { class: 'ped-rollo' }, [cab, cuerpo, pie]);
    var caja = el('div', { class: 'ped-caja' }, [rollo]);
    var velo = el('div', { class: 'ped-velo' });
    var dlg = el('dialog', { class: 'ped-hoja ' + clase, 'aria-labelledby': idTitulo }, [velo, caja]);
    document.body.appendChild(dlg);

    var modo = 'hoja';
    var alto = 0;
    var abierta = false;
    var cerrando = false;
    var disparador = null;
    var pendiente = null;
    var animaciones = [];

    var muelle = Muelle(function (y) {
      caja.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      velo.style.opacity = String(Math.max(0, Math.min(1, 1 - y / (alto || 1))));
    });

    function cancelaAnimaciones() {
      animaciones.forEach(function (a) { a.cancel(); });
      animaciones = [];
    }

    /* Fundido, para quien pide menos movimiento, y la entrada del diálogo
       centrado: escala desde 0,96 y nunca desde cero. Siempre arranca de la
       opacidad que haya en pantalla, por si se interrumpe. */
    function transicion(entra, fin) {
      var opCaja = parseFloat(getComputedStyle(caja).opacity);
      var opVelo = parseFloat(getComputedStyle(velo).opacity);
      cancelaAnimaciones();
      var dura = entra ? 220 : 160;
      var conEscala = modo === 'centro' && !quieto.matches;
      var ks = entra
        ? [{ opacity: entra && opCaja === 1 ? 0 : opCaja, transform: conEscala ? 'scale(.96)' : 'none' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: opCaja, transform: 'none' }, { opacity: 0, transform: conEscala ? 'scale(.98)' : 'none' }];
      var a = caja.animate(ks, { duration: dura, easing: SAL, fill: 'forwards' });
      var b = velo.animate([{ opacity: entra && opVelo === 1 ? 0 : opVelo }, { opacity: entra ? 1 : 0 }],
        { duration: dura, easing: SAL, fill: 'forwards' });
      animaciones = [a, b];
      if (fin) a.onfinish = fin;
    }

    function abre(desde) {
      if (abierta && !cerrando) return;
      disparador = desde || document.activeElement;
      if (abierta) {
        /* Iba de salida: se da la vuelta desde donde está. */
        cerrando = false;
        pendiente = null;
        if (quieto.matches || modo === 'centro') return transicion(true);
        return muelle.va(0, null, 1, 0.4);
      }
      abierta = true;
      cerrando = false;
      muelle.para();
      cancelaAnimaciones();
      caja.style.transform = '';
      velo.style.opacity = '';
      dlg.showModal();
      abiertas.push(api);
      bloquea();
      modo = ancho.matches ? 'centro' : 'hoja';
      dlg.setAttribute('data-modo', modo);
      rollo.scrollTop = 0;
      /* Al botón de cerrar, que es lo que espera quien abre un diálogo. */
      cerrar.focus({ preventScroll: true });
      if (ganchos.alAbrir) ganchos.alAbrir();
      if (quieto.matches || modo === 'centro') return transicion(true);
      /* Se mide ya abierta y se coloca fuera de la pantalla antes del primer
         fotograma, así que no hay parpadeo. */
      alto = caja.offsetHeight;
      muelle.pon(alto);
      muelle.va(0, 0, 1, 0.4);
    }

    /* `despues` corre cuando la hoja ya se ha cerrado del todo y el fondo ha
       dejado de ser inert: es donde tiene que ir lo que se anuncia. */
    function cierra(vel, despues) {
      if (!abierta) { if (despues) despues(); return; }
      if (despues) pendiente = despues;
      if (cerrando) return;
      cerrando = true;
      if (quieto.matches || modo === 'centro') return transicion(false, termina);
      alto = caja.offsetHeight;
      muelle.va(alto + 40, vel || 0, 1, 0.32, termina, function (y) { return y >= alto; });
    }

    function termina() {
      muelle.para();
      cancelaAnimaciones();
      abierta = false;
      cerrando = false;
      caja.style.transform = '';
      velo.style.opacity = '';
      if (dlg.contains(aviso)) {
        document.body.appendChild(aviso);
        aviso.classList.remove('en-hoja');
      }
      dlg.close();
      abiertas.splice(abiertas.indexOf(api), 1);
      desbloquea();
      if (ganchos.alCerrar) ganchos.alCerrar();
      var d = typeof disparador === 'function' ? disparador() : disparador;
      disparador = null;
      if (d && d.isConnected) d.focus({ preventScroll: true });
      var f = pendiente;
      pendiente = null;
      if (f) f();
    }

    /* Escape: se cierra con la misma animación, no de golpe. */
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); cierra(); });
    cerrar.addEventListener('click', function () { cierra(); });
    velo.addEventListener('click', function () { cierra(); });

    /* --- el arrastre --------------------------------------------------- */
    /* Responde en cuanto se toca: si la hoja iba de camino, se queda quieta
       bajo el dedo. Sigue 1:1 desde donde se agarró, con 10 px de margen
       antes de decidir, y al soltar proyecta la inercia para saber a dónde
       iba el gesto, no dónde estaba el dedo. */
    var arr = null;

    function agarra(y, x, t) {
      arr = { y0: y, x0: x, base: muelle.valor(), activo: false, cerraba: cerrando, hist: [{ y: y, t: t }] };
      muelle.para();
      cerrando = false;
    }
    function arrastra(y, x, t) {
      if (!arr) return false;
      if (!arr.activo) {
        var dy = y - arr.y0;
        var dx = x - arr.x0;
        if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return true;
        if (Math.abs(dx) > Math.abs(dy)) { suelta(t); return false; }
        arr.activo = true;
        arr.y0 = y;
        dlg.classList.add('arrastrando');
      }
      var pos = arr.base + (y - arr.y0);
      if (pos < 0) pos = -goma(-pos, alto || caja.offsetHeight);
      muelle.pon(pos);
      arr.hist.push({ y: y, t: t });
      while (arr.hist.length > 2 && t - arr.hist[0].t > 100) arr.hist.shift();
      return true;
    }
    function suelta(t) {
      var a = arr;
      arr = null;
      dlg.classList.remove('arrastrando');
      if (!a) return;
      alto = caja.offsetHeight;
      if (!a.activo) {
        /* Fue un toque, no un arrastre: lo que estuviera haciendo, sigue. */
        if (a.cerraba) cierra();
        else muelle.va(0, null, 1, 0.4);
        return;
      }
      var h = a.hist;
      var p = h[0];
      var u = h[h.length - 1];
      /* Si el dedo se paró antes de soltar, no hay inercia que proyectar. */
      var vel = u.t > p.t && t - u.t < 60 ? (u.y - p.y) / (u.t - p.t) * 1000 : 0;
      var destino = muelle.valor() + (vel / 1000) * 0.998 / (1 - 0.998);
      if (destino > alto * 0.3) cierra(vel);
      /* Con movimiento reducido vuelve a su sitio sin animar. */
      else if (quieto.matches) muelle.pon(0);
      /* Y si no, con un poco de rebote, porque el gesto traía impulso. */
      else muelle.va(0, vel, 0.85, 0.35);
    }

    /* Desde la cabecera, con punteros: ratón, lápiz o dedo. */
    var puntero = null;
    cab.addEventListener('pointerdown', function (e) {
      if (modo !== 'hoja' || arr || e.button > 0 || e.target.closest('button')) return;
      puntero = e.pointerId;
      cab.setPointerCapture(e.pointerId);
      agarra(e.clientY, e.clientX, e.timeStamp);
    });
    cab.addEventListener('pointermove', function (e) {
      if (e.pointerId === puntero) arrastra(e.clientY, e.clientX, e.timeStamp);
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      cab.addEventListener(ev, function (e) {
        if (e.pointerId !== puntero) return;
        puntero = null;
        suelta(e.timeStamp);
      });
    });

    /* Desde el contenido, solo con el dedo y solo si está arriba del todo y el
       gesto baja: así el scroll de dentro sigue siendo scroll. Va con eventos
       táctiles porque hay que poder frenar el scroll nativo con
       preventDefault, y eso un evento de puntero no lo permite. */
    var toque = null;
    rollo.addEventListener('touchstart', function (e) {
      toque = null;
      if (modo !== 'hoja' || arr || e.touches.length !== 1 || cab.contains(e.target)) return;
      var t = e.touches[0];
      toque = { y: t.clientY, x: t.clientX, arriba: rollo.scrollTop <= 0 };
    }, { passive: true });
    rollo.addEventListener('touchmove', function (e) {
      if (!toque) return;
      if (e.touches.length !== 1) { toque = null; return; }
      var t = e.touches[0];
      if (!arr) {
        if (!toque.arriba || rollo.scrollTop > 0 || t.clientY <= toque.y) { toque = null; return; }
        agarra(toque.y, toque.x, e.timeStamp);
      }
      if (e.cancelable) e.preventDefault();
      if (!arrastra(t.clientY, t.clientX, e.timeStamp)) toque = null;
    }, { passive: false });
    ['touchend', 'touchcancel'].forEach(function (ev) {
      rollo.addEventListener(ev, function (e) {
        if (!toque) return;
        toque = null;
        if (arr) suelta(e.timeStamp);
      });
    });

    var api = {
      dlg: dlg, cuerpo: cuerpo, pie: pie, idTitulo: idTitulo,
      abre: abre, cierra: cierra,
      abierta: function () { return abierta; }
    };
    return api;
  }

  /* ------------------------------------------------------------------ */
  /* La pastilla del pedido                                              */
  /* ------------------------------------------------------------------ */
  var pastillaN = el('span', { class: 'ped-pastilla-n' });
  var pastillaE = el('span', { class: 'ped-pastilla-e' });
  var pastilla = el('button', { type: 'button', class: 'ped-pastilla', 'aria-haspopup': 'dialog' },
    [pastillaN, el('span', { class: 'ped-pastilla-t', texto: T.pastilla }), pastillaE, ico('sube')]);
  document.body.appendChild(pastilla);
  var pastillaVisible = false;

  /* Un respingo al añadir, para que se note dónde ha ido el plato. No se hace
     en la primera, que ya entra subiendo. */
  function respingo() {
    if (quieto.matches || !pastilla.animate) return;
    pastilla.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: SAL });
  }

  /* ------------------------------------------------------------------ */
  /* La línea de ayuda de la cabecera                                    */
  /* ------------------------------------------------------------------ */
  /* Sin ella nada decía que el «+» existe ni para qué sirve, y hay quien
     entiende que pide por internet. Lleva dentro el mismo globo que los
     platos, donde el texto pone {mas}. La pinta este script y no el HTML
     porque sin JavaScript no hay globos que explicar. */
  var cabSub = $('.carta-cab .carta-sub');
  if (cabSub && T.ayuda) {
    var ayuda = [];
    String(T.ayuda).split('{mas}').forEach(function (trozo, n) {
      if (n) ayuda.push(el('span', { class: 'ped-ayuda-c' }, [ico('mas'), el('span', { class: 'oculto', texto: '+' })]));
      ayuda.push(trozo);
    });
    cabSub.parentNode.insertBefore(el('p', { class: 'ped-ayuda' }, ayuda), cabSub.nextSibling);
  }

  /* ------------------------------------------------------------------ */
  /* Los globos de la carta                                              */
  /* ------------------------------------------------------------------ */
  /* Van como hermanos del <details> y no dentro del <summary>, porque un
     botón dentro de otro botón no es accesible. Se anclan a la esquina del
     icono, que tiene una geometría fija en todas las filas. */
  var globos = $$('.cplato[data-plato]').map(function (li) {
    var p = PLATOS[li.getAttribute('data-plato')];
    if (!p) return null;
    var num = el('span', { class: 'ped-globo-n' });
    var cara = el('span', { class: 'ped-globo-c', 'aria-hidden': 'true' }, [ico('mas'), num]);
    var btn = el('button', { type: 'button', class: 'ped-globo', 'aria-label': rell(T.anadir_plato, { plato: p.nombre }) }, [cara]);
    if (!esSimple(p)) btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', function () {
      if (!esSimple(p)) return abreConfig(p, null, btn);
      anade({ plato: p.slug, nombre: p.nombre, variante: null, varianteEt: null, opciones: {}, cantidad: 1, nota: '' });
      anuncia(rell(T.anadido, { plato: p.nombre, platos: platos(cuenta.unidades) }));
    });
    li.appendChild(btn);
    return { btn: btn, cara: cara, num: num, plato: p, n: 0 };
  }).filter(Boolean);

  /* ------------------------------------------------------------------ */
  /* Repintar                                                            */
  /* ------------------------------------------------------------------ */
  var cuenta = { total: 0, consultar: false, unidades: 0, porPlato: {} };

  function recuenta() {
    var c = { total: 0, consultar: false, unidades: 0, porPlato: {} };
    pedido.lineas.forEach(function (l) {
      var r = resuelve(l);
      if (!r) return;
      c.total += r.unidad * l.cantidad;
      if (r.consultar) c.consultar = true;
      c.unidades += l.cantidad;
      c.porPlato[l.plato] = (c.porPlato[l.plato] || 0) + l.cantidad;
    });
    return c;
  }

  function pinta() {
    var antes = cuenta.unidades;
    cuenta = recuenta();

    globos.forEach(function (g) {
      var n = cuenta.porPlato[g.plato.slug] || 0;
      if (n === g.n) return;
      var sube = n > g.n;
      g.n = n;
      g.btn.classList.toggle('lleno', n > 0);
      g.num.textContent = n > 99 ? '99+' : String(n);
      g.btn.setAttribute('aria-label', n
        ? rell(T.en_pedido, { plato: g.plato.nombre, n: n })
        : rell(T.anadir_plato, { plato: g.plato.nombre }));
      if (sube && !quieto.matches && g.cara.animate) {
        g.cara.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 220, easing: SAL });
      }
    });

    var hay = cuenta.unidades > 0;
    pastillaN.textContent = String(cuenta.unidades);
    pastillaE.textContent = euros(cuenta.total);
    pastilla.setAttribute('aria-label', rell(T.ver_pedido, { platos: platos(cuenta.unidades), total: euros(cuenta.total) }));
    pastilla.classList.toggle('visible', hay);
    document.body.classList.toggle('ped-con-lista', hay);
    if (hay && pastillaVisible && cuenta.unidades > antes) respingo();
    pastillaVisible = hay;

    if (hLista.abierta()) pintaLista();
    if (hComanda.abierta()) pintaComanda();
  }

  /* ------------------------------------------------------------------ */
  /* El configurador                                                     */
  /* ------------------------------------------------------------------ */
  var hConfig = Hoja('ped-hoja-config');
  var nCampo = 0;

  /* Selector de cantidad del configurador: de 1 a 99. */
  function selectorCantidad(valor, alCambiar) {
    var n = el('output', { class: 'ped-cant-n' });
    var menos = el('button', { type: 'button', class: 'ped-cant-b', 'aria-label': T.menos }, [ico('menos')]);
    var mas = el('button', { type: 'button', class: 'ped-cant-b', 'aria-label': T.mas }, [ico('mas')]);
    function pon(v) {
      valor = Math.max(1, Math.min(MAX, v));
      n.textContent = String(valor);
      menos.setAttribute('aria-disabled', valor === 1 ? 'true' : 'false');
      mas.setAttribute('aria-disabled', valor === MAX ? 'true' : 'false');
      alCambiar(valor);
    }
    menos.addEventListener('click', function () { pon(valor - 1); });
    mas.addEventListener('click', function () { pon(valor + 1); });
    pon(valor);
    return el('div', { class: 'ped-cant', role: 'group', 'aria-label': T.cantidad }, [menos, n, mas]);
  }

  /* Un grupo con su leyenda, su pista y el aviso de «elige una». */
  function campo(titulo, pista, control) {
    var idFalta = 'ped-f' + (++nCampo);
    var falta = el('p', { class: 'ped-falta', id: idFalta, hidden: true, texto: T.falta });
    var f = el('fieldset', { class: 'ped-campo' }, [
      el('legend', { class: 'ped-leyenda' }, [el('span', { texto: titulo }), pista ? el('span', { class: 'ped-pista', texto: pista }) : null]),
      control, falta
    ]);
    f.marcaFalta = function (si) {
      falta.hidden = !si;
      f.toggleAttribute('data-falta', si);
      if (si) f.setAttribute('aria-describedby', idFalta);
      else f.removeAttribute('aria-describedby');
    };
    return f;
  }

  /* Elección única. Con tres opciones o menos es un control segmentado, con
     un pulgar que se desliza de una a otra; con más, pastillas que saltan de
     línea. Si el grupo es opcional, volver a tocar la marcada la quita, que
     es la forma de volver a «como viene». */
  function unica(nombre, opciones, marcada, opcional, alCambiar) {
    var seg = opciones.length <= 3;
    var pulgar = seg ? el('span', { class: 'ped-seg-pulgar', 'aria-hidden': 'true' }) : null;
    var caja = el('div', seg ? { class: 'ped-seg', style: '--n:' + opciones.length } : { class: 'ped-ops' }, [pulgar]);
    var etiquetas = [];
    var entradas = opciones.map(function (o) {
      var inp = el('input', { type: 'radio', name: nombre, value: o.valor });
      if (o.valor === marcada) inp.checked = true;
      var lab = el('label', { class: seg ? 'ped-seg-op' : 'ped-op' }, [
        inp, el('span', { class: 'ped-op-t', texto: o.texto }),
        o.extra ? el('span', { class: 'ped-op-p' + (o.consulta ? ' consulta' : ''), texto: o.extra }) : null
      ]);
      var era = false;
      if (opcional) {
        lab.addEventListener('pointerdown', function () { era = inp.checked; });
        inp.addEventListener('click', function () {
          if (era) {
            inp.checked = false;
            alCambiar(null);
            refleja();
          }
          era = false;
        });
      }
      inp.addEventListener('change', function () {
        if (!inp.checked) return;
        alCambiar(o.valor);
        refleja();
      });
      etiquetas.push(lab);
      caja.appendChild(lab);
      return inp;
    });
    function refleja() {
      var i = -1;
      entradas.forEach(function (x, j) {
        etiquetas[j].classList.toggle('on', x.checked);
        if (x.checked) i = j;
      });
      if (!seg) return;
      caja.toggleAttribute('data-sel', i >= 0);
      if (i >= 0) pulgar.style.transform = 'translateX(' + (i * 100) + '%)';
    }
    refleja();
    caja.primera = function () { return entradas[0]; };
    return caja;
  }

  /* Elección múltiple: filas con el círculo de selección de iOS. */
  function multiple(nombre, opciones, marcadas, alCambiar) {
    var caja = el('div', { class: 'ped-extras' });
    var entradas = opciones.map(function (o) {
      var inp = el('input', { type: 'checkbox', name: nombre, value: o.valor });
      inp.checked = marcadas.indexOf(o.valor) !== -1;
      var lab = el('label', { class: 'ped-extra' + (inp.checked ? ' on' : '') }, [
        inp,
        el('span', { class: 'ped-marca', 'aria-hidden': 'true' }, [ico('marca')]),
        el('span', { class: 'ped-extra-n', texto: o.texto }),
        o.extra ? el('span', { class: 'ped-extra-p' + (o.consulta ? ' consulta' : ''), texto: o.extra }) : null
      ]);
      inp.addEventListener('change', function () {
        lab.classList.toggle('on', inp.checked);
        alCambiar(entradas.filter(function (x) { return x.checked; }).map(function (x) { return x.value; }));
      });
      caja.appendChild(lab);
      return inp;
    });
    caja.primera = function () { return entradas[0]; };
    return caja;
  }

  /* El precio de una opción, como se enseña a su lado. */
  function extraDe(c) {
    if (c == null) return { extra: T.consultar, consulta: true };
    if (c > 0) return { extra: '+' + euros(c), consulta: false };
    return { extra: null, consulta: false };
  }

  function bloqueNota(est) {
    var idT = 'ped-nota-' + (++nCampo);
    var area = el('textarea', { id: idT, class: 'ped-nota-t', maxlength: String(NOTA_MAX), rows: '2',
      placeholder: T.nota_ph, autocomplete: 'off', enterkeyhint: 'done' });
    area.value = est.nota;
    area.addEventListener('input', function () { est.nota = area.value; });
    var caja = el('div', { class: 'ped-nota-caja', hidden: !est.nota }, [
      el('label', { for: idT, class: 'ped-leyenda', texto: T.nota }), area
    ]);
    var abre = el('button', { type: 'button', class: 'ped-nota-abre', hidden: !!est.nota }, [ico('mas'), el('span', { texto: T.nota_abre })]);
    abre.addEventListener('click', function () {
      caja.hidden = false;
      abre.hidden = true;
      area.focus();
    });
    return el('div', { class: 'ped-nota' }, [abre, caja]);
  }

  /* Abre el configurador de un plato. Con `linea`, en modo edición. */
  function abreConfig(p, linea, desde) {
    var r = linea ? resuelve(linea) : null;
    var est = {
      variante: p.precios.length > 1 ? (r ? r.variante : 0) : null,
      opciones: r ? limpiaOpciones(linea.opciones) : {},
      cantidad: linea ? linea.cantidad : 1,
      nota: linea ? linea.nota : ''
    };
    var c = hConfig.cuerpo;
    var pie = hConfig.pie;
    c.textContent = '';
    pie.textContent = '';

    /* La cabecera reutiliza lo que la fila ya enseña: el icono, la
       descripción y las pastillas de alérgenos y niveles. */
    var li = $('.cplato[data-plato="' + (window.CSS && CSS.escape ? CSS.escape(p.slug) : p.slug) + '"]');
    var icono = li && $('.plato-ico', li);
    var desc = li && $('.plato-desc', li);
    var chips = li && $('.plato-chips', li);
    c.appendChild(el('div', { class: 'ped-plato' }, [
      icono ? icono.cloneNode(true) : null,
      el('div', { class: 'ped-plato-txt' }, [
        el('h2', { id: hConfig.idTitulo, class: 'ped-titulo' },
          [p.numero ? el('span', { class: 'ped-num', texto: p.numero }) : null, p.numero ? ' ' : null, p.nombre]),
        desc ? el('p', { class: 'ped-desc', texto: desc.textContent }) : null
      ])
    ]));
    if (chips) {
      var cc = chips.cloneNode(true);
      cc.className = 'ped-chips';
      c.appendChild(cc);
    }

    var campos = el('div', { class: 'ped-campos' });
    var porGrupo = {};
    if (p.precios.length > 1) {
      campos.appendChild(campo(T.formato, null, unica('ped-v', p.precios.map(function (x, i) {
        var e = x.centimos == null ? { extra: T.consultar, consulta: true } : { extra: euros(x.centimos), consulta: false };
        return { valor: String(i), texto: x.etiqueta, extra: e.extra, consulta: e.consulta };
      }), String(est.variante), false, function (v) {
        est.variante = parseInt(v, 10);
        actualiza();
      })));
    }
    p.grupos.forEach(function (g) {
      var G = GRUPOS[g];
      var ops = G.opciones.map(function (o) {
        var e = extraDe(o.centimos);
        return { valor: o.slug, texto: o.nombre, extra: e.extra, consulta: e.consulta };
      });
      var marcadas = est.opciones[g] || [];
      var control, pista;
      if (G.tipo === 'multiple') {
        pista = T.elige_varios;
        control = multiple('ped-g-' + g, ops, marcadas, function (v) {
          est.opciones[g] = v;
          actualiza();
        });
      } else {
        pista = G.obligatorio ? T.obligatorio : T.opcional;
        control = unica('ped-g-' + g, ops, marcadas[0] || null, !G.obligatorio, function (v) {
          est.opciones[g] = v ? [v] : [];
          if (v && porGrupo[g]) porGrupo[g].f.marcaFalta(false);
          actualiza();
        });
      }
      var f = campo(G.nombre, pista, control);
      porGrupo[g] = { f: f, control: control };
      campos.appendChild(f);
    });
    c.appendChild(campos);
    c.appendChild(bloqueNota(est));

    if (linea) {
      var quitar = el('button', { type: 'button', class: 'btn-t' }, [el('span', { texto: T.quitar })]);
      /* Se quita cuando la hoja ya se ha ido, para que el aviso con «Deshacer»
         aparezca en la lista y no dentro de una hoja que se está cerrando. */
      quitar.addEventListener('click', function () {
        hConfig.cierra(null, function () { quita(linea.id); });
      });
      c.appendChild(el('p', { class: 'ped-quitar' }, [quitar]));
    }

    var boton = el('button', { type: 'button', class: 'btn btn-p ped-anadir' });
    function lineaDe() {
      return {
        plato: p.slug, nombre: p.nombre,
        variante: est.variante,
        varianteEt: est.variante == null ? null : p.precios[est.variante].etiquetaEs,
        opciones: limpiaOpciones(est.opciones),
        cantidad: est.cantidad,
        nota: est.nota.trim().slice(0, NOTA_MAX)
      };
    }
    function actualiza() {
      var rr = resuelve(lineaDe());
      var imp = rr && rr.precio.centimos != null ? rr.unidad * est.cantidad : null;
      boton.textContent = (linea ? T.guardar : T.anadir) + (imp ? ' · ' + euros(imp) : '');
    }
    pie.appendChild(selectorCantidad(est.cantidad, function (v) {
      est.cantidad = v;
      actualiza();
    }));
    pie.appendChild(boton);

    boton.addEventListener('click', function () {
      var l = lineaDe();
      var rr = resuelve(l);
      if (!rr) return;
      /* Un grupo obligatorio sin elegir no deja seguir: se dice dónde, en el
         propio grupo, y el foco va a él. */
      if (rr.faltan.length) {
        rr.faltan.forEach(function (g) { porGrupo[g].f.marcaFalta(true); });
        var primero = porGrupo[rr.faltan[0]];
        primero.f.scrollIntoView({ block: 'center', behavior: quieto.matches ? 'auto' : 'smooth' });
        primero.control.primera().focus({ preventScroll: true });
        return;
      }
      if (linea) {
        hConfig.cierra();
        reemplaza(linea.id, l);
        return;
      }
      anade(l);
      hConfig.cierra(null, function () {
        anuncia(rell(T.anadido, { plato: p.nombre, platos: platos(cuenta.unidades) }));
      });
    });

    actualiza();
    hConfig.abre(desde);
  }

  /* ------------------------------------------------------------------ */
  /* La lista                                                            */
  /* ------------------------------------------------------------------ */
  var hLista = Hoja('ped-hoja-lista');

  /* Las líneas por sección de la carta, en su orden. Las que ya no casan con
     la carta van al final, en un grupo propio. */
  function agrupa(soloValidas) {
    var grupos = {};
    var rotas = [];
    pedido.lineas.forEach(function (l) {
      var r = resuelve(l);
      if (!r) { if (!soloValidas) rotas.push({ l: l, r: null }); return; }
      var m = r.plato.madre;
      (grupos[m] = grupos[m] || []).push({ l: l, r: r });
    });
    var fuera = Object.keys(grupos).sort(function (a, b) {
      return (CATS[a] ? CATS[a].orden : 99) - (CATS[b] ? CATS[b].orden : 99);
    }).map(function (m) { return { cat: CATS[m] ? CATS[m].c : null, items: grupos[m] }; });
    if (rotas.length) fuera.push({ cat: null, rota: true, items: rotas });
    return fuera;
  }

  /* Una lista de otro día se avisa, pero no se borra nunca sola. */
  function diasDesde(iso) {
    var a = new Date(iso);
    var b = new Date();
    if (isNaN(a)) return 0;
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  }
  function cuandoFue(dias) {
    if (window.Intl && Intl.RelativeTimeFormat) {
      try { return new Intl.RelativeTimeFormat(L, { numeric: 'auto' }).format(-dias, 'day'); } catch (e) { /* abajo */ }
    }
    return rell(T.hace_dias, { n: dias });
  }

  function lineaLista(l, r) {
    var nombre = r ? r.plato.nombre : l.nombre;
    var info = [el('span', { class: 'ped-linea-n' }, [
      r && r.plato.numero ? el('span', { class: 'ped-num', texto: r.plato.numero }) : null,
      r && r.plato.numero ? ' ' : null, nombre])];
    var rs = r ? resumen(r, false) : T.ya_no;
    if (rs) info.push(el('span', { class: 'ped-linea-r', texto: rs }));
    if (l.nota) info.push(el('span', { class: 'ped-linea-nota', texto: l.nota }));
    if (r && r.faltan.length) {
      info.push(el('span', { class: 'ped-linea-falta', texto: rell(T.falta_elegir, {
        grupo: r.faltan.map(function (g) { return GRUPOS[g].nombre; }).join(', ') }) }));
    }
    var texto = r
      ? el('button', { type: 'button', class: 'ped-linea-edita', 'data-linea': l.id, 'data-accion': 'edita', 'aria-haspopup': 'dialog' }, info)
      : el('div', { class: 'ped-linea-edita' }, info);

    var imp = r ? el('span', { class: 'ped-linea-imp' + (r.precio.centimos == null ? ' consulta' : ''),
      texto: r.precio.centimos == null ? T.consultar : euros(r.unidad * l.cantidad) }) : null;

    /* En la última unidad, el «−» pasa a papelera y quita la línea. */
    var ultima = !r || l.cantidad === 1;
    var menos = el('button', { type: 'button', class: 'ped-cant-b', 'data-linea': l.id, 'data-accion': 'menos',
      'aria-label': rell(ultima ? T.quitar_plato : T.menos_plato, { plato: nombre }) }, [ico(ultima ? 'papelera' : 'menos')]);
    var cant = r
      ? el('div', { class: 'ped-cant', role: 'group', 'aria-label': rell(T.cantidad_de, { plato: nombre }) }, [
        menos,
        el('span', { class: 'ped-cant-n', texto: String(l.cantidad) }),
        el('button', { type: 'button', class: 'ped-cant-b', 'data-linea': l.id, 'data-accion': 'mas',
          'aria-label': rell(T.mas_plato, { plato: nombre }), 'aria-disabled': l.cantidad >= MAX ? 'true' : 'false' }, [ico('mas')])
      ])
      : el('div', { class: 'ped-cant ped-cant-solo' }, [menos]);

    return el('li', { class: 'ped-linea' + (r ? '' : ' ped-linea-rota'), 'data-linea': l.id }, [texto, imp, cant]);
  }

  function pintaLista() {
    var c = hLista.cuerpo;
    var pie = hLista.pie;
    /* La lista se rehace entera en cada cambio. Para que el foco no se pierda
       al pulsar «+», se recuerda qué control lo tenía y se le devuelve. */
    var act = document.activeElement;
    var foco = act && hLista.dlg.contains(act) && act.getAttribute('data-accion')
      ? { linea: act.getAttribute('data-linea'), accion: act.getAttribute('data-accion') } : null;

    c.textContent = '';
    pie.textContent = '';
    c.appendChild(el('h2', { id: hLista.idTitulo, class: 'ped-titulo', texto: T.lista_titulo }));

    if (!pedido.lineas.length) {
      c.appendChild(el('p', { class: 'ped-vacia', texto: T.vacia }));
      if (foco) $('.ped-cerrar', hLista.dlg).focus({ preventScroll: true });
      return;
    }

    var dias = diasDesde(pedido.actualizado);
    if (dias >= 1 && Date.now() - Date.parse(pedido.actualizado) > 12 * 3600e3) {
      c.appendChild(el('div', { class: 'ped-vieja' }, [
        el('p', { texto: rell(T.vieja, { cuando: cuandoFue(dias) }) }),
        el('button', { type: 'button', class: 'btn-t', 'data-accion': 'nueva' }, [el('span', { texto: T.empezar })])
      ]));
    }

    agrupa(false).forEach(function (g) {
      var titulo = g.rota ? T.ya_no : (g.cat ? g.cat.nombre : '');
      c.appendChild(el('section', { class: 'ped-sec' }, [
        el('h3', { class: 'ped-sec-h', texto: titulo }),
        el('ul', { class: 'ped-lineas' }, g.items.map(function (x) { return lineaLista(x.l, x.r); }))
      ]));
    });

    c.appendChild(el('p', { class: 'ped-vaciar' }, [
      el('button', { type: 'button', class: 'btn-t', 'data-accion': 'vaciar' }, [el('span', { texto: T.vaciar })])
    ]));

    pie.appendChild(el('div', { class: 'ped-total' }, [
      el('span', { texto: T.total }), el('b', { texto: euros(cuenta.total) })
    ]));
    if (cuenta.consultar) pie.appendChild(el('p', { class: 'ped-total-nota', texto: T.sin_consultar }));
    if (cuenta.unidades) {
      pie.appendChild(el('button', { type: 'button', class: 'btn btn-p', 'data-accion': 'camarero', 'aria-haspopup': 'dialog' },
        [el('span', { texto: T.camarero })]));
    }

    if (foco) {
      var mismo = foco.linea
        ? $('[data-linea="' + foco.linea + '"][data-accion="' + foco.accion + '"]', hLista.dlg)
        : $('[data-accion="' + foco.accion + '"]', hLista.dlg);
      var otro = foco.linea && $('[data-linea="' + foco.linea + '"][data-accion]', hLista.dlg);
      (mismo || otro || $('.ped-cerrar', hLista.dlg)).focus({ preventScroll: true });
    }
  }

  function accionLista(e) {
    var b = e.target.closest('[data-accion]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    var acc = b.getAttribute('data-accion');
    var id = b.getAttribute('data-linea');
    var l = id ? pedido.lineas[indice(id)] : null;
    if (acc === 'mas' && l) cambia(id, 1);
    else if (acc === 'menos' && l) {
      if (l.cantidad > 1 && resuelve(l)) cambia(id, -1);
      else quita(id);
    } else if (acc === 'edita' && l) {
      /* Al cerrar, el foco vuelve a la línea, que para entonces se ha
         repintado: se busca por su id en ese momento. */
      abreConfig(PLATOS[l.plato], l, function () {
        return $('.ped-linea-edita[data-linea="' + id + '"]', hLista.dlg) || $('.ped-cerrar', hLista.dlg);
      });
    } else if (acc === 'camarero') {
      pintaComanda();
      hComanda.abre(b);
    } else if (acc === 'vaciar' || acc === 'nueva') {
      vacia(T.vaciada);
    }
  }
  hLista.cuerpo.addEventListener('click', accionLista);
  hLista.pie.addEventListener('click', accionLista);

  pastilla.addEventListener('click', function () {
    pintaLista();
    hLista.abre(pastilla);
  });

  /* ------------------------------------------------------------------ */
  /* La pantalla del camarero                                            */
  /* ------------------------------------------------------------------ */
  /* En papel washi, como una comanda. Lo que lee el camarero va en español,
     con el idioma del cliente debajo cuando es otro: es el formato que tendrá
     el ticket de cocina en la v2. Lo que lee el cliente —cómo se usa y lo de
     las alergias— va en el suyo. Mientras está abierta se pide que la
     pantalla no se apague. */
  var candado = null;
  function pideCandado() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (c) { candado = c; }, function () { /* sin permiso */ });
  }
  function sueltaCandado() {
    if (candado) candado.release().then(null, function () { /* ya suelto */ });
    candado = null;
  }
  var hComanda = Hoja('ped-hoja-comanda', { alAbrir: pideCandado, alCerrar: sueltaCandado });
  /* El sistema suelta el candado al cambiar de pestaña: se vuelve a pedir. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && hComanda.abierta()) pideCandado();
  });

  function pintaComanda() {
    var c = hComanda.cuerpo;
    var pie = hComanda.pie;
    c.textContent = '';
    pie.textContent = '';
    c.appendChild(el('div', { class: 'ped-com-cab' }, [
      el('p', { class: 'ped-com-marca', texto: 'Ramen Okaeri' }),
      el('h2', { id: hComanda.idTitulo, class: 'ped-com-t', lang: 'es', texto: D.comanda }),
      el('p', { class: 'ped-com-sub', texto: T.comanda_sub })
    ]));

    var total = 0;
    agrupa(true).forEach(function (g) {
      c.appendChild(el('section', { class: 'ped-com-sec', lang: 'es' }, [
        el('h3', { class: 'ped-com-h', texto: g.cat ? g.cat.nombreEs : '' }),
        el('ul', { class: 'ped-com-lista' }, g.items.map(function (x) {
          var l = x.l;
          var r = x.r;
          var p = r.plato;
          var es = resumen(r, true);
          var suyo = resumen(r, false);
          var imp = r.precio.centimos == null ? null : r.unidad * l.cantidad;
          if (imp) total += imp;
          var otro = L !== 'es' && (p.nombre !== p.nombreEs || suyo !== es)
            ? el('p', { class: 'ped-com-otro', lang: L, texto: p.nombre + (suyo ? ' · ' + suyo : '') }) : null;
          return el('li', null, [
            el('span', { class: 'ped-com-cant', texto: l.cantidad + '×' }),
            el('div', { class: 'ped-com-txt' }, [
              /* El número de carta va detrás: delante, «2× 1 Tonkotsu» junta
                 dos cifras y no se sabe cuál es la cantidad. */
              el('p', { class: 'ped-com-n' }, [p.nombreEs,
                p.numero ? ' ' : null, p.numero ? el('span', { class: 'ped-num', texto: 'n.º ' + p.numero }) : null]),
              es ? el('p', { class: 'ped-com-o', texto: es }) : null,
              l.nota ? el('p', { class: 'ped-com-nota', texto: l.nota }) : null,
              otro
            ]),
            el('span', { class: 'ped-com-imp', texto: imp == null ? D.consultarEs : euros(imp, 'es') })
          ]);
        }))
      ]));
    });

    c.appendChild(el('div', { class: 'ped-com-total' }, [
      el('span', { lang: 'es', texto: D.totalEs }), el('b', { lang: 'es', texto: euros(total, 'es') })
    ]));
    if (cuenta.consultar) c.appendChild(el('p', { class: 'ped-total-nota', texto: T.sin_consultar }));
    c.appendChild(el('p', { class: 'ped-com-alergias', texto: T.alergias }));

    var hecho = el('button', { type: 'button', class: 'btn btn-p' }, [el('span', { texto: T.hecho })]);
    /* Se vacía cuando las dos hojas se han ido: si no, se verían quedarse en
       blanco mientras bajan. */
    hecho.addEventListener('click', function () {
      var quedan = 2;
      var despues = function () { if (--quedan === 0) vacia(T.vaciada); };
      hComanda.cierra(null, despues);
      hLista.cierra(null, despues);
    });
    pie.appendChild(hecho);
  }

  /* ------------------------------------------------------------------ */
  /* Arranque                                                            */
  /* ------------------------------------------------------------------ */
  document.body.classList.add('ped-activo');
  pinta();
})();
