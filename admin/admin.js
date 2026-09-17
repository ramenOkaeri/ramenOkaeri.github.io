/* Panel de la carta de Ramen Okaeri.
   Sin dependencias, igual que el resto del sitio: PostgREST y GoTrue son dos
   APIs REST y no hacen falta 60 KB de librería para hablar con ellas.

   ESTA ES LA ÚNICA PÁGINA DEL SITIO QUE HABLA CON UN TERCERO. La web pública
   no toca Supabase: lee el HTML que tools/carta.mjs horneó al construir. Por
   eso el visitante sigue sin cookies, sin almacenamiento y sin peticiones fuera
   del dominio, y esa propiedad no se pierde por tener un panel.

   UN SOLO ARCHIVO A PROPÓSITO. build.mjs le pone la huella del contenido en la
   URL (admin.js?v=…). Partirlo en módulos con import dejaría archivos sin huella,
   y volvería el fallo de caché de septiembre: HTML nuevo con JavaScript viejo.

   Cómo está ordenado:
     1 · utilidades, iconos, avisos y errores
     2 · red y sesión
     3 · datos, orden de la carta y búsqueda
     4 · qué falta por publicar, y el seguimiento de una publicación
     5 · rutas con #, diálogos y hojas
     6 · piezas de formulario
     7 · pantallas: entrada, platos, ficha, revisión de alérgenos
     8 · pantallas: publicar, historial y ajustes
     9 · arranque

   Rehecho el 17 de septiembre de 2026 a partir de una auditoría medida: la
   nota «Web de Ramen Okaeri» de la bóveda cuenta qué fallaba y cómo se midió. */
(function () {
  'use strict';

  /* ================================================================== */
  /* 1 · utilidades, iconos, avisos y errores                           */
  /* ================================================================== */

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var IDIOMAS = ['es', 'en', 'gl'];
  var NOMBRE_IDIOMA = { es: 'español', en: 'inglés', gl: 'gallego' };
  var CLAVE_SESION = 'okaeri.panel.sesion';
  var CLAVE_SEGUIMIENTO = 'okaeri.panel.seguimiento';
  var noop = function () {};

  var cfg = null;
  var sesion = null;
  var estado = null;
  var idx = null;

  var cuenta = 0;
  var nuevoId = function (p) { cuenta += 1; return (p || 'c') + '-' + cuenta; };

  function el(tag, props, hijos) {
    var e = document.createElement(tag);
    for (var k in props || {}) {
      var v = props[k];
      if (k === 'clase') e.className = v;
      else if (k === 'texto') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
    }
    (hijos || []).forEach(function (h) {
      if (h === null || h === undefined || h === false) return;
      e.appendChild(typeof h === 'string' ? document.createTextNode(h) : h);
    });
    return e;
  }

  var t = function (o, l) { return (o && (o[l || 'es'] || o.es)) || ''; };
  var copia = function (o) { return Object.assign({}, o || {}); };
  var pliega = function (s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  };
  var minusc = function (s) { return s ? s.charAt(0).toLocaleLowerCase('es') + s.slice(1) : s; };

  /* «el nombre, el precio y la foto» */
  function enumera(cosas) {
    if (cosas.length < 2) return cosas.join('');
    return cosas.slice(0, -1).join(', ') + ' y ' + cosas[cosas.length - 1];
  }
  var plural = function (n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); };

  /* --- precios ---
     El campo es de texto con inputmode="decimal", no type="number". Con number y
     step="0.05" no entraba 2,99 («Los dos valores válidos más aproximados son
     2,95 y 3»), y en un iPhone con el teclado en español la coma no está
     garantizada. Aquí entran «12,95», «12.95» y «12,95 €». */
  function leePrecio(s) {
    s = String(s == null ? '' : s).replace(/\s|€/g, '');
    if (!s) return null;
    if (!/^\d{1,4}([.,]\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s.replace(',', '.')) * 100) / 100;
  }
  var escribePrecio = function (n) { return n == null || isNaN(n) ? '' : Number(n).toFixed(2).replace('.', ','); };
  var eur = function (n) { return n == null ? 'a consultar' : escribePrecio(n) + ' €'; };

  function slugifica(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }
  /* Un slug repetido era un 23505 crudo en pantalla («duplicate key value
     violates unique constraint»). Se evita antes de que pase. */
  function slugUnico(base, usados) {
    base = base || 'sin-nombre';
    if (usados.indexOf(base) === -1) return base;
    for (var i = 2; ; i++) if (usados.indexOf(base + '-' + i) === -1) return base + '-' + i;
  }

  function fecha(iso) {
    try {
      return new Date(iso).toLocaleString('es-ES',
        { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    } catch (e) { return iso; }
  }
  function dia(iso) {
    try {
      return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' });
    } catch (e) { return iso; }
  }

  /* JSON con las claves ordenadas: dos objetos iguales dan la misma cadena
     aunque Postgres y el archivo publicado ordenen distinto. */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canon(v[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  /* Un texto por idioma sin las claves vacías. Guardar {"es":"X","en":""} o
     {"es":"X"} tiene que ser lo mismo, o el panel vería cambios que no hay. */
  function limpiaTexto(o) {
    var r = {};
    Object.keys(o || {}).forEach(function (k) {
      if (typeof o[k] === 'string' && o[k].trim()) r[k] = o[k];
    });
    return r;
  }
  var tieneTexto = function (o) { return Object.keys(limpiaTexto(o)).length > 0; };

  /* --- iconos ---
     Los de la carta (pl-*, alg-*, esc-*) los incrusta build.mjs una vez en
     admin/index.html. Estos cuatro son solo del panel y van aquí. */
  var SVG = 'http://www.w3.org/2000/svg';
  var ICONOS_PANEL =
    '<svg class="oculto" aria-hidden="true" focusable="false"><defs>' +
    '<g id="pn-publicar"><path d="M16 21V6"/><path d="M9.5 12.5 16 6l6.5 6.5"/><path d="M6 20v5.5h20V20"/></g>' +
    '<g id="pn-historial"><path d="M6.5 16a9.5 9.5 0 1 0 2.8-6.7"/><path d="M6.5 5.5v4.8h4.8"/><path d="M16 10.5V16l3.8 2.4"/></g>' +
    '<g id="pn-ajustes"><path d="M5.5 10h12M23 10h3.5"/><circle cx="20.2" cy="10" r="2.8"/><path d="M5.5 22h3.5M14.6 22h11.9"/><circle cx="11.8" cy="22" r="2.8"/></g>' +
    '<g id="pn-mas"><path d="M16 7v18M7 16h18"/></g>' +
    '<g id="pn-atras"><path d="M19.5 7 10.5 16l9 9"/></g>' +
    '<g id="pn-cerrar"><path d="M9 9l14 14M23 9 9 23"/></g>' +
    '<g id="pn-ojo"><path d="M3.5 16S8 8.5 16 8.5 28.5 16 28.5 16 24 23.5 16 23.5 3.5 16 3.5 16Z"/><circle cx="16" cy="16" r="3.8"/></g>' +
    '<g id="pn-fuera"><path d="M19 6h7v7"/><path d="M26 6 15 17"/><path d="M22.5 18.5V26h-16V10H14"/></g>' +
    '<g id="pn-arriba"><path d="M9 19.5 16 12.5l7 7"/></g>' +
    '<g id="pn-abajo"><path d="M9 12.5 16 19.5l7-7"/></g>' +
    '<g id="pn-bien"><path d="M7 16.5l6 6 12-13"/></g>' +
    '<g id="pn-aviso"><path d="M16 5 3.5 27h25Z"/><path d="M16 13v6.5M16 23.2v.3"/></g>' +
    '<g id="pn-derecha"><path d="M12.5 7l9 9-9 9"/></g>' +
    '</defs></svg>';

  function ico(id, clase) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('class', 'ico' + (clase ? ' ' + clase : ''));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    var u = document.createElementNS(SVG, 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }

  /* --- avisos ---
     Antes: un <p> fijo abajo, sin role ni aria-live, y un setTimeout que nadie
     cancelaba. Un error que llegaba un segundo después de un «Guardado» se
     borraba con el temporizador del aviso anterior (medido: desaparecía antes de
     5,5 s). Ahora hay un aviso a la vez, cada uno cancela el reloj del de antes,
     los errores no se van solos y los normales se leen por #anuncio. */
  var avisoActual = null;
  var avisoReloj = null;

  function aviso(msg, opciones) {
    opciones = opciones || {};
    var tipo = opciones.tipo || 'ok';
    cierraAviso();
    var accion = opciones.accion
      ? el('button', { type: 'button', clase: 'aviso-accion', texto: opciones.textoAccion || 'Deshacer',
          onclick: function () { cierraAviso(); opciones.accion(); } })
      : null;
    var caja = el('div', { clase: 'aviso aviso-' + tipo + (accion ? ' aviso-contexto' : ''), role: tipo === 'error' ? 'alert' : null }, [
      el('p', { clase: 'aviso-txt', texto: msg }),
      accion,
      el('button', { type: 'button', clase: 'aviso-cierra', 'aria-label': 'Cerrar el aviso', onclick: cierraAviso },
        [ico('pn-cerrar')])
    ]);
    /* Mientras se tiene el dedo o el foco encima, no se va. */
    var para = function () { if (avisoReloj) { clearTimeout(avisoReloj); avisoReloj = null; } };
    caja.addEventListener('pointerenter', para);
    caja.addEventListener('focusin', para);
    $('#avisos').appendChild(caja);
    avisoActual = caja;
    if (tipo !== 'error') {
      anuncia(msg);
      avisoReloj = setTimeout(cierraAviso, accion ? 8000 : 5000);
    }
  }
  function cierraAviso() {
    if (avisoReloj) { clearTimeout(avisoReloj); avisoReloj = null; }
    if (avisoActual) { avisoActual.remove(); avisoActual = null; }
  }
  /* Al cambiar de pantalla se van los errores y los avisos con «Deshacer»: los dos
     hablan de la pantalla anterior. Un «Guardado» sí se queda, porque se
     enseña justo antes de volver a la lista y es ahí donde se tiene que leer. */
  function limpiaAvisosDeContexto() {
    if (avisoActual && (avisoActual.classList.contains('aviso-error') || avisoActual.classList.contains('aviso-contexto'))) cierraAviso();
  }

  var anuncioReloj = null;
  function anuncia(texto, espera) {
    var a = $('#anuncio');
    if (!a) return;
    if (anuncioReloj) clearTimeout(anuncioReloj);
    anuncioReloj = setTimeout(function () { a.textContent = texto; }, espera || 80);
    a.textContent = '';
  }

  /* --- errores ---
     Lo que ve el restaurante, en castellano. Antes llegaban tal cual: «Invalid
     login credentials», «duplicate key value violates unique constraint». */
  var MENSAJES = {
    sin_permiso: 'Esta cuenta no puede cambiar la carta. Pídele a Yixuan que le dé permiso.',
    sin_nombre: 'Falta el nombre en español.',
    sin_precio: 'Falta el precio. Pon uno o marca «Precio a consultar».',
    sin_slug: 'Falta el identificador interno. Recarga la página y vuelve a probar.',
    plato_no_existe: 'Ese plato ya no existe. Recarga la página.',
    grupo_no_existe: 'Ese grupo ya no existe. Recarga la página.'
  };

  function traduceError(x) {
    if (!x) return 'Algo ha fallado.';
    var m = String(x.message || '');
    var n;
    if (x.propio) return m;
    if (x.hint === 'okaeri' && MENSAJES[m]) return MENSAJES[m];
    if (x.red) return 'No hay conexión. No se ha guardado nada: vuelve a intentarlo.';
    if (x.codigo === 'PGRST202') return 'Falta aplicar la migración 0005 en Supabase. Avisa a Yixuan.';
    if (/invalid login credentials|invalid_grant/i.test(m)) return 'El correo o la contraseña no son correctos.';
    if (/email not confirmed/i.test(m)) return 'Esa cuenta todavía no está confirmada.';
    if (x.estado === 429 || /rate limit|too many/i.test(m)) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
    if ((n = m.match(/Hay (\d+) plato\(s\) con un valor por encima de (\d+)/))) {
      return 'Hay ' + plural(Number(n[1]), 'plato', 'platos') + ' con un nivel por encima de ' + n[2] +
        '. Bájaselo antes de acortar la escala.';
    }
    if (/se sale de la escala/.test(m)) return 'Ese nivel se sale de la escala.';
    if (/dos niveles/.test(m)) return 'Una subcategoría no puede tener otras dentro: solo hay dos niveles.';
    if (/propia madre/.test(m)) return 'Una categoría no puede ir dentro de sí misma.';
    if (x.codigo === '23505') return 'Ya hay otro con ese nombre. Cámbialo un poco.';
    if (x.codigo === '23503') return 'No se puede: todavía hay platos que lo usan.';
    if (x.codigo === '42501' || x.estado === 403) return 'Esta cuenta no puede cambiar la carta.';
    if (x.estado === 413) return 'El archivo es demasiado grande para el servidor.';
    if (x.estado >= 500) return 'Supabase no responde ahora mismo. Espera un poco y vuelve a probar.';
    return m || 'Algo ha fallado.';
  }

  /* ================================================================== */
  /* 2 · red y sesión                                                   */
  /* ================================================================== */

  function fallo(res, d) {
    var m = d && typeof d === 'object'
      ? (d.message || d.error_description || d.msg || d.error)
      : (typeof d === 'string' ? d : '');
    var e = new Error(m || ('HTTP ' + res.status));
    e.estado = res.status;
    if (d && typeof d === 'object') { e.codigo = d.code; e.hint = d.hint; }
    return e;
  }
  function caida(x) {
    var e = new Error('Sin conexión');
    e.red = true;
    e.original = x;
    return e;
  }

  /* PostgREST contesta 200 con el cuerpo vacío cuando le pides return=minimal,
     no 204. Se lee como texto y se parsea solo si trae algo. */
  function cuerpo(res) {
    return res.text().then(function (txt) {
      if (!txt.trim()) return null;
      try { return JSON.parse(txt); } catch (e) { return txt; }
    });
  }

  /* El 401 se reintenta UNA vez: sin la marca, un token que no renueva daba
     vueltas para siempre. */
  function api(ruta, opciones, reintento) {
    opciones = opciones || {};
    var h = Object.assign({ apikey: cfg.anon, 'Content-Type': 'application/json' }, opciones.headers || {});
    if (sesion && sesion.access_token) h.Authorization = 'Bearer ' + sesion.access_token;
    return fetch(cfg.url + ruta, Object.assign({}, opciones, { headers: h }))
      .catch(function (x) { throw caida(x); })
      .then(function (res) {
        return cuerpo(res).then(function (d) {
          if (res.status === 401 && sesion && !reintento) {
            return refresca().then(function () { return api(ruta, opciones, true); });
          }
          if (!res.ok) throw fallo(res, d);
          return d;
        });
      });
  }

  var lee = function (tabla, q) { return api('/rest/v1/' + tabla + '?' + (q || 'select=*')); };
  var rpc = function (nombre, args) {
    return api('/rest/v1/rpc/' + nombre, { method: 'POST', body: JSON.stringify(args || {}) });
  };
  var inserta = function (tabla, filas) {
    return api('/rest/v1/' + tabla, {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(filas)
    });
  };
  var parchea = function (tabla, filtro, datos) {
    return api('/rest/v1/' + tabla + '?' + filtro, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(datos)
    });
  };
  var elimina = function (tabla, filtro) {
    return api('/rest/v1/' + tabla + '?' + filtro, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  };

  /* La Edge Function que dispara el flujo de GitHub. Sus errores ya vienen en
     castellano («Esa cuenta no puede publicar.»), así que se enseñan tal cual. */
  function publicarEnGithub(cuerpoJson) {
    return fetch(cfg.publicar, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sesion.access_token, apikey: cfg.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoJson || {})
    }).catch(function (x) { throw caida(x); }).then(function (r) {
      return cuerpo(r).then(function (d) {
        if (!r.ok) {
          var e = new Error((d && d.error) || 'No se ha podido lanzar la publicación.');
          e.propio = true;
          throw e;
        }
        return d;
      });
    });
  }

  /* --- sesión --- */
  function guardaSesion(s) {
    sesion = s;
    try { localStorage.setItem(CLAVE_SESION, JSON.stringify(s)); } catch (e) { /* modo privado */ }
  }
  function olvidaSesion() {
    sesion = null;
    try { localStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ }
  }
  function entra(correo, clave) {
    return fetch(cfg.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave })
    }).catch(function (x) { throw caida(x); }).then(function (r) {
      return cuerpo(r).then(function (d) {
        if (!r.ok) throw fallo(r, d);
        guardaSesion(d);
        return d;
      });
    });
  }

  /* UNA renovación a la vez. Al abrir el panel salen doce lecturas en paralelo, y
     si el token había caducado cada 401 lanzaba su propia renovación con el
     mismo refresh_token. Ahora todas esperan a la misma promesa. */
  var renovacion = null;
  function refresca() {
    if (renovacion) return renovacion;
    if (!sesion || !sesion.refresh_token) return Promise.reject(new Error('Sin sesión'));
    renovacion = fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sesion.refresh_token })
    }).catch(function (x) { throw caida(x); }).then(function (r) {
      return cuerpo(r).then(function (d) {
        if (!r.ok) {
          olvidaSesion();
          pintaEntrada('La sesión ha caducado. Vuelve a entrar.');
          throw fallo(r, d);
        }
        guardaSesion(d);
        return d;
      });
    }).then(function (d) { renovacion = null; return d; }, function (x) { renovacion = null; throw x; });
    return renovacion;
  }

  /* Salir cierra ESTA sesión también en Supabase (scope=local), no solo en el
     navegador. Con scope global echaría también al móvil del restaurante. */
  function sal() {
    compruebaSalida().then(function (ok) {
      if (!ok) return;
      var token = sesion && sesion.access_token;
      if (token) {
        fetch(cfg.url + '/auth/v1/logout?scope=local', {
          method: 'POST', headers: { apikey: cfg.anon, Authorization: 'Bearer ' + token }
        }).catch(noop);
      }
      olvidaSesion();
      paraSeguimiento();
      estado = null;
      pintaEntrada();
    });
  }

  /* --- el buzón del PDF ---
     Subir el PDF es un fetch pelado: api() fuerza Content-Type JSON y aquí el
     cuerpo va en binario. No viaja por la Edge Function porque pesa 2,2 MB y el
     client_payload de GitHub tope en unos 64 KB. */
  var TOPE_PDF = 8 * 1024 * 1024;

  function subeBinario(ruta, blob, tipo, reintento) {
    return fetch(cfg.url + ruta, {
      method: 'POST',
      headers: {
        apikey: cfg.anon,
        Authorization: 'Bearer ' + sesion.access_token,
        'Content-Type': tipo,
        /* Sin esto, subir otro con el mismo nombre da 409. */
        'x-upsert': 'true'
      },
      body: blob
    }).catch(function (x) { throw caida(x); }).then(function (r) {
      return cuerpo(r).then(function (d) {
        if (r.status === 401 && sesion && !reintento) {
          return refresca().then(function () { return subeBinario(ruta, blob, tipo, true); });
        }
        if (!r.ok) throw fallo(r, d);
        return d;
      });
    });
  }

  function subePdf(archivo) {
    return new Promise(function (resolver, rechazar) {
      if (archivo.type && archivo.type !== 'application/pdf') {
        return rechazar(Object.assign(new Error('Eso no es un PDF.'), { propio: true }));
      }
      if (archivo.size > TOPE_PDF) {
        return rechazar(Object.assign(new Error('Ese PDF pesa ' + (archivo.size / 1048576).toFixed(1).replace('.', ',') +
          ' MB y el tope son 8. Compáctalo antes de subirlo.'), { propio: true }));
      }
      /* Los cuatro primeros bytes de un PDF son %PDF. Se miran aquí para no
         gastar ocho megas de subida y que lo rechace el servidor al final. */
      var lector = new FileReader();
      lector.onerror = function () { rechazar(Object.assign(new Error('No se ha podido leer el archivo.'), { propio: true })); };
      lector.onload = function () {
        var b = new Uint8Array(lector.result);
        if (b[0] !== 0x25 || b[1] !== 0x50 || b[2] !== 0x44 || b[3] !== 0x46) {
          rechazar(Object.assign(new Error('Eso no es un PDF de verdad: no empieza por %PDF.'), { propio: true }));
        } else resolver();
      };
      lector.readAsArrayBuffer(archivo.slice(0, 4));
    }).then(function () {
      return subeBinario('/storage/v1/object/buzon/menu.pdf', archivo, 'application/pdf');
    });
  }

  function miraBuzon() {
    return api('/storage/v1/object/list/buzon', {
      method: 'POST', body: JSON.stringify({ prefix: '', limit: 5 })
    }).then(function (l) {
      return (l || []).filter(function (o) { return o.name === 'menu.pdf'; })[0] || null;
    });
  }

  /* ================================================================== */
  /* 3 · datos, orden de la carta y búsqueda                            */
  /* ================================================================== */

  function cargaTodo() {
    return Promise.all([
      lee('categorias', 'select=*&order=orden'),
      lee('platos', 'select=*&order=orden'),
      lee('alergenos', 'select=*&order=orden'),
      lee('etiquetas', 'select=*&order=orden'),
      lee('escalas', 'select=*&order=orden'),
      lee('grupos_opcion', 'select=*&order=orden'),
      lee('opciones', 'select=*&order=orden'),
      lee('plato_precios', 'select=*&order=orden'),
      lee('plato_alergenos', 'select=*'),
      lee('plato_etiquetas', 'select=*'),
      lee('plato_escalas', 'select=*'),
      lee('plato_grupos', 'select=*&order=orden')
    ]).then(function (r) {
      estado = {
        categorias: r[0], platos: r[1], alergenos: r[2], etiquetas: r[3], escalas: r[4],
        grupos: r[5], opciones: r[6], precios: r[7], palergenos: r[8], petiquetas: r[9],
        pescalas: r[10], pgrupos: r[11]
      };
      indexa();
    });
  }

  var porOrden = function (a, b) {
    return (a.orden || 0) - (b.orden || 0) || t(a.nombre).localeCompare(t(b.nombre), 'es');
  };

  function indexa() {
    var cat = {};
    estado.categorias.forEach(function (c) { cat[c.id] = c; });
    var madres = estado.categorias.filter(function (c) { return !c.padre_id || !cat[c.padre_id]; }).sort(porOrden);
    var hijas = {};
    madres.forEach(function (m) {
      hijas[m.id] = estado.categorias.filter(function (c) { return c.padre_id === m.id; }).sort(porOrden);
    });
    idx = { cat: cat, madres: madres, hijas: hijas };
  }

  var catDe = function (p) { return idx.cat[p.categoria_id] || null; };
  var madreDe = function (c) { return c && c.padre_id ? idx.cat[c.padre_id] || null : null; };
  function nombreCat(c) {
    if (!c) return 'Sin categoría';
    var m = madreDe(c);
    return (m ? t(m.nombre) + ' · ' : '') + t(c.nombre);
  }

  /* La columna alergenos_revisados llega con la migración 0005. Si todavía no
     está aplicada, la revisión de alérgenos no se enseña en vez de romperse. */
  var hayRevision = function () {
    return !!(estado && estado.platos.length && 'alergenos_revisados' in estado.platos[0]);
  };

  /* Las secciones EN EL ORDEN DE LA CARTA. Antes la lista iba por orden
     alfabético del nombre («Arroces … Postres › Ramen › Tapas») y el ramen, que
     abre la carta, salía el noveno de doce. Es el mismo orden que carta_json():
     madre, luego sus hijas por su orden y al final lo que cuelga de la madre. */
  function secciones() {
    var lista = [];
    idx.madres.forEach(function (m) {
      (idx.hijas[m.id] || []).forEach(function (h) { lista.push(h); });
      lista.push(m);
    });
    return lista.map(function (c) {
      return {
        cat: c,
        titulo: nombreCat(c),
        platos: estado.platos.filter(function (p) { return p.categoria_id === c.id; }).sort(porOrden)
      };
    }).filter(function (s) { return s.platos.length; });
  }
  function platosEnOrden() {
    return secciones().reduce(function (acc, s) { return acc.concat(s.platos); }, []);
  }

  var preciosDe = function (p) {
    return estado.precios.filter(function (x) { return x.plato_id === p.id; }).sort(porOrden);
  };
  function textoPrecios(p) {
    var ps = preciosDe(p);
    if (!ps.length) return 'Sin precio';
    return ps.map(function (x) { return (x.etiqueta ? t(x.etiqueta) + ' ' : '') + eur(x.precio); }).join(' · ');
  }

  /* Tildes fuera y todas las palabras, calcado de la carta pública
     (js/main.js). Antes «bambu» daba 0 y «gyoza pollo» también. */
  function textoBusqueda(p) {
    return pliega([p.numero || ''].concat(IDIOMAS.map(function (l) { return (p.nombre || {})[l] || ''; }),
      [(p.descripcion || {}).es || '']).join(' '));
  }
  function casa(p, palabras) {
    if (!palabras.length) return true;
    var txt = textoBusqueda(p);
    return palabras.every(function (w) { return txt.indexOf(w) !== -1; });
  }

  /* ================================================================== */
  /* 4 · qué falta por publicar, y el seguimiento de una publicación    */
  /* ================================================================== */

  /* ANTES: se comparaba la fecha del último cambio con la de
     assets/version.json. Pero el cron de reseñas reescribía esa fecha cada
     mañana, así que un cambio de la noche anterior salía como «Todo publicado».
     Y los borrados, los niveles, las etiquetas y las opciones no llevan fecha.
     AHORA se compara el CONTENIDO: la carta que saldría de Supabase
     (rpc/carta_json) contra la que hay publicada (/content/carta.json). */
  function normalizaCarta(c) {
    if (!c) return null;
    var tx = limpiaTexto;
    var num = function (n) { return n == null ? null : Number(n); };
    return {
      alergenos: (c.alergenos || []).map(function (a) { return { slug: a.slug, nombre: tx(a.nombre) }; }),
      etiquetas: (c.etiquetas || []).map(function (e) {
        return { slug: e.slug, nombre: tx(e.nombre), icono: e.icono || null };
      }),
      escalas: (c.escalas || []).map(function (e) {
        return { slug: e.slug, nombre: tx(e.nombre), maximo: num(e.maximo), icono: e.icono || null };
      }),
      grupos: (c.grupos || []).map(function (g) {
        return {
          slug: g.slug, nombre: tx(g.nombre), tipo: g.tipo, obligatorio: !!g.obligatorio,
          opciones: (g.opciones || []).map(function (o) {
            return { slug: o.slug, nombre: tx(o.nombre), incremento: num(o.incremento) };
          })
        };
      }),
      categorias: (c.categorias || []).map(function (m) {
        return {
          slug: m.slug, nombre: tx(m.nombre), descripcion: tx(m.descripcion), icono: m.icono || null,
          hijas: (m.hijas || []).map(function (h) {
            return { slug: h.slug, nombre: tx(h.nombre), descripcion: tx(h.descripcion), icono: h.icono || null };
          })
        };
      }),
      platos: (c.platos || []).map(function (p) {
        return {
          slug: p.slug, numero: p.numero || null, categoria: p.categoria,
          nombre: tx(p.nombre), descripcion: tx(p.descripcion), nota: tx(p.nota),
          imagen: p.imagen || null,
          precios: (p.precios || []).map(function (x) {
            return { etiqueta: x.etiqueta ? tx(x.etiqueta) : null, precio: num(x.precio) };
          }),
          alergenos: (p.alergenos || []).map(function (a) { return a.slug + ':' + (a.grado || 'contiene'); }).sort(),
          etiquetas: (p.etiquetas || []).slice().sort(),
          escalas: (p.escalas || []).map(function (e) { return e.slug + ':' + e.valor; }).sort(),
          grupos: (p.grupos || []).slice()
        };
      })
    };
  }

  var CAMPOS_PLATO = [
    ['nombre', 'el nombre'], ['descripcion', 'la descripción'], ['nota', 'la nota'], ['numero', 'el número'],
    ['categoria', 'la categoría'], ['precios', 'el precio'], ['alergenos', 'los alérgenos'],
    ['etiquetas', 'las etiquetas'], ['escalas', 'los niveles'], ['grupos', 'las opciones'], ['imagen', 'la foto']
  ];

  function comparaCartas(publicada, guardada) {
    var a = normalizaCarta(publicada), b = normalizaCarta(guardada);
    var cambios = [];
    if (!a || !b) return cambios;
    var mapa = function (lista) { var m = {}; lista.forEach(function (x) { m[x.slug] = x; }); return m; };
    var nombre = function (x) { return (x.nombre && x.nombre.es) || x.slug; };

    function compara(grupo, lista1, lista2, campos, etiqueta) {
      var m1 = mapa(lista1), m2 = mapa(lista2);
      lista2.forEach(function (x) {
        var y = m1[x.slug];
        if (!y) { cambios.push({ grupo: grupo, slug: x.slug, nombre: etiqueta(x), que: 'se añade' }); return; }
        var que = campos.filter(function (c) { return canon(y[c[0]]) !== canon(x[c[0]]); })
          .map(function (c) { return c[1]; });
        if (que.length) cambios.push({ grupo: grupo, slug: x.slug, nombre: etiqueta(x), que: 'cambia ' + enumera(que) });
      });
      lista1.forEach(function (y) {
        if (!m2[y.slug]) cambios.push({ grupo: grupo, slug: y.slug, nombre: etiqueta(y), que: 'se quita', quitado: true });
      });
      var o1 = lista1.map(function (x) { return x.slug; }).filter(function (s) { return m2[s]; }).join('|');
      var o2 = lista2.map(function (x) { return x.slug; }).filter(function (s) { return m1[s]; }).join('|');
      return o1 !== o2;
    }

    if (compara('platos', a.platos, b.platos, CAMPOS_PLATO, nombre)) {
      cambios.push({ grupo: 'platos', nombre: 'El orden de los platos', que: 'cambia' });
    }
    /* Un plato que se quita de la carta desaparece de carta_json(): para quien
       lo lee, «sale de la carta» y no «se quita». */
    cambios.forEach(function (c) {
      if (c.grupo === 'platos' && c.quitado) c.que = 'sale de la carta';
      if (c.grupo === 'platos' && c.que === 'se añade') c.que = 'entra en la carta';
    });

    var aplana = function (cats) {
      var r = [];
      cats.forEach(function (m) {
        r.push({ slug: m.slug, nombre: m.nombre, descripcion: m.descripcion, icono: m.icono, dentro: null });
        m.hijas.forEach(function (h) {
          r.push({ slug: h.slug, nombre: h.nombre, descripcion: h.descripcion, icono: h.icono, dentro: m.slug });
        });
      });
      return r;
    };
    if (compara('categorias', aplana(a.categorias), aplana(b.categorias),
      [['nombre', 'el nombre'], ['descripcion', 'la descripción'], ['icono', 'el marcador'], ['dentro', 'dónde va']],
      function (x) { return 'Sección «' + nombre(x) + '»'; })) {
      cambios.push({ grupo: 'categorias', nombre: 'El orden de las secciones', que: 'cambia' });
    }
    compara('grupos', a.grupos, b.grupos,
      [['nombre', 'el nombre'], ['tipo', 'cómo se elige'], ['obligatorio', 'si es obligatorio'], ['opciones', 'las opciones']],
      function (x) { return 'Opciones «' + nombre(x) + '»'; });
    compara('etiquetas', a.etiquetas, b.etiquetas, [['nombre', 'el nombre'], ['icono', 'el icono']],
      function (x) { return 'Etiqueta «' + nombre(x) + '»'; });
    compara('escalas', a.escalas, b.escalas,
      [['nombre', 'el nombre'], ['maximo', 'el máximo'], ['icono', 'el icono']],
      function (x) { return 'Nivel «' + nombre(x) + '»'; });
    compara('alergenos', a.alergenos, b.alergenos, [['nombre', 'el nombre']],
      function (x) { return 'Alérgeno «' + nombre(x) + '»'; });
    return cambios;
  }

  /* La misma comprobación que .github/workflows/carta.yml hace antes de
     publicar. Si algo de esto falla, el flujo rechaza la carta ENTERA y no se
     publica nada; mejor decirlo aquí, con el plato que hay que arreglar. */
  function problemasDe(carta) {
    var lista = [];
    var platos = (carta && carta.platos) || [];
    if (platos.length < 10) {
      lista.push({ texto: 'La carta solo tiene ' + plural(platos.length, 'plato', 'platos') +
        ' a la vista, y el flujo pide al menos 10.' });
    }
    if (!((carta && carta.categorias) || []).length) lista.push({ texto: 'No hay ninguna sección activa.' });
    if (((carta && carta.alergenos) || []).length !== 14) lista.push({ texto: 'La lista de alérgenos no tiene los 14.' });
    platos.forEach(function (p) {
      var n = (p.nombre && p.nombre.es) || p.slug;
      if (!(p.nombre && p.nombre.es)) lista.push({ texto: 'Un plato no tiene nombre en español.', slug: p.slug });
      if (!(p.precios || []).length) lista.push({ texto: '«' + n + '» no tiene precio.', slug: p.slug });
    });
    return lista;
  }

  var pub = { datos: null, error: null, promesa: null };

  function leePublicada() {
    return fetch('/content/carta.json?t=' + Date.now(), { cache: 'no-store' })
      .catch(function (x) { throw caida(x); })
      .then(function (r) {
        if (!r.ok) throw Object.assign(new Error('No se ha podido leer la carta publicada.'), { propio: true });
        return r.json();
      });
  }

  function calculaPendientes() {
    if (pub.promesa) return pub.promesa;
    pub.promesa = Promise.all([rpc('carta_json'), leePublicada(), miraBuzon()]).then(function (r) {
      var cambios = comparaCartas(r[1], r[0]);
      pub.datos = {
        cambios: cambios, pdf: r[2], db: r[0],
        total: cambios.length + (r[2] ? 1 : 0),
        problemas: problemasDe(r[0])
      };
      pub.error = null;
      return pub.datos;
    }).then(function (d) {
      pub.promesa = null; pintaEstadoPub(); return d;
    }, function (x) {
      pub.promesa = null; pub.error = x; pintaEstadoPub(); throw x;
    });
    return pub.promesa;
  }

  var relojPendientes = null;
  function recalculaPronto() {
    clearTimeout(relojPendientes);
    relojPendientes = setTimeout(function () { calculaPendientes().catch(noop); }, 500);
  }

  /* --- el seguimiento ---
     Antes, tras pulsar Publicar el panel decía «En un minuto o dos estará en la
     web» y no volvía a mirar: si el flujo rechazaba la carta, nadie se enteraba.
     Ahora se guarda la carta que se mandó y se mira cada 15 s si la publicada ya
     es esa (y si el buzón del PDF se ha vaciado). Vive en sessionStorage para
     que recargar la página no lo pierda. */
  var seguimiento = null;
  var sondeoReloj = null;
  var LIMITE = { publicar: 8 * 60000, restaurar: 10 * 60000 };

  function guardaSeguimiento() {
    try {
      if (seguimiento) sessionStorage.setItem(CLAVE_SEGUIMIENTO, JSON.stringify(seguimiento));
      else sessionStorage.removeItem(CLAVE_SEGUIMIENTO);
    } catch (e) { /* modo privado */ }
  }
  function reanudaSeguimiento() {
    try { seguimiento = JSON.parse(sessionStorage.getItem(CLAVE_SEGUIMIENTO) || 'null'); } catch (e) { seguimiento = null; }
    if (seguimiento && !seguimiento.resultado) programaSondeo(1000);
    pintaEstadoPub();
  }
  function paraSeguimiento() {
    clearTimeout(sondeoReloj);
    seguimiento = null;
    guardaSeguimiento();
  }
  function empiezaSeguimiento(s) {
    seguimiento = s;
    guardaSeguimiento();
    programaSondeo(15000);
    pintaEstadoPub();
  }
  function programaSondeo(ms) {
    clearTimeout(sondeoReloj);
    sondeoReloj = setTimeout(sondea, ms);
  }

  function sondea() {
    var s = seguimiento;
    if (!s || s.resultado) return;
    var pasado = Date.now() - s.desde;
    var paso;

    if (s.tipo === 'restaurar' && !s.objetivo) {
      /* Primero hay que ver que la vuelta atrás ha empezado: restaurar_publicacion
         guarda una copia «antes de restaurar» antes de tocar nada. Con eso, la
         base ya es la de aquel día y se sabe qué carta tiene que llegar. */
      paso = lee('publicaciones_lista', 'select=id,creado,motivo&limit=3').then(function (filas) {
        var empezada = (filas || []).some(function (f) {
          return f.motivo === 'antes de restaurar' && Date.parse(f.creado) > s.desde - 120000;
        });
        if (!empezada) return false;
        return rpc('carta_json').then(function (db) {
          s.objetivo = canon(normalizaCarta(db));
          guardaSeguimiento();
          return false;
        });
      });
    } else {
      paso = Promise.all([leePublicada(), s.pdf ? miraBuzon() : Promise.resolve(null)]).then(function (r) {
        return canon(normalizaCarta(r[0])) === s.objetivo && !r[1];
      });
    }

    paso.then(function (llegado) {
      if (seguimiento !== s) return;
      if (llegado) {
        s.resultado = 'ok';
        guardaSeguimiento();
        aviso(s.tipo === 'restaurar'
          ? 'La carta ha vuelto a la del ' + s.fecha + ' y ya está en la web.'
          : 'Ya está en la web.');
        var despues = s.tipo === 'restaurar' ? cargaTodo().then(function () { rutaActual = null; render(); }) : Promise.resolve();
        despues.then(function () { return calculaPendientes(); }).catch(noop);
        pintaEstadoPub();
        return;
      }
      if (pasado > LIMITE[s.tipo]) {
        s.resultado = 'tarde';
        guardaSeguimiento();
        pintaEstadoPub();
        return;
      }
      pintaEstadoPub();
      programaSondeo(15000);
    }).catch(function () {
      if (seguimiento !== s) return;
      if (pasado > LIMITE[s.tipo]) { s.resultado = 'tarde'; guardaSeguimiento(); pintaEstadoPub(); return; }
      programaSondeo(15000);
    });
  }

  /* ================================================================== */
  /* 5 · rutas con #, diálogos y hojas                                  */
  /* ================================================================== */

  /* Antes la pantalla vivía en una variable: el gesto de atrás del móvil sacaba
     del panel (medido: de la ficha a /menu/, sin avisar y con lo escrito
     perdido) y recargar devolvía a la lista. Ahora cada pantalla tiene su ruta:
       #/platos · #/plato/<slug> · #/plato/nuevo · #/alergenos[/<slug>]
       #/publicar · #/historial · #/ajustes[/categorias|niveles|opciones|etiquetas]
     y history.state lleva un índice para saber si «Volver» puede ir atrás. */
  var rutaActual = null;
  var ultimoIndice = 0;
  var guardia = null;   /* función que dice si la pantalla tiene cambios sin guardar */
  var estadoLista = { q: '', filtro: '', scroll: 0, foco: null };

  var rutaDeHash = function () {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    return h && h.charAt(0) === '/' ? h : '/platos';
  };
  var indiceHistoria = function () { return (history.state && history.state.i) || 0; };

  function compruebaSalida() {
    if (!guardia || !guardia()) return Promise.resolve(true);
    return confirma({
      titulo: 'Tienes cambios sin guardar',
      texto: 'Si sales ahora, se pierden.',
      si: 'Salir sin guardar', no: 'Seguir editando', peligro: true
    }).then(function (ok) { if (ok) guardia = null; return ok; });
  }

  function navega(ruta) {
    if (ruta === rutaActual) { render(); return; }
    compruebaSalida().then(function (ok) {
      if (!ok) return;
      history.pushState({ i: indiceHistoria() + 1 }, '', '#' + ruta);
      render();
    });
  }
  function reemplaza(ruta) {
    history.replaceState({ i: indiceHistoria() || 1 }, '', '#' + ruta);
    render();
  }
  /* «Volver» va atrás de verdad si se llegó desde otra pantalla del panel, y así
     el gesto de atrás y el botón hacen lo mismo. Si se entró por la URL, va a
     la pantalla por defecto sin dejar una entrada de más. */
  function vuelve(porDefecto) {
    if (indiceHistoria() > 1) { history.back(); return; }
    compruebaSalida().then(function (ok) { if (ok) reemplaza(porDefecto); });
  }

  function alCambiarRuta() {
    if (!estado) return;
    var destino = rutaDeHash();
    if (destino === rutaActual) return;
    if (!history.state || !history.state.i) {
      history.replaceState({ i: ultimoIndice + 1 }, '', location.hash);
    }
    if (guardia && guardia()) {
      /* Se vuelve a la ficha sin pintar nada y se pregunta. pushState no dispara
         ni popstate ni hashchange, así que no entra en bucle. */
      history.pushState({ i: indiceHistoria() + 1 }, '', '#' + rutaActual);
      compruebaSalida().then(function (ok) { if (ok) navega(destino); });
      return;
    }
    render();
  }
  window.addEventListener('popstate', alCambiarRuta);
  window.addEventListener('hashchange', alCambiarRuta);
  window.addEventListener('beforeunload', function (e) {
    if (guardia && guardia()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* --- el armazón --- */
  var DESTINOS = [
    { ruta: '/platos', texto: 'Platos', icono: 'pl-ramen' },
    { ruta: '/publicar', texto: 'Publicar', icono: 'pn-publicar' },
    { ruta: '/historial', texto: 'Historial', icono: 'pn-historial' },
    { ruta: '/ajustes', texto: 'Ajustes', icono: 'pn-ajustes' }
  ];
  var destinoDe = function (pantalla) {
    if (pantalla === 'plato' || pantalla === 'alergenos') return '/platos';
    return '/' + pantalla;
  };

  function pintaArmazon(pantalla, conAcciones) {
    var app = $('#app');
    app.textContent = '';
    document.body.className = 'pantalla-' + pantalla + (conAcciones ? ' con-acciones' : '');
    var activo = destinoDe(pantalla);

    app.appendChild(el('header', { clase: 'cab' }, [
      el('div', { clase: 'cab-marca' }, [el('strong', { texto: 'Ramen Okaeri' }), el('span', { texto: 'Panel de la carta' })]),
      el('div', { clase: 'cab-acc' }, [
        el('a', { clase: 'btn-t', href: '/menu/', target: '_blank', rel: 'noopener' },
          [el('span', { texto: 'Ver la carta' }), ico('pn-fuera', 'ico-peq'), el('span', { clase: 'oculto', texto: ' (se abre en otra pestaña)' })]),
        el('button', { type: 'button', clase: 'btn-t', texto: 'Salir', onclick: sal })
      ])
    ]));
    app.appendChild(el('div', { id: 'franja', clase: 'franja', hidden: true }));
    app.appendChild(el('nav', { clase: 'nav', 'aria-label': 'Secciones del panel' }, DESTINOS.map(function (d) {
      var actual = d.ruta === activo;
      return el('a', { href: '#' + d.ruta, clase: 'nav-i' + (actual ? ' activo' : ''), 'aria-current': actual ? 'page' : null }, [
        ico(d.icono),
        el('span', { clase: 'nav-txt', texto: d.texto }),
        d.ruta === '/publicar' ? el('span', { clase: 'nav-badge', 'data-badge': '', hidden: true }) : null
      ]);
    })));
    var cuerpoEl = el('main', { id: 'cuerpo', clase: 'cuerpo', tabindex: '-1' });
    app.appendChild(cuerpoEl);
    pintaEstadoPub();
    return cuerpoEl;
  }

  /* La franja de arriba y el número de la pestaña Publicar. Se repintan solos
     cuando cambia el cálculo, sin volver a pintar la pantalla. */
  var repintaPublicar = null;
  function pintaEstadoPub() {
    var badge = $('[data-badge]');
    var franja = $('#franja');
    var d = pub.datos;
    var enCurso = seguimiento && !seguimiento.resultado;
    var n = d ? d.total : 0;

    if (badge) {
      badge.hidden = !(n > 0 || enCurso);
      badge.textContent = enCurso ? '…' : (n > 0 ? String(n) : '');
      var enlace = badge.parentNode;
      var txt = enlace.querySelector('.nav-txt');
      if (txt) {
        txt.textContent = 'Publicar';
        var extra = enlace.querySelector('.oculto');
        if (extra) extra.remove();
        if (enCurso) enlace.appendChild(el('span', { clase: 'oculto', texto: ', publicando' }));
        else if (n > 0) enlace.appendChild(el('span', { clase: 'oculto', texto: ', ' + plural(n, 'cambio sin publicar', 'cambios sin publicar') }));
      }
    }

    if (franja) {
      var pantalla = (rutaActual || '').split('/')[1];
      var contenido = null;
      if (pantalla === 'publicar' || pantalla === 'historial') contenido = null;
      else if (enCurso) {
        contenido = [el('span', { texto: seguimiento.tipo === 'restaurar'
          ? 'Volviendo a la carta del ' + seguimiento.fecha + '. No cambies nada hasta que termine.'
          : 'Publicando. Suele tardar un par de minutos.' }),
          el('a', { href: '#/publicar', texto: 'Ver' })];
      } else if (seguimiento && seguimiento.resultado === 'tarde') {
        contenido = [el('span', { texto: 'La publicación todavía no ha llegado a la web.' }),
          el('a', { href: '#/publicar', texto: 'Ver qué pasa' })];
      } else if (pub.error && !d) {
        contenido = [el('span', { texto: 'No se ha podido comprobar si hay cambios sin publicar.' }),
          el('button', { type: 'button', clase: 'btn-t', texto: 'Reintentar', onclick: function () { calculaPendientes().catch(noop); } })];
      } else if (n > 0) {
        contenido = [el('span', { texto: plural(n, 'cambio sin publicar', 'cambios sin publicar') + '.' }),
          el('a', { href: '#/publicar', texto: 'Revisar y publicar' })];
      }
      franja.textContent = '';
      franja.hidden = !contenido;
      franja.classList.toggle('franja-aviso', !!(seguimiento && seguimiento.resultado === 'tarde'));
      (contenido || []).forEach(function (c) { franja.appendChild(c); });
    }

    if (repintaPublicar) repintaPublicar();
  }

  /* --- diálogos ---
     <dialog> con showModal(): el foco queda dentro, Escape cierra y el fondo es
     inerte sin escribir ni una línea de eso. Antes eran divs: tocar fuera
     cerraba y descartaba sin avisar, Escape no hacía nada y el foco se quedaba en
     el botón de detrás. */
  function confirma(o) {
    return new Promise(function (resolver) {
      var idT = nuevoId('dt'), idD = nuevoId('dd');
      var d = el('dialog', { clase: 'dialogo', 'aria-labelledby': idT, 'aria-describedby': o.texto ? idD : null });
      var acciones = o.acciones || [
        { valor: false, texto: o.no || 'Cancelar', clase: 'btn btn-s' },
        { valor: true, texto: o.si || 'Aceptar', clase: o.peligro ? 'btn btn-peligro' : 'btn btn-p' }
      ];
      var hecho = false;
      var fin = function (v) {
        if (hecho) return;
        hecho = true;
        if (d.open) d.close();
        d.remove();
        resolver(v);
      };
      var botones = acciones.map(function (a) {
        return el('button', { type: 'button', clase: a.clase, texto: a.texto, onclick: function () { fin(a.valor); } });
      });
      d.appendChild(el('div', { clase: 'dialogo-dentro' }, [
        el('h2', { id: idT, texto: o.titulo }),
        o.texto ? el('p', { id: idD, texto: o.texto }) : null,
        el('div', { clase: 'dialogo-acc' }, botones)
      ]));
      var neutro = acciones.filter(function (a) { return a.valor === false || a.valor === null; })[0];
      d.addEventListener('cancel', function (e) { e.preventDefault(); fin(neutro ? neutro.valor : false); });
      d.addEventListener('click', function (e) { if (e.target === d) fin(neutro ? neutro.valor : false); });
      document.body.appendChild(d);
      d.showModal();
      /* En una pregunta peligrosa, el foco empieza en la salida segura. */
      var seguro = botones[acciones.indexOf(neutro)];
      if (seguro) seguro.focus();
    });
  }

  /* --- hojas ---
     Los editores de Ajustes. En el móvil ocupan la pantalla entera con las
     acciones fijas abajo; en el ordenador son una caja centrada. Cerrar con
     cambios (la X, Escape, tocar fuera o el gesto de atrás, que en Android llega
     como cancel) pregunta antes de tirar lo escrito. */
  function abreHoja(o) {
    var idT = nuevoId('ht');
    var d = el('dialog', { clase: 'hoja', 'aria-labelledby': idT });
    var cerrada = false;
    /* Mientras la hoja está abierta, su guardia es la de la pantalla: así el
       botón de atrás del navegador de un ordenador también pregunta. */
    var guardiaAnterior = guardia;
    guardia = function () { return !!(o.sucio && o.sucio()); };
    function cierra() {
      if (cerrada) return;
      cerrada = true;
      guardia = guardiaAnterior;
      if (d.open) d.close();
      d.remove();
      if (o.alCerrar) o.alCerrar();
    }
    function intentaCerrar() {
      if (o.sucio && o.sucio()) {
        confirma({ titulo: 'Tienes cambios sin guardar', texto: 'Si cierras ahora, se pierden.',
          si: 'Cerrar sin guardar', no: 'Seguir editando', peligro: true })
          .then(function (ok) { if (ok) cierra(); });
      } else cierra();
    }
    d.appendChild(el('div', { clase: 'hoja-dentro' }, [
      el('div', { clase: 'hoja-cab' }, [
        el('h2', { id: idT, texto: o.titulo }),
        el('button', { type: 'button', clase: 'btn-icono', 'aria-label': 'Cerrar', onclick: intentaCerrar }, [ico('pn-cerrar')])
      ]),
      el('div', { clase: 'hoja-cuerpo' }, [o.cuerpo]),
      el('div', { clase: 'hoja-pie' }, o.pie)
    ]));
    d.addEventListener('cancel', function (e) { e.preventDefault(); intentaCerrar(); });
    d.addEventListener('click', function (e) { if (e.target === d) intentaCerrar(); });
    document.body.appendChild(d);
    d.showModal();
    var primero = d.querySelector('.hoja-cuerpo input, .hoja-cuerpo select, .hoja-cuerpo textarea');
    if (primero) primero.focus();
    return { cierra: cierra, intentaCerrar: intentaCerrar, nodo: d };
  }

  /* ================================================================== */
  /* 6 · piezas de formulario                                           */
  /* ================================================================== */

  /* --- errores junto al campo ---
     Antes el único aviso de «falta el nombre» era la píldora de abajo, lejos
     del campo y sin decir cuál. */
  function marcaError(input, mensaje, dondeVa) {
    var id = nuevoId('err');
    var p = el('p', { clase: 'error-campo', id: id, role: 'alert' }, [ico('pn-aviso', 'ico-peq'), el('span', { texto: mensaje })]);
    (dondeVa || input.parentNode).appendChild(p);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('data-err', id);
      input.setAttribute('aria-describedby', ((input.getAttribute('aria-describedby') || '') + ' ' + id).trim());
    }
    return p;
  }
  function limpiaErroresEn(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('.error-campo'), function (p) { p.remove(); });
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-err]'), function (i) {
      var id = i.getAttribute('data-err');
      var resto = (i.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== id; });
      if (resto.length) i.setAttribute('aria-describedby', resto.join(' ')); else i.removeAttribute('aria-describedby');
      i.removeAttribute('aria-invalid');
      i.removeAttribute('data-err');
    });
  }

  function campo(etiqueta, control, pista) {
    var id = control.id || (control.id = nuevoId('f'));
    var hijos = [el('label', { for: id, texto: etiqueta })];
    if (pista) {
      var idP = nuevoId('p');
      control.setAttribute('aria-describedby', idP);
      hijos.push(el('p', { clase: 'pista', id: idP, texto: pista }));
    }
    hijos.push(control);
    return el('div', { clase: 'campo' }, hijos);
  }

  function seccion(titulo, hijos, clase) {
    var id = nuevoId('sec');
    return el('section', { clase: 'bloque' + (clase ? ' ' + clase : ''), 'aria-labelledby': id },
      [el('h2', { clase: 'bloque-tit', id: id, texto: titulo })].concat(hijos));
  }

  /* --- textos cortos: los tres idiomas a la vista ---
     Con pestañas no se veía qué faltaba sin ir tocando una a una. */
  function campoIdiomas(o) {
    var caja = el('fieldset', { clase: 'campo campo-idiomas' }, [el('legend', { texto: o.titulo })]);
    if (o.pista) caja.appendChild(el('p', { clase: 'pista', texto: o.pista }));
    var entradas = {};
    IDIOMAS.forEach(function (l) {
      var id = nuevoId('in');
      var input = el('input', { type: 'text', id: id, lang: l, autocomplete: 'off' });
      input.value = o.obj[l] || '';
      var falta = el('span', { clase: 'idioma-falta', 'aria-hidden': 'true', texto: 'falta' });
      var marca = function () { falta.hidden = l === 'es' || !!input.value.trim(); };
      input.addEventListener('input', function () { o.obj[l] = input.value; marca(); if (o.alCambiar) o.alCambiar(); });
      marca();
      caja.appendChild(el('div', { clase: 'idioma-fila' }, [
        el('label', { for: id, clase: 'idioma-et' }, [
          el('span', { 'aria-hidden': 'true', texto: l.toUpperCase() }),
          el('span', { clase: 'oculto', texto: o.titulo + ' en ' + NOMBRE_IDIOMA[l] + (l === 'es' && o.obligatorio ? ', obligatorio' : '') })
        ]),
        input, falta
      ]));
      entradas[l] = input;
    });
    return { nodo: caja, entradas: entradas };
  }

  /* --- textos largos: pestañas de 44 px que dicen «falta» con palabras --- */
  function campoPestanas(o) {
    var id = nuevoId('tx');
    var actual = 'es';
    var entrada = o.multilinea
      ? el('textarea', { id: id, rows: '3', lang: 'es' })
      : el('input', { type: 'text', id: id, lang: 'es', autocomplete: 'off' });
    entrada.value = o.obj.es || '';
    var queIdioma = el('span', { clase: 'oculto', texto: ' en español' });
    var botones = {};
    var tabs = el('div', { clase: 'idiomas', role: 'group', 'aria-label': 'Idioma de ' + minusc(o.titulo) });
    function marca() {
      IDIOMAS.forEach(function (l) {
        var b = botones[l];
        b.textContent = '';
        b.appendChild(el('span', { 'aria-hidden': 'true', texto: l.toUpperCase() }));
        b.appendChild(el('span', { clase: 'oculto', texto: NOMBRE_IDIOMA[l] }));
        if (!(o.obj[l] || '').trim()) b.appendChild(el('span', { clase: 'idi-falta', texto: 'falta' }));
        b.setAttribute('aria-pressed', l === actual ? 'true' : 'false');
      });
    }
    IDIOMAS.forEach(function (l) {
      botones[l] = el('button', { type: 'button', clase: 'idi-b', onclick: function () {
        actual = l;
        entrada.value = o.obj[l] || '';
        entrada.setAttribute('lang', l);
        queIdioma.textContent = ' en ' + NOMBRE_IDIOMA[l];
        marca();
        entrada.focus();
      } });
      tabs.appendChild(botones[l]);
    });
    entrada.addEventListener('input', function () {
      o.obj[actual] = entrada.value;
      marca();
      if (o.alCambiar) o.alCambiar();
    });
    marca();
    var hijos = [el('label', { for: id }, [o.titulo, queIdioma])];
    if (o.pista) {
      var idP = nuevoId('p');
      entrada.setAttribute('aria-describedby', idP);
      hijos.push(el('p', { clase: 'pista', id: idP, texto: o.pista }));
    }
    return el('div', { clase: 'campo' }, hijos.concat([tabs, entrada]));
  }

  /* --- un texto corto con sus traducciones plegadas ---
     Para la variante de un precio y el nombre de una opción. ANTES era una sola
     caja que escribía lo mismo en los tres idiomas al teclear: tocar «2 uds»
     mandaba {"es":"2 uds","en":"2 uds","gl":"2 uds"} y se perdía «2 pcs». Las 20
     variantes de precio y 29 de las 40 opciones llevan traducción propia. */
  function campoCompacto(obj, o) {
    var es = el('input', { type: 'text', lang: 'es', autocomplete: 'off', placeholder: o.placeholder || '',
      'aria-label': o.etiqueta + ' en español' });
    es.value = obj.es || '';
    var idOtros = nuevoId('tr');
    var otros = el('div', { clase: 'trad-otros', id: idOtros, hidden: true });
    var boton = el('button', { type: 'button', clase: 'btn-t trad-b', 'aria-expanded': 'false', 'aria-controls': idOtros });
    boton.addEventListener('click', function () {
      var abrir = otros.hidden;
      otros.hidden = !abrir;
      boton.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      if (abrir) otros.querySelector('input').focus();
    });
    ['en', 'gl'].forEach(function (l) {
      var id = nuevoId('cp');
      var inp = el('input', { type: 'text', id: id, lang: l, autocomplete: 'off' });
      inp.value = obj[l] || '';
      inp.addEventListener('input', function () { obj[l] = inp.value; marca(); if (o.alCambiar) o.alCambiar(); });
      otros.appendChild(el('div', { clase: 'idioma-fila' }, [
        el('label', { for: id, clase: 'idioma-et' }, [
          el('span', { 'aria-hidden': 'true', texto: l.toUpperCase() }),
          el('span', { clase: 'oculto', texto: o.etiqueta + ' en ' + NOMBRE_IDIOMA[l] })
        ]), inp
      ]));
    });
    function marca() {
      var faltan = ['en', 'gl'].filter(function (l) { return !(obj[l] || '').trim(); });
      boton.hidden = !tieneTexto(obj);
      boton.textContent = faltan.length
        ? 'Traducir: falta ' + enumera(faltan.map(function (l) { return l.toUpperCase(); }))
        : 'Traducciones (EN y GL)';
      boton.classList.toggle('trad-falta', faltan.length > 0);
    }
    es.addEventListener('input', function () { obj.es = es.value; marca(); if (o.alCambiar) o.alCambiar(); });
    marca();
    return { es: es, boton: boton, otros: otros };
  }

  /* --- botones segmentados ---
     Radios de verdad, escondidos pero enfocables, así que el teclado y el
     lector de pantalla funcionan sin una línea de ARIA a mano. */
  function segmentado(o) {
    var nombre = nuevoId('sg');
    var caja = el('fieldset', { clase: 'seg' + (o.clase ? ' ' + o.clase : '') }, [
      el('legend', { clase: o.leyendaVisible ? 'seg-leyenda' : 'oculto', texto: o.leyenda })
    ]);
    var ops = el('div', { clase: 'seg-ops' });
    o.opciones.forEach(function (op) {
      var input = el('input', { type: 'radio', name: nombre, value: String(op.valor), clase: 'seg-radio' });
      input.checked = String(o.valor) === String(op.valor);
      input.addEventListener('change', function () { if (input.checked) o.alCambiar(op.valor); });
      ops.appendChild(el('label', { clase: 'seg-op' + (op.clase ? ' ' + op.clase : '') }, [
        input, el('span', { clase: 'seg-cara' }, op.nodos || [op.texto])
      ]));
    });
    caja.appendChild(ops);
    return caja;
  }

  function interruptor(o) {
    var b = el('button', { type: 'button', role: 'switch', clase: 'interruptor', id: o.id || null,
      'aria-checked': o.activo ? 'true' : 'false', 'aria-label': o.etiqueta || null },
      [el('span', { clase: 'interruptor-pista', 'aria-hidden': 'true' }, [el('span', { clase: 'interruptor-bola' })])]);
    b.addEventListener('click', function () {
      var nuevo = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', nuevo ? 'true' : 'false');
      o.alCambiar(nuevo, b);
    });
    return b;
  }
  /* Con <label for>: tocar el texto también cambia el interruptor. */
  function filaInterruptor(o) {
    var id = nuevoId('sw');
    var sw = interruptor({ id: id, activo: o.activo, alCambiar: o.alCambiar });
    var hijos = [el('label', { for: id, clase: 'fila-inter-et', texto: o.etiqueta })];
    if (o.pista) {
      var idP = nuevoId('p');
      sw.setAttribute('aria-describedby', idP);
      hijos.push(el('span', { clase: 'pista', id: idP, texto: o.pista }));
    }
    return el('div', { clase: 'fila-inter' }, [el('div', { clase: 'fila-inter-txt' }, hijos), sw]);
  }

  function casilla(etiqueta, marcada, alCambiar) {
    var input = el('input', { type: 'checkbox' });
    input.checked = !!marcada;
    input.addEventListener('change', function () { alCambiar(input.checked); });
    return el('label', { clase: 'casilla' }, [input, el('span', { texto: etiqueta })]);
  }

  function chipsConmutables(items, seleccion, alCambiar, etiqueta) {
    return el('div', { clase: 'chips', role: 'group', 'aria-label': etiqueta }, items.map(function (it) {
      var b = el('button', { type: 'button', clase: 'chip-t', texto: t(it.nombre),
        'aria-pressed': seleccion.indexOf(it.id) !== -1 ? 'true' : 'false' });
      b.addEventListener('click', function () {
        var i = seleccion.indexOf(it.id);
        if (i === -1) seleccion.push(it.id); else seleccion.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
        alCambiar();
      });
      return b;
    }));
  }

  function puntos(valor, maximo) {
    var s = el('span', { clase: 'pips', 'aria-hidden': 'true' });
    for (var i = 0; i < maximo; i++) s.appendChild(el('i', { clase: i < valor ? 'on' : null }));
    return s;
  }

  /* --- alérgenos ---
     ANTES: catorce desplegables «No lleva» idénticos, dos toques cada uno, y un
     «Contiene» que se veía igual que un «No lleva». AHORA: la pregunta es
     «¿lo lleva?» y se contesta con un toque, con el icono que sale en la carta. */
  function editorAlergenos(mapa, alCambiar) {
    var resumen = el('p', { clase: 'alg-resumen' });
    function pintaResumen() {
      var nom = function (grado) {
        return estado.alergenos.filter(function (a) { return mapa[a.id] === grado; }).sort(porOrden)
          .map(function (a) { return minusc(t(a.nombre)); });
      };
      var lleva = nom('contiene'), trazas = nom('trazas');
      var partes = [];
      if (lleva.length) partes.push('Lleva ' + enumera(lleva) + '.');
      if (trazas.length) partes.push('Trazas de ' + enumera(trazas) + '.');
      resumen.textContent = partes.length ? partes.join(' ') : 'No hay ningún alérgeno marcado.';
    }
    var lista = el('div', { clase: 'alg-lista' });
    estado.alergenos.slice().sort(porOrden).forEach(function (a) {
      lista.appendChild(el('div', { clase: 'alg-fila' }, [
        el('span', { clase: 'alg-nombre', 'aria-hidden': 'true' }, [ico('alg-' + a.slug, 'ico-alg'), el('span', { texto: t(a.nombre) })]),
        segmentado({
          leyenda: t(a.nombre), clase: 'seg-alg', valor: mapa[a.id] || '',
          opciones: [
            { valor: '', texto: 'No' },
            { valor: 'trazas', texto: 'Trazas', clase: 'seg-trazas' },
            { valor: 'contiene', texto: 'Sí', clase: 'seg-si' }
          ],
          alCambiar: function (v) {
            if (v) mapa[a.id] = v; else delete mapa[a.id];
            pintaResumen();
            if (alCambiar) alCambiar();
          }
        })
      ]));
    });
    pintaResumen();
    return el('div', { clase: 'alergenos' }, [resumen, lista]);
  }

  /* --- niveles ---
     «No» y los puntos, igual que la carta. El 0 y «no aplica» salen igual en la
     web, así que un plato que ya tenía un 0 lo conserva si no se toca: si no, la
     comparación con lo publicado vería un cambio que no se nota en ningún sitio. */
  function editorNiveles(mapa, alCambiar) {
    var caja = el('div', { clase: 'niveles' });
    estado.escalas.slice().sort(porOrden).forEach(function (e) {
      var ops = [{ valor: '', texto: 'No' }];
      for (var v = 1; v <= e.maximo; v++) {
        ops.push({ valor: v, nodos: [puntos(v, e.maximo), el('span', { clase: 'oculto', texto: v + ' de ' + e.maximo })] });
      }
      caja.appendChild(segmentado({
        leyenda: t(e.nombre), leyendaVisible: true, clase: 'seg-nivel',
        valor: mapa[e.id] ? mapa[e.id] : '', opciones: ops,
        alCambiar: function (valor) {
          if (valor === '') { if (mapa[e.id] !== 0) delete mapa[e.id]; } else mapa[e.id] = Number(valor);
          if (alCambiar) alCambiar();
        }
      }));
    });
    return caja;
  }

  /* --- la foto del plato ---
     UN SOLO <input type="file" accept="image/*"> HACE LAS DOS COSAS. En Android
     abre el selector con Galería / Cámara / Archivos, en iPhone con Fototeca /
     Hacer foto / Examinar, y en un ordenador el explorador de archivos filtrado
     a imágenes. No hay que detectar el aparato ni hacen falta dos botones.

     Y NO LLEVA `capture`, a propósito: ese atributo NO es una pista, es una
     orden. Con él, el móvil abre la cámara directamente y la galería deja de
     ser alcanzable, que es justo lo contrario de lo que se quiere aquí.

     La foto se sube al elegirla, no al guardar el plato: así la barra de
     "Subiendo…" está donde el dedo acaba de tocar, y guardar sigue siendo
     instantáneo. Lo que se guarda en la columna `imagen` es la ruta final del
     repositorio; la foto sale a la web en la próxima publicación, igual que el
     PDF y que todo lo demás del panel.

     Si se sube una foto y luego se cierra la ficha sin guardar, ese archivo se
     queda en el buzón y la próxima publicación lo commitea sin que lo use nadie.
     Son 15 KB y no se barre por lo mismo que no se barren las demás: volver
     atrás desde el Historial necesita que las fotos viejas sigan ahí. */
  var LADO_FOTO = 192;           /* se pinta a 56 px, 64 en pantalla ancha: ×3 de densidad */
  var CARPETA_FOTOS = '/assets/img/platos/';
  var TOPE_ORIGEN = 25 * 1024 * 1024;
  var PENDIENTE = 'Subida. Sale a la web cuando guardes el plato y publiques.';

  /* El sensor de un móvil casi nunca rota los píxeles: guarda el giro en el EXIF
     y deja que lo aplique quien la pinte. Sin `from-image`, media carta acaba
     tumbada. */
  function decodifica(archivo) {
    if (window.createImageBitmap) {
      return createImageBitmap(archivo, { imageOrientation: 'from-image' })
        .catch(function () { return porEtiqueta(archivo); });
    }
    return porEtiqueta(archivo);
  }

  function porEtiqueta(archivo) {
    return new Promise(function (resolver, rechazar) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolver(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rechazar(Object.assign(new Error('Este navegador no sabe abrir esa foto. Si viene de un iPhone y ' +
          'termina en .HEIC, ábrela en Fotos y compártela como JPG.'), { propio: true }));
      };
      img.src = url;
    });
  }

  /* Recorta el cuadrado del centro y lo baja a 192 px. Se hace aquí y no en el
     servidor porque el navegador ya trae decodificador: así se suben 15 KB en
     vez de los 4 MB del original, el HEIC del iPhone ya viene convertido y el
     repositorio sigue sin package.json. */
  function encuadra(archivo) {
    if (archivo.type && archivo.type.slice(0, 6) !== 'image/') {
      return Promise.reject(Object.assign(new Error('Eso no es una imagen.'), { propio: true }));
    }
    if (archivo.size > TOPE_ORIGEN) {
      return Promise.reject(Object.assign(new Error('Esa foto pesa ' + (archivo.size / 1048576).toFixed(1).replace('.', ',') +
        ' MB y el tope son 25. Elige otra.'), { propio: true }));
    }
    return decodifica(archivo).then(function (bm) {
      var lado = Math.min(bm.width, bm.height);
      var lienzo = document.createElement('canvas');
      lienzo.width = LADO_FOTO; lienzo.height = LADO_FOTO;
      var ctx = lienzo.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      /* Un JPEG no tiene transparencia: sin este relleno, un PNG con alfa sale
         con el fondo en negro. */
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
      ctx.drawImage(bm, (bm.width - lado) / 2, (bm.height - lado) / 2, lado, lado,
        0, 0, LADO_FOTO, LADO_FOTO);
      if (bm.close) bm.close();
      return new Promise(function (resolver, rechazar) {
        lienzo.toBlob(function (b) {
          if (b) resolver(b); else rechazar(Object.assign(new Error('No se ha podido comprimir la foto.'), { propio: true }));
        }, 'image/jpeg', 0.82);
      });
    });
  }

  /* Ocho caracteres de sha1, la misma huella que usa build.mjs para el CSS y el
     PDF. Va en el nombre del archivo, así que cambiar la foto de un plato cambia
     la ruta: Cloudflare no puede servir la vieja ni queriendo. */
  function huella(buf) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-1', buf).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('').slice(0, 8);
      });
    }
    /* Respaldo para un navegador sin WebCrypto. Aquí la huella no protege nada,
       solo tiene que ser distinta cuando los bytes son distintos. */
    var b = new Uint8Array(buf), h = 0x811c9dc5;
    for (var i = 0; i < b.length; i++) {
      h ^= b[i];
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return Promise.resolve(('0000000' + h.toString(16)).slice(-8));
  }

  /* El bucket es privado, así que la foto que todavía no se ha publicado solo se
     puede mirar con la sesión de quien está dentro del panel. */
  function bajaFoto(nombre) {
    return fetch(cfg.url + '/storage/v1/object/fotos/' + encodeURIComponent(nombre), {
      headers: { apikey: cfg.anon, Authorization: 'Bearer ' + sesion.access_token }
    }).then(function (r) {
      if (!r.ok) throw new Error('no está en el buzón');
      return r.blob();
    });
  }

  function campoFoto(f, alCambiar) {
    var entrada = el('input', { type: 'file', accept: 'image/*', hidden: true });
    var vista = el('div', { clase: 'foto-vista' });
    var estadoFoto = el('p', { clase: 'pista', 'aria-live': 'polite' });
    var elegir = el('button', { type: 'button', clase: 'btn btn-s',
      onclick: function () { entrada.click(); } });
    var quitar = el('button', { type: 'button', clase: 'btn-t', texto: 'Quitar la foto',
      onclick: function () { f.imagen = null; pinta(); if (alCambiar) alCambiar(); } });
    var url = null;

    function suelta() { if (url) { URL.revokeObjectURL(url); url = null; } }

    function pinta(local) {
      suelta();
      vista.textContent = '';
      quitar.hidden = !f.imagen;
      elegir.textContent = f.imagen ? 'Cambiar la foto' : 'Elegir una foto';

      if (!f.imagen) {
        vista.appendChild(el('span', { clase: 'foto-no', texto: 'Sin foto' }));
        estadoFoto.textContent = 'Sin foto se pinta el marcador de su categoría. Desde el móvil puedes ' +
          'cogerla de la galería o hacerla en el momento.';
        return;
      }

      var img = el('img', { clase: 'foto-prev', alt: '', width: LADO_FOTO, height: LADO_FOTO });
      vista.appendChild(img);

      if (local) {
        url = local;
        img.src = local;
        estadoFoto.textContent = PENDIENTE;
        return;
      }

      /* Se prueba primero la ruta pública. Si da 404, la foto está subida pero
         todavía no publicada, y entonces se enseña la del buzón: así se ve lo
         que de verdad hay guardado en vez de un cuadro roto. El reintento se
         hace una sola vez, que si no un blob que no decodifica da vueltas. */
      var reintentado = false;
      img.addEventListener('error', function () {
        if (reintentado) return;
        reintentado = true;
        bajaFoto((f.imagen || '').split('/').pop()).then(function (blob) {
          suelta();
          url = URL.createObjectURL(blob);
          img.src = url;
          estadoFoto.textContent = 'Subida. Sale a la web en cuanto publiques.';
        }).catch(function () {
          vista.textContent = '';
          vista.appendChild(el('span', { clase: 'foto-no', texto: 'No está' }));
          estadoFoto.textContent = 'La foto de este plato ya no está. Sube otra.';
        });
      });
      estadoFoto.textContent = 'Ya está en la web.';
      img.src = f.imagen;
    }

    entrada.addEventListener('change', function () {
      var archivo = this.files && this.files[0];
      /* Se limpia ya: si no, elegir el mismo archivo dos veces seguidas no
         dispara el change y parece que el botón se ha quedado colgado. */
      entrada.value = '';
      if (!archivo) return;

      elegir.disabled = true; elegir.textContent = 'Preparando…';
      encuadra(archivo).then(function (blob) {
        elegir.textContent = 'Subiendo…';
        return blob.arrayBuffer().then(huella).then(function (h) {
          var base = f.slug || (f.nombre.es ? slugifica(f.nombre.es) : '');
          var nombre = (base ? base + '-' : 'foto-') + h + '.jpg';
          return subeBinario('/storage/v1/object/fotos/' + nombre, blob, 'image/jpeg').then(function () {
            f.imagen = CARPETA_FOTOS + nombre;
            pinta(URL.createObjectURL(blob));
            if (alCambiar) alCambiar();
            aviso('Foto subida. Guarda el plato para que se quede.');
          });
        });
      }).catch(function (x) {
        aviso(traduceError(x), { tipo: 'error' });
      }).then(function () {
        elegir.disabled = false;
        elegir.textContent = f.imagen ? 'Cambiar la foto' : 'Elegir una foto';
      });
    });

    pinta();
    return el('div', { clase: 'campo' }, [
      el('div', { clase: 'foto-caja' }, [vista, el('div', { clase: 'foto-acc' }, [elegir, quitar, entrada])]),
      estadoFoto
    ]);
  }

  /* ================================================================== */
  /* 7 · pantallas: entrada, platos, ficha, revisión de alérgenos       */
  /* ================================================================== */

  function pintaEntrada(msg) {
    guardia = null;
    rutaActual = null;
    document.body.className = 'pantalla-entrada';
    var app = $('#app');
    app.textContent = '';
    var idC = nuevoId('e'), idK = nuevoId('e'), idErr = nuevoId('e');
    var correo = el('input', { type: 'email', id: idC, autocomplete: 'username', inputmode: 'email',
      autocapitalize: 'off', spellcheck: 'false' });
    var clave = el('input', { type: 'password', id: idK, autocomplete: 'current-password' });
    var ver = el('button', { type: 'button', clase: 'btn-icono clave-ver', 'aria-pressed': 'false',
      'aria-label': 'Mostrar la contraseña' }, [ico('pn-ojo')]);
    ver.addEventListener('click', function () {
      var mostrar = clave.type === 'password';
      clave.type = mostrar ? 'text' : 'password';
      ver.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
      ver.setAttribute('aria-label', mostrar ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
    });
    var boton = el('button', { clase: 'btn btn-p btn-ancho', type: 'submit', texto: 'Entrar' });
    /* El error va DEBAJO del botón, junto a lo que se acaba de tocar. Antes era
       la píldora fija de abajo: medido a 390 px, en y = 759 con el botón en 434,
       y en inglés («Invalid login credentials»). */
    var err = el('p', { clase: 'error-form', id: idErr, role: 'alert' });
    if (msg) err.textContent = msg;

    var form = el('form', { clase: 'entrada', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      if (!correo.value.trim() || !clave.value) {
        err.textContent = 'Escribe el correo y la contraseña.';
        (correo.value.trim() ? clave : correo).focus();
        return;
      }
      err.textContent = '';
      boton.disabled = true; boton.textContent = 'Entrando…';
      entra(correo.value.trim(), clave.value).then(arranca).catch(function (x) {
        err.textContent = traduceError(x);
        boton.disabled = false; boton.textContent = 'Entrar';
      });
    } }, [
      el('h1', { texto: 'Panel de la carta' }),
      el('p', { clase: 'entrada-sub', texto: 'Entra para cambiar platos, precios y alérgenos.' }),
      el('div', { clase: 'campo' }, [el('label', { for: idC, texto: 'Correo' }), correo]),
      el('div', { clase: 'campo' }, [el('label', { for: idK, texto: 'Contraseña' }), el('div', { clase: 'clave-caja' }, [clave, ver])]),
      boton,
      err,
      el('p', { clase: 'entrada-pie' }, [el('a', { href: '/menu/', texto: 'Volver a la carta' })])
    ]);
    app.appendChild(el('main', { clase: 'entrada-env' }, [form]));
  }

  /* --- la lista de platos --- */
  function pintaPlatos(c) {
    c.appendChild(el('h1', { clase: 'oculto', texto: 'Platos' }));

    if (hayRevision()) {
      var total = estado.platos.length;
      var hechos = estado.platos.filter(function (p) { return p.alergenos_revisados; }).length;
      if (hechos < total) {
        var barra = el('span', { clase: 'progreso-barra', 'aria-hidden': 'true' }, [el('span', {})]);
        barra.firstChild.style.width = Math.round((hechos / Math.max(total, 1)) * 100) + '%';
        c.appendChild(el('a', { clase: 'tarjeta-rev', href: '#/alergenos' }, [
          el('span', { clase: 'tarjeta-rev-txt' }, [
            el('strong', { texto: 'Alérgenos revisados: ' + hechos + ' de ' + total }),
            barra
          ]),
          el('span', { clase: 'tarjeta-rev-cta' }, [el('span', { texto: hechos ? 'Seguir' : 'Revisar' }), ico('pn-derecha', 'ico-peq')])
        ]));
      }
    }

    var idQ = nuevoId('q'), idF = nuevoId('flt');
    var buscador = el('input', { type: 'search', id: idQ, placeholder: 'Buscar un plato…', autocomplete: 'off',
      enterkeyhint: 'search' });
    buscador.value = estadoLista.q;
    var filtro = el('select', { id: idF, clase: 'filtro' });
    var opcion = function (valor, texto) { return el('option', { value: valor, texto: texto }); };
    var cuantos = function (fn) { return estado.platos.filter(fn).length; };
    filtro.appendChild(opcion('', 'Todos (' + estado.platos.length + ')'));
    var estados = [
      opcion('estado:fuera', 'Fuera de la carta (' + cuantos(function (p) { return p.disponible === false; }) + ')'),
      opcion('estado:sin-traducir', 'Sin traducir (' + cuantos(function (p) {
        return !IDIOMAS.every(function (l) { return (p.nombre || {})[l]; });
      }) + ')')
    ];
    if (hayRevision()) {
      estados.splice(1, 0, opcion('estado:sin-revisar', 'Alérgenos sin revisar (' +
        cuantos(function (p) { return !p.alergenos_revisados; }) + ')'));
    }
    filtro.appendChild(el('optgroup', { label: 'Estado' }, estados));
    filtro.appendChild(el('optgroup', { label: 'Secciones' }, idx.madres.reduce(function (acc, m) {
      var hijas = idx.hijas[m.id] || [];
      var ids = [m.id].concat(hijas.map(function (h) { return h.id; }));
      acc.push(opcion('cat:' + m.id, t(m.nombre) + ' (' + cuantos(function (p) { return ids.indexOf(p.categoria_id) !== -1; }) + ')'));
      hijas.forEach(function (h) {
        acc.push(opcion('cat:' + h.id, '\u00a0\u00a0\u00a0' + t(h.nombre) + ' (' + cuantos(function (p) { return p.categoria_id === h.id; }) + ')'));
      });
      return acc;
    }, [])));
    filtro.value = estadoLista.filtro;
    if (filtro.value !== estadoLista.filtro) { estadoLista.filtro = ''; filtro.value = ''; }

    c.appendChild(el('div', { clase: 'lista-barra' }, [
      el('div', { clase: 'buscador' }, [el('label', { for: idQ, clase: 'oculto', texto: 'Buscar un plato' }), buscador]),
      el('label', { for: idF, clase: 'oculto', texto: 'Qué platos enseñar' }),
      filtro
    ]));
    var recuento = el('p', { clase: 'recuento' });
    c.appendChild(recuento);
    var lista = el('div', { clase: 'lista-platos' });
    c.appendChild(lista);
    c.appendChild(el('a', { clase: 'btn btn-p btn-nuevo', href: '#/plato/nuevo' }, [ico('pn-mas'), el('span', { texto: 'Plato nuevo' })]));

    var anuncioLista = null;
    function pinta() {
      var palabras = pliega(estadoLista.q.trim()).split(/\s+/).filter(Boolean);
      var fl = estadoLista.filtro;
      var cid = fl.indexOf('cat:') === 0 ? fl.slice(4) : null;
      var pasa = function (p) {
        if (fl === 'estado:fuera' && p.disponible !== false) return false;
        if (fl === 'estado:sin-revisar' && p.alergenos_revisados) return false;
        if (fl === 'estado:sin-traducir' && IDIOMAS.every(function (l) { return (p.nombre || {})[l]; })) return false;
        if (cid) {
          /* Filtrar por una madre incluye sus hijas. Antes «Tapas» daba 0: los
             20 platos cuelgan de Gyozas, Baos y De la freidora. */
          var cat = catDe(p);
          if (!cat || (cat.id !== cid && cat.padre_id !== cid)) return false;
        }
        return casa(p, palabras);
      };
      lista.textContent = '';
      var n = 0;
      secciones().forEach(function (s) {
        var suyos = s.platos.filter(pasa);
        if (!suyos.length) return;
        n += suyos.length;
        var idS = nuevoId('s');
        lista.appendChild(el('section', { clase: 'seccion', 'aria-labelledby': idS }, [
          el('h2', { clase: 'seccion-tit', id: idS, texto: s.titulo + (s.cat.activa === false ? ' · apagada' : '') }),
          el('ul', { clase: 'filas' }, suyos.map(filaPlato))
        ]));
      });
      var activo = palabras.length || fl;
      recuento.textContent = activo ? (n === 1 ? '1 plato' : n + ' platos') : '';
      recuento.hidden = !activo;
      if (!n) {
        lista.appendChild(el('div', { clase: 'vacio' }, [
          el('p', { texto: 'Ningún plato coincide.' }),
          el('button', { type: 'button', clase: 'btn btn-s', texto: 'Quitar la búsqueda y el filtro', onclick: function () {
            estadoLista.q = ''; estadoLista.filtro = ''; buscador.value = ''; filtro.value = ''; pinta(); buscador.focus();
          } })
        ]));
      }
      if (activo) {
        clearTimeout(anuncioLista);
        anuncioLista = setTimeout(function () { anuncia(n ? (n === 1 ? '1 plato' : n + ' platos') : 'Ningún plato coincide'); }, 350);
      }
    }

    buscador.addEventListener('input', function () { estadoLista.q = buscador.value; pinta(); });
    filtro.addEventListener('change', function () { estadoLista.filtro = filtro.value; pinta(); });
    pinta();

    /* Al volver de una ficha: al plato que se acaba de tocar, o a donde se
       estaba. Antes volvía con el buscador vacío y a mitad de página. */
    requestAnimationFrame(function () {
      var foco = estadoLista.foco;
      estadoLista.foco = null;
      var li = foco ? lista.querySelector('[data-slug="' + CSS.escape(foco) + '"]') : null;
      if (li) {
        li.scrollIntoView({ block: 'center' });
        li.querySelector('.fila-abre').focus({ preventScroll: true });
      } else {
        window.scrollTo(0, estadoLista.scroll || 0);
      }
    });
  }

  function filaPlato(p) {
    var fuera = p.disponible === false;
    var meta = [el('span', { texto: textoPrecios(p) })];
    if (fuera) meta.push(el('span', { clase: 'chip chip-aviso', texto: 'Fuera de la carta' }));
    var faltan = IDIOMAS.filter(function (l) { return !(p.nombre || {})[l]; });
    if (faltan.length) meta.push(el('span', { clase: 'chip chip-aviso', texto: 'Falta ' + enumera(faltan.map(function (l) { return l.toUpperCase(); })) }));
    if (hayRevision() && !p.alergenos_revisados) meta.push(el('span', { clase: 'fila-suave', texto: 'alérgenos sin revisar' }));

    var sw = interruptor({
      etiqueta: 'En la carta: ' + t(p.nombre), activo: !fuera,
      alCambiar: function (on, boton) { cambiaDisponible(p, on, boton); }
    });
    return el('li', { clase: 'fila' + (fuera ? ' fuera' : ''), 'data-slug': p.slug }, [
      el('a', { clase: 'fila-abre', href: '#/plato/' + encodeURIComponent(p.slug) }, [
        el('span', { clase: 'fila-nombre', texto: (p.numero ? p.numero + '. ' : '') + t(p.nombre) }),
        el('span', { clase: 'fila-meta' }, meta)
      ]),
      sw
    ]);
  }

  /* El interruptor de la lista actúa al momento, como antes, pero ahora con
     «Deshacer». Antes era un enlace de texto pegado a «Editar», sin vuelta. */
  function cambiaDisponible(p, on, boton, sinAviso) {
    if (boton) boton.disabled = true;
    return parchea('platos', 'id=eq.' + p.id, { disponible: on }).then(function () {
      p.disponible = on;
      var li = document.querySelector('.fila[data-slug="' + CSS.escape(p.slug) + '"]');
      if (li) {
        var nueva = filaPlato(p);
        li.replaceWith(nueva);
        if (boton) nueva.querySelector('.interruptor').focus();
      }
      recalculaPronto();
      if (!sinAviso) {
        aviso('«' + t(p.nombre) + '» ' + (on ? 'vuelve a la carta.' : 'queda fuera de la carta.'), {
          accion: function () { cambiaDisponible(p, !on, null, true); }, textoAccion: 'Deshacer'
        });
      }
    }).catch(function (x) {
      if (boton) boton.setAttribute('aria-checked', on ? 'false' : 'true');
      aviso(traduceError(x), { tipo: 'error' });
    }).then(function () {
      if (boton && document.body.contains(boton)) boton.disabled = false;
    });
  }

  /* --- la ficha de un plato --- */
  function siguienteOrden(cid, sinId) {
    var max = 0;
    estado.platos.forEach(function (p) {
      if (p.categoria_id === cid && p.id !== sinId) max = Math.max(max, p.orden || 0);
    });
    return max + 1;
  }

  function fichaNueva() {
    var cid = estadoLista.filtro.indexOf('cat:') === 0 ? estadoLista.filtro.slice(4) : null;
    var cat = cid ? idx.cat[cid] : null;
    if (cat && (idx.hijas[cat.id] || []).length) cat = idx.hijas[cat.id][0];
    if (!cat) {
      var s = secciones();
      cat = s.length ? s[0].cat : estado.categorias[0] || null;
    }
    return {
      id: null, slug: null, numero: '', categoria_id: cat ? cat.id : null,
      nombre: {}, descripcion: {}, nota: {}, imagen: null, disponible: true,
      orden: siguienteOrden(cat ? cat.id : null),
      precios: [{ etiqueta: {}, texto: '' }], aConsultar: false,
      alergenos: {}, revisados: false, revisadosFecha: null,
      etiquetas: [], escalas: {}, grupos: []
    };
  }

  function cargaFicha(p) {
    var precios = preciosDe(p).map(function (x) {
      return { etiqueta: copia(x.etiqueta), texto: escribePrecio(x.precio), nulo: x.precio == null };
    });
    var aConsultar = precios.length === 1 && precios[0].nulo && !tieneTexto(precios[0].etiqueta);
    if (!precios.length || aConsultar) precios = [{ etiqueta: {}, texto: '' }];
    var alg = {};
    estado.palergenos.forEach(function (x) { if (x.plato_id === p.id) alg[x.alergeno_id] = x.grado; });
    var esc = {};
    estado.pescalas.forEach(function (x) { if (x.plato_id === p.id) esc[x.escala_id] = x.valor; });
    return {
      id: p.id, slug: p.slug, numero: p.numero || '', categoria_id: p.categoria_id,
      nombre: copia(p.nombre), descripcion: copia(p.descripcion), nota: copia(p.nota),
      imagen: p.imagen || null, disponible: p.disponible !== false, orden: p.orden || 0,
      precios: precios, aConsultar: aConsultar,
      alergenos: alg, revisados: !!p.alergenos_revisados, revisadosFecha: p.alergenos_revisados || null,
      etiquetas: estado.petiquetas.filter(function (x) { return x.plato_id === p.id; }).map(function (x) { return x.etiqueta_id; }),
      escalas: esc,
      grupos: estado.pgrupos.filter(function (x) { return x.plato_id === p.id; }).sort(porOrden)
        .map(function (x) { return x.grupo_id; })
    };
  }

  var filasConAlgo = function (f) {
    return f.precios.filter(function (x) { return String(x.texto).trim() || tieneTexto(x.etiqueta); });
  };

  /* Lo que se manda a guarda_plato (migración 0005): la ficha entera en una sola
     llamada, que se guarda entera o no se guarda. Antes eran 8 peticiones
     sueltas y un corte a mitad dejaba el plato sin precios o sin alérgenos. */
  function payloadPlato(f) {
    var datos = {
      id: f.id, slug: f.slug, numero: String(f.numero || '').trim() || null, categoria_id: f.categoria_id,
      nombre: limpiaTexto(f.nombre), descripcion: limpiaTexto(f.descripcion), nota: limpiaTexto(f.nota),
      imagen: f.imagen || null, disponible: f.disponible, orden: parseInt(f.orden, 10) || 0,
      precios: f.aConsultar ? [{ etiqueta: null, precio: null }] : filasConAlgo(f).map(function (x) {
        return { etiqueta: tieneTexto(x.etiqueta) ? limpiaTexto(x.etiqueta) : null, precio: leePrecio(x.texto) };
      }),
      alergenos: Object.keys(f.alergenos).sort(function (a, b) { return a - b; })
        .map(function (id) { return { id: Number(id), grado: f.alergenos[id] }; }),
      etiquetas: f.etiquetas.slice().sort(),
      escalas: Object.keys(f.escalas).sort().map(function (id) { return { id: id, valor: f.escalas[id] }; }),
      grupos: f.grupos.slice()
    };
    if (hayRevision()) datos.alergenos_revisados = !!f.revisados;
    return datos;
  }
  var huellaFicha = function (f) { var d = payloadPlato(f); delete d.slug; return canon(d); };

  function validaFicha(f) {
    var e = [];
    if (!(f.nombre.es || '').trim()) e.push({ campo: 'nombre', texto: 'Escribe el nombre en español.' });
    if (!f.categoria_id) e.push({ campo: 'categoria', texto: 'Elige una categoría.' });
    if (!f.aConsultar) {
      var filas = filasConAlgo(f);
      if (!filas.length || (filas.length === 1 && !String(filas[0].texto).trim())) {
        e.push({ campo: 'precio', texto: 'Pon un precio o marca «Precio a consultar».' });
      } else if (filas.some(function (x) { return String(x.texto).trim() && isNaN(leePrecio(x.texto)); })) {
        e.push({ campo: 'precio', texto: 'Escribe el precio con números, por ejemplo 12,95.' });
      } else if (filas.length > 1 && filas.some(function (x) { return !(x.etiqueta.es || '').trim(); })) {
        e.push({ campo: 'precio', texto: 'Con varias variantes, cada una necesita su nombre: «Copa», «Botella»…' });
      }
    }
    return e;
  }

  function pintaFicha(c, slug) {
    var nuevo = slug === 'nuevo';
    var p = nuevo ? null : estado.platos.filter(function (x) { return x.slug === slug; })[0];
    if (!nuevo && !p) {
      aviso('Ese plato ya no existe.', { tipo: 'error' });
      reemplaza('/platos');
      return;
    }
    var f = nuevo ? fichaNueva() : cargaFicha(p);
    var inicial = huellaFicha(f);
    guardia = function () { return huellaFicha(f) !== inicial; };
    var textoGuardar = nuevo ? 'Crear el plato' : 'Guardar';

    c.appendChild(el('div', { clase: 'pantalla-cab' }, [
      el('a', { clase: 'volver', href: '#/platos', onclick: function (e) { e.preventDefault(); vuelve('/platos'); } },
        [ico('pn-atras', 'ico-peq'), el('span', { texto: 'Platos' })]),
      el('h1', { texto: nuevo ? 'Plato nuevo' : (p.numero ? p.numero + '. ' : '') + t(p.nombre) })
    ]));

    /* --- lo básico --- */
    var nombre = campoIdiomas({ titulo: 'Nombre', obj: f.nombre, obligatorio: true });

    var selCat = el('select', {});
    idx.madres.forEach(function (m) {
      var hijas = idx.hijas[m.id] || [];
      if (!hijas.length) { selCat.appendChild(el('option', { value: m.id, texto: t(m.nombre) })); return; }
      selCat.appendChild(el('optgroup', { label: t(m.nombre) }, hijas.map(function (h) {
        return el('option', { value: h.id, texto: t(h.nombre) });
      }).concat([el('option', { value: m.id, texto: t(m.nombre) + ', sin subsección' })])));
    });
    selCat.value = f.categoria_id || '';
    var pistaOrden = el('p', { clase: 'pista' });
    selCat.addEventListener('change', function () {
      f.categoria_id = selCat.value;
      if (nuevo) { f.orden = siguienteOrden(f.categoria_id); ordenIn.value = f.orden; }
      pintaPistaOrden();
    });

    var numero = el('input', { type: 'text', autocomplete: 'off', inputmode: 'text' });
    numero.value = f.numero;
    numero.addEventListener('input', function () { f.numero = numero.value; });

    var zonaPrecios = el('div', { clase: 'precios' });
    var consulta = casilla('Precio a consultar', f.aConsultar, function (on) {
      f.aConsultar = on;
      pintaPrecios();
    });
    var cajaPrecio = el('fieldset', { clase: 'campo campo-precio' }, [
      el('legend', { texto: 'Precio' }), zonaPrecios, consulta,
      el('p', { clase: 'pista', texto: 'La carta pone «Pregúntanos».' })
    ]);

    function pintaPrecios(focoEn) {
      zonaPrecios.textContent = '';
      zonaPrecios.hidden = f.aConsultar;
      if (f.aConsultar) return;
      var varias = f.precios.length > 1 || tieneTexto(f.precios[0].etiqueta);
      f.precios.forEach(function (pr, i) {
        var precio = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00',
          clase: 'precio-in', 'aria-label': varias ? 'Precio de la variante ' + (i + 1) : 'Precio en euros' });
        precio.value = pr.texto;
        precio.addEventListener('input', function () { pr.texto = precio.value; });
        precio.addEventListener('blur', function () {
          var v = leePrecio(precio.value);
          if (v != null && !isNaN(v)) { pr.texto = escribePrecio(v); precio.value = pr.texto; }
        });
        var cajaIn = el('div', { clase: 'precio-caja' }, [precio, el('span', { clase: 'precio-eur', 'aria-hidden': 'true', texto: '€' })]);
        if (!varias) {
          zonaPrecios.appendChild(el('div', { clase: 'precio-fila precio-sola' }, [cajaIn]));
          if (focoEn === i) precio.focus();
          return;
        }
        var variante = campoCompacto(pr.etiqueta, { etiqueta: 'Variante ' + (i + 1), placeholder: 'Copa, 2 uds…' });
        var quitar = el('button', { type: 'button', clase: 'btn-icono', 'aria-label': 'Quitar la variante ' + (i + 1),
          onclick: function () {
            f.precios.splice(i, 1);
            if (!f.precios.length) f.precios.push({ etiqueta: {}, texto: '' });
            pintaPrecios();
            anadir.focus();
          } }, [ico('pn-cerrar')]);
        zonaPrecios.appendChild(el('div', { clase: 'precio-fila' }, [
          el('div', { clase: 'precio-var' }, [variante.es]), cajaIn, quitar, variante.boton, variante.otros
        ]));
        if (focoEn === i) variante.es.focus();
      });
      var anadir = el('button', { type: 'button', clase: 'btn-t btn-anadir', onclick: function () {
        f.precios.push({ etiqueta: {}, texto: '' });
        pintaPrecios(f.precios.length - 1);
      } }, [ico('pn-mas', 'ico-peq'), el('span', { texto: varias ? 'Añadir otra variante' : 'Añadir variantes (Copa, Botella…)' })]);
      zonaPrecios.appendChild(anadir);
    }
    pintaPrecios();

    var basico = seccion('Lo básico', [
      filaInterruptor({ etiqueta: 'Sale en la carta', activo: f.disponible,
        pista: 'Apágalo si se ha acabado. No se borra.',
        alCambiar: function (on) { f.disponible = on; } }),
      nombre.nodo,
      campo('Categoría', selCat),
      campo('Número en la carta', numero, 'Por ejemplo, 13P. Déjalo vacío si no tiene.'),
      cajaPrecio
    ]);

    /* --- descripción y nota --- */
    var textos = seccion('Descripción y nota', [
      campoPestanas({ titulo: 'Descripción', obj: f.descripcion, multilinea: true,
        pista: 'Lo que lleva el plato. Sale debajo del nombre.' }),
      campoPestanas({ titulo: 'Nota', obj: f.nota,
        pista: 'Sale al abrir el plato en la carta. Por ejemplo, «Por confirmar en el local».' })
    ]);

    /* --- alérgenos --- */
    var hijosAlg = [
      el('p', { clase: 'pista', texto: '¿Lo lleva? «Trazas» si puede tenerlo por contaminación en la cocina.' }),
      editorAlergenos(f.alergenos)
    ];
    if (hayRevision()) {
      hijosAlg.push(casilla('Revisados con la cocina' + (f.revisadosFecha ? ' (el ' + dia(f.revisadosFecha) + ')' : ''),
        f.revisados, function (on) { f.revisados = on; }));
    }
    var alergenos = seccion('Alérgenos', hijosAlg);

    /* --- niveles, opciones y etiquetas --- */
    var extras = seccion('Niveles, opciones y etiquetas', [
      editorNiveles(f.escalas),
      el('div', { clase: 'campo' }, [
        el('p', { clase: 'campo-tit', texto: 'Opciones' }),
        el('p', { clase: 'pista', texto: 'Se comparten entre platos: si cambias «Extras», cambia en todos los que lo lleven.' }),
        chipsConmutables(estado.grupos.slice().sort(porOrden), f.grupos, noop, 'Opciones del plato')
      ]),
      el('div', { clase: 'campo' }, [
        el('p', { clase: 'campo-tit', texto: 'Etiquetas' }),
        chipsConmutables(estado.etiquetas.slice().sort(porOrden), f.etiquetas, noop, 'Etiquetas del plato')
      ])
    ]);

    /* --- foto y orden --- */
    var ordenIn = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', clase: 'corto' });
    ordenIn.value = f.orden;
    ordenIn.addEventListener('input', function () { f.orden = ordenIn.value; pintaPistaOrden(); });
    function pintaPistaOrden() {
      var cat = idx.cat[f.categoria_id];
      var mios = estado.platos.filter(function (x) { return x.categoria_id === f.categoria_id && x.id !== f.id; });
      var n = parseInt(f.orden, 10) || 0;
      var pos = mios.filter(function (x) { return (x.orden || 0) <= n; }).length + 1;
      pistaOrden.textContent = 'Número más bajo, más arriba. Con este número sale el ' + pos + '.º de ' +
        (mios.length + 1) + ' en «' + nombreCat(cat) + '».';
    }
    pintaPistaOrden();
    var cajaOrden = campo('Posición en su sección', ordenIn);
    cajaOrden.appendChild(pistaOrden);
    var ordenDesc = nuevoId('p');
    pistaOrden.id = ordenDesc;
    ordenIn.setAttribute('aria-describedby', ordenDesc);

    var fotoYOrden = seccion('Foto y orden', [campoFoto(f), cajaOrden]);

    var form = el('form', { clase: 'ficha', novalidate: true, onsubmit: function (e) { e.preventDefault(); guarda(); } },
      [basico, textos, alergenos, extras, fotoYOrden]);

    if (!nuevo) {
      form.appendChild(seccion('Borrar', [
        el('p', { clase: 'pista', texto: 'Borrar lo quita del panel y de la carta. Si solo se ha acabado, mejor apágalo arriba.' }),
        el('button', { type: 'button', clase: 'btn btn-peligro-t', texto: 'Borrar el plato', onclick: borra })
      ], 'bloque-peligro'));
    }
    c.appendChild(form);

    var botonGuardar = el('button', { type: 'button', clase: 'btn btn-p', texto: textoGuardar, onclick: guarda });
    c.appendChild(el('div', { clase: 'acciones-fijas' }, [
      el('div', { clase: 'acciones-dentro' }, [
        el('button', { type: 'button', clase: 'btn btn-s', texto: 'Cancelar', onclick: function () { vuelve('/platos'); } }),
        botonGuardar
      ])
    ]));

    function guarda() {
      limpiaErroresEn(form);
      var errores = validaFicha(f);
      if (errores.length) {
        var primero = null;
        errores.forEach(function (x) {
          var destino, donde;
          if (x.campo === 'nombre') { destino = nombre.entradas.es; donde = destino.parentNode; }
          else if (x.campo === 'categoria') { destino = selCat; donde = selCat.parentNode; }
          else {
            destino = zonaPrecios.querySelector('.precio-in') || consulta.querySelector('input');
            donde = cajaPrecio;
          }
          var nodo = marcaError(destino, x.texto, donde);
          if (donde === destino.parentNode && destino.parentNode.classList.contains('idioma-fila')) {
            destino.parentNode.parentNode.insertBefore(nodo, destino.parentNode.nextSibling);
          }
          if (!primero) primero = destino;
        });
        primero.focus();
        primero.scrollIntoView({ block: 'center' });
        return;
      }
      if (!f.id) {
        f.slug = slugUnico(slugifica(f.nombre.es), estado.platos.map(function (x) { return x.slug; }));
      }
      botonGuardar.disabled = true;
      botonGuardar.textContent = 'Guardando…';
      rpc('guarda_plato', { p: payloadPlato(f) }).then(function (r) {
        return cargaTodo().then(function () {
          guardia = null;
          estadoLista.foco = (r && r.slug) || f.slug;
          recalculaPronto();
          aviso(nuevo ? 'Plato creado. Sale en la web cuando publiques.' : 'Guardado. Sale en la web cuando publiques.');
          vuelve('/platos');
        });
      }).catch(function (x) {
        aviso(traduceError(x), { tipo: 'error' });
        botonGuardar.disabled = false;
        botonGuardar.textContent = textoGuardar;
      });
    }

    function borra() {
      confirma({
        titulo: '¿Borrar «' + t(p.nombre) + '»?',
        texto: 'Desaparece del panel, y de la web cuando publiques. Si solo se ha acabado, mejor quítalo de la carta: ' +
          'luego se vuelve a poner con un toque.',
        acciones: [
          { valor: null, texto: 'Cancelar', clase: 'btn btn-s' },
          { valor: 'quitar', texto: 'Quitar de la carta', clase: 'btn btn-s' },
          { valor: 'borrar', texto: 'Borrar el plato', clase: 'btn btn-peligro' }
        ]
      }).then(function (v) {
        if (v === 'quitar') {
          if (guardia && guardia()) {
            f.disponible = false;
            var sw = form.querySelector('.fila-inter .interruptor');
            if (sw) sw.setAttribute('aria-checked', 'false');
            aviso('Queda fuera de la carta en cuanto guardes.');
            return;
          }
          return parchea('platos', 'id=eq.' + p.id, { disponible: false }).then(cargaTodo).then(function () {
            guardia = null;
            estadoLista.foco = p.slug;
            recalculaPronto();
            aviso('«' + t(p.nombre) + '» queda fuera de la carta.');
            vuelve('/platos');
          });
        }
        if (v === 'borrar') {
          return elimina('platos', 'id=eq.' + p.id).then(cargaTodo).then(function () {
            guardia = null;
            recalculaPronto();
            aviso('«' + t(p.nombre) + '» borrado. Desaparece de la web cuando publiques.');
            vuelve('/platos');
          });
        }
      }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); });
    }
  }

  /* --- revisar alérgenos plato a plato ---
     Es lo que el restaurante tiene pendiente: la carta impresa trae la leyenda
     de los catorce, pero no cuáles lleva cada plato. Un plato cada vez, en el
     orden de la carta, con «Guardar y siguiente». Guarda con guarda_alergenos,
     que solo toca los alérgenos: repasar no puede pisar un precio. */
  function siguienteSinRevisar(orden, actual) {
    var i = actual ? orden.indexOf(actual) : -1;
    for (var k = 1; k <= orden.length; k++) {
      var p = orden[(i + k + orden.length) % orden.length];
      if (p !== actual && !p.alergenos_revisados) return p;
    }
    return null;
  }

  function pintaRevision(c, slug) {
    c.appendChild(el('div', { clase: 'pantalla-cab' }, [
      el('a', { clase: 'volver', href: '#/platos', onclick: function (e) { e.preventDefault(); vuelve('/platos'); } },
        [ico('pn-atras', 'ico-peq'), el('span', { texto: 'Platos' })]),
      el('h1', { texto: 'Revisar alérgenos' })
    ]));
    if (!hayRevision()) {
      c.appendChild(el('p', { clase: 'vacio', texto: 'Falta aplicar la migración 0005 en Supabase. Avisa a Yixuan.' }));
      return;
    }
    var orden = platosEnOrden();
    var hechos = orden.filter(function (x) { return x.alergenos_revisados; }).length;
    var p = slug ? orden.filter(function (x) { return x.slug === slug; })[0] : siguienteSinRevisar(orden, null);

    var progreso = el('div', { clase: 'progreso' }, [
      el('p', { clase: 'progreso-txt', texto: hechos + ' de ' + orden.length + ' revisados' }),
      el('div', { clase: 'progreso-barra', role: 'progressbar', 'aria-label': 'Alérgenos revisados',
        'aria-valuemin': '0', 'aria-valuemax': String(orden.length), 'aria-valuenow': String(hechos) }, [el('span', {})])
    ]);
    progreso.querySelector('.progreso-barra span').style.width = Math.round((hechos / Math.max(orden.length, 1)) * 100) + '%';
    c.appendChild(progreso);

    if (!p) {
      document.body.classList.remove('con-acciones');
      c.appendChild(el('div', { clase: 'rev-fin' }, [
        ico('pn-bien', 'ico-grande'),
        el('h2', { texto: 'Ya están los ' + orden.length + ' revisados' }),
        el('p', { texto: 'Si cambia una receta, abre el plato y repasa sus alérgenos.' }),
        el('a', { clase: 'btn btn-p', href: '#/platos', texto: 'Volver a los platos' })
      ]));
      return;
    }

    var mapa = {};
    estado.palergenos.forEach(function (x) { if (x.plato_id === p.id) mapa[x.alergeno_id] = x.grado; });
    var inicial = canon(mapa);
    guardia = function () { return canon(mapa) !== inicial; };

    var desc = t(p.descripcion);
    c.appendChild(el('article', { clase: 'revision' }, [
      el('p', { clase: 'rev-cat', texto: nombreCat(catDe(p)) }),
      el('h2', { clase: 'rev-nombre', texto: (p.numero ? p.numero + '. ' : '') + t(p.nombre) }),
      el('p', { clase: desc ? 'rev-desc' : 'rev-desc pista', texto: desc || 'La carta no dice qué lleva.' }),
      p.alergenos_revisados ? el('p', { clase: 'pista', texto: 'Revisado el ' + dia(p.alergenos_revisados) + '.' }) : null,
      el('p', { clase: 'pista', texto: '¿Lo lleva? Marca «Trazas» si puede tenerlo por contaminación en la cocina.' }),
      editorAlergenos(mapa)
    ]));

    var botonGuardar = el('button', { type: 'button', clase: 'btn btn-p', texto: 'Guardar y siguiente' });
    var botonSaltar = el('button', { type: 'button', clase: 'btn btn-s', texto: 'Saltar' });
    c.appendChild(el('div', { clase: 'acciones-fijas' }, [el('div', { clase: 'acciones-dentro' }, [botonSaltar, botonGuardar])]));

    botonSaltar.addEventListener('click', function () {
      var sig = siguienteSinRevisar(orden, p);
      if (!sig) { aviso('Es el único que queda por revisar.'); return; }
      compruebaSalida().then(function (ok) { if (ok) { reemplaza('/alergenos/' + sig.slug); window.scrollTo(0, 0); } });
    });

    botonGuardar.addEventListener('click', function () {
      botonGuardar.disabled = true;
      botonGuardar.textContent = 'Guardando…';
      var lista = Object.keys(mapa).sort(function (a, b) { return a - b; })
        .map(function (id) { return { id: Number(id), grado: mapa[id] }; });
      rpc('guarda_alergenos', { p_plato: p.id, p_alergenos: lista, p_revisados: true }).then(function (r) {
        estado.palergenos = estado.palergenos.filter(function (x) { return x.plato_id !== p.id; })
          .concat(lista.map(function (a) { return { plato_id: p.id, alergeno_id: a.id, grado: a.grado }; }));
        p.alergenos_revisados = (r && r.alergenos_revisados) || new Date().toISOString();
        guardia = null;
        recalculaPronto();
        anuncia('«' + t(p.nombre) + '» revisado.');
        var sig = siguienteSinRevisar(orden, p);
        reemplaza(sig ? '/alergenos/' + sig.slug : '/alergenos');
        window.scrollTo(0, 0);
      }).catch(function (x) {
        aviso(traduceError(x), { tipo: 'error' });
        botonGuardar.disabled = false;
        botonGuardar.textContent = 'Guardar y siguiente';
      });
    });
  }

  /* ================================================================== */
  /* 8 · pantallas: publicar, historial y ajustes                       */
  /* ================================================================== */

  function tarjeta(tipo, titulo, hijos) {
    var id = nuevoId('tj');
    return el('section', { clase: 'tarjeta tarjeta-' + tipo, 'aria-labelledby': id },
      [el('h2', { clase: 'tarjeta-tit', id: id, texto: titulo })].concat(hijos));
  }

  var GRUPOS_CAMBIO = [
    ['platos', 'Platos'], ['categorias', 'Secciones'], ['grupos', 'Opciones'],
    ['etiquetas', 'Etiquetas'], ['escalas', 'Niveles'], ['alergenos', 'Alérgenos']
  ];

  function listaCambios(d) {
    var caja = el('div', { clase: 'pub-cambios' });
    GRUPOS_CAMBIO.forEach(function (g) {
      var suyos = d.cambios.filter(function (x) { return x.grupo === g[0]; });
      if (!suyos.length) return;
      caja.appendChild(el('h3', { texto: g[1] }));
      caja.appendChild(el('ul', {}, suyos.map(function (x) {
        var existe = g[0] === 'platos' && x.slug && estado.platos.some(function (p) { return p.slug === x.slug; });
        return el('li', {}, [
          existe ? el('a', { href: '#/plato/' + encodeURIComponent(x.slug), texto: x.nombre }) : el('strong', { texto: x.nombre }),
          ' ' + x.que + '.'
        ]);
      })));
    });
    if (d.pdf) {
      caja.appendChild(el('h3', { texto: 'Carta en PDF' }));
      caja.appendChild(el('ul', {}, [el('li', { texto: 'Hay un PDF nuevo esperando.' })]));
    }
    return caja;
  }

  function listaProblemas(problemas) {
    return el('ul', { clase: 'pub-problemas-lista' }, problemas.map(function (x) {
      return el('li', {}, [
        el('span', { texto: x.texto }),
        x.slug && estado.platos.some(function (p) { return p.slug === x.slug; })
          ? el('a', { href: '#/plato/' + encodeURIComponent(x.slug), texto: 'Arreglar' }) : null
      ]);
    }));
  }

  function pintaPublicar(c) {
    c.appendChild(el('h1', { clase: 'pantalla-tit', texto: 'Publicar' }));
    c.appendChild(el('p', { clase: 'pista', texto: 'Lo que cambias en el panel no sale en la web hasta que publicas. ' +
      'Al publicar, la carta se vuelve a generar y se sube sola.' }));
    var zona = el('div', { clase: 'pub-zona' });
    c.appendChild(zona);
    var ultima = el('p', { clase: 'pista pub-ultima' });
    c.appendChild(ultima);
    c.appendChild(seccionPdf());

    /* «Publicado el…» sale de la última copia guardada, que solo existe si esa
       carta llegó a la web. Antes salía de assets/version.json, y esa fecha la
       movía cada mañana el cron de reseñas. */
    lee('publicaciones_lista', 'select=creado&limit=1').then(function (filas) {
      if (filas && filas.length) ultima.textContent = 'Última publicación: ' + fecha(filas[0].creado) + '.';
    }).catch(noop);

    var ultimoTitulo = null;
    function pinta() {
      zona.textContent = '';
      var s = seguimiento;
      var d = pub.datos;
      var nodo;

      if (s && !s.resultado) {
        var min = Math.max(0, Math.floor((Date.now() - s.desde) / 60000));
        nodo = tarjeta('curso', s.tipo === 'restaurar' ? 'Volviendo a la carta del ' + s.fecha : 'Publicando…', [
          el('p', { texto: s.tipo === 'restaurar'
            ? 'No cambies nada hasta que termine. Cuando llegue a la web, el panel se pone al día solo.'
            : 'Suele tardar un par de minutos. Puedes seguir usando el panel mientras tanto.' }),
          el('p', { clase: 'pista', texto: min < 1 ? 'Empezó hace menos de un minuto.' : 'Empezó hace ' + plural(min, 'minuto', 'minutos') + '.' })
        ]);
      } else if (s && s.resultado === 'ok') {
        nodo = tarjeta('bien', 'Ya está en la web', [
          el('div', { clase: 'tarjeta-acc' }, [
            el('a', { clase: 'btn btn-p', href: '/menu/', target: '_blank', rel: 'noopener', texto: 'Ver la carta' }),
            el('button', { type: 'button', clase: 'btn btn-s', texto: 'Entendido', onclick: function () {
              paraSeguimiento(); pintaEstadoPub();
            } })
          ])
        ]);
      } else if (s && s.resultado === 'tarde') {
        nodo = tarjeta('aviso', 'Todavía no ha llegado a la web', [
          el('p', { texto: 'Han pasado más de ' + (LIMITE[s.tipo] / 60000) + ' minutos. Puede que GitHub vaya lento, ' +
            'o que la publicación se haya rechazado.' }),
          d && d.problemas.length
            ? el('div', { clase: 'pub-problemas' }, [el('p', { texto: 'Esto la haría rechazar:' }), listaProblemas(d.problemas)])
            : el('p', { texto: 'Si dentro de un rato sigue igual, avisa a Yixuan.' }),
          el('div', { clase: 'tarjeta-acc' }, [
            el('button', { type: 'button', clase: 'btn btn-s', texto: 'Seguir esperando', onclick: function () {
              s.resultado = null; s.desde = Date.now(); guardaSeguimiento(); programaSondeo(1000); pintaEstadoPub();
            } }),
            el('button', { type: 'button', clase: 'btn-t', texto: 'Dejar de esperar', onclick: function () {
              paraSeguimiento(); pintaEstadoPub();
            } })
          ])
        ]);
      } else if (!d) {
        nodo = pub.error
          ? tarjeta('aviso', 'No se ha podido comprobar qué falta por publicar', [
              el('p', { texto: traduceError(pub.error) }),
              el('button', { type: 'button', clase: 'btn btn-s', texto: 'Reintentar', onclick: function () { calculaPendientes().catch(noop); } })
            ])
          : el('p', { clase: 'cargando', texto: 'Comprobando qué falta por publicar…' });
      } else if (!d.total) {
        nodo = tarjeta('bien', 'Todo está publicado', [el('p', { texto: 'Lo que hay en el panel es lo mismo que hay en la web.' })]);
      } else {
        var boton = el('button', { type: 'button', clase: 'btn btn-p btn-ancho', texto: 'Publicar ahora',
          disabled: d.problemas.length ? true : null });
        var hijos = [];
        if (d.problemas.length) {
          hijos.push(el('div', { clase: 'pub-problemas' }, [
            el('p', { clase: 'pub-problemas-tit', texto: 'Antes de publicar hay que arreglar esto, o la web rechaza la carta entera:' }),
            listaProblemas(d.problemas)
          ]));
        }
        hijos.push(listaCambios(d), boton);
        nodo = tarjeta('pendiente', plural(d.total, 'cambio sin publicar', 'cambios sin publicar'), hijos);
        boton.addEventListener('click', function () {
          boton.disabled = true;
          boton.textContent = 'Comprobando…';
          /* Se vuelve a leer la carta justo antes: es la que se va a esperar ver
             publicada, y así un cambio de hace un segundo también cuenta. */
          Promise.all([rpc('carta_json'), miraBuzon()]).then(function (r) {
            var problemas = problemasDe(r[0]);
            if (problemas.length) { d.problemas = problemas; pinta(); return; }
            boton.textContent = 'Publicando…';
            return publicarEnGithub({}).then(function () {
              empiezaSeguimiento({ tipo: 'publicar', desde: Date.now(), objetivo: canon(normalizaCarta(r[0])), pdf: !!r[1], resultado: null });
            });
          }).catch(function (x) {
            aviso(traduceError(x), { tipo: 'error' });
            pinta();
          });
        });
      }

      zona.appendChild(nodo);
      var titulo = nodo.querySelector ? (nodo.querySelector('.tarjeta-tit') || nodo).textContent : '';
      if (titulo !== ultimoTitulo) {
        if (ultimoTitulo !== null) anuncia(titulo);
        ultimoTitulo = titulo;
      }
    }
    repintaPublicar = pinta;
    pinta();
    calculaPendientes().catch(noop);
  }

  function seccionPdf() {
    var estadoPdf = el('p', { clase: 'pista', 'aria-live': 'polite', texto: 'Mirando si hay un PDF esperando…' });
    var entradaPdf = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
    var botonPdf = el('button', { type: 'button', clase: 'btn btn-s', texto: 'Elegir un PDF', onclick: function () { entradaPdf.click(); } });

    function refrescaBuzon() {
      return miraBuzon().then(function (o) {
        estadoPdf.textContent = o
          ? 'Hay un PDF esperando, subido el ' + fecha(o.updated_at) + ' (' +
            (((o.metadata && o.metadata.size) || 0) / 1048576).toFixed(1).replace('.', ',') + ' MB). Sale a la web cuando publiques.'
          : 'El PDF de la web es el último que se publicó.';
      }).catch(function () { estadoPdf.textContent = 'No se ha podido mirar si hay un PDF esperando.'; });
    }

    entradaPdf.addEventListener('change', function () {
      var archivo = this.files && this.files[0];
      if (!archivo) return;
      botonPdf.disabled = true;
      botonPdf.textContent = 'Subiendo…';
      subePdf(archivo).then(function () {
        aviso('PDF subido. Sale a la web cuando publiques.');
        recalculaPronto();
        return refrescaBuzon();
      }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); })
        .then(function () {
          botonPdf.disabled = false;
          botonPdf.textContent = 'Elegir un PDF';
          entradaPdf.value = '';
        });
    });
    refrescaBuzon();
    return seccion('La carta en PDF', [
      el('p', { clase: 'pista', texto: 'Es el que se abre desde «Ver la carta en PDF». Tiene que ser un PDF de menos de 8 MB.' }),
      estadoPdf,
      el('div', { clase: 'fila-botones' }, [botonPdf, entradaPdf])
    ]);
  }

  /* --- historial --- */
  function pintaHistorial(c) {
    c.appendChild(el('h1', { clase: 'pantalla-tit', texto: 'Historial' }));
    c.appendChild(el('p', { clase: 'pista', texto: 'Cada vez que publicas se guarda una copia de la carta entera, también ' +
      'los platos que están fuera de la carta y las secciones apagadas. Se guardan las diez últimas. Volver a una copia ' +
      'también se puede deshacer: antes de tocar nada se guarda cómo está la carta ahora.' }));
    var cargando = el('p', { clase: 'cargando', texto: 'Cargando el historial…' });
    var lista = el('ul', { clase: 'filas' });
    c.appendChild(cargando);
    c.appendChild(lista);

    lee('publicaciones_lista', 'select=*&limit=10').then(function (filas) {
      cargando.remove();
      if (!filas || !filas.length) {
        c.appendChild(el('p', { clase: 'vacio', texto: 'Todavía no hay ninguna copia. La primera se guarda la próxima vez que publiques.' }));
        return;
      }
      var ocupado = !!(seguimiento && !seguimiento.resultado);
      filas.forEach(function (p, i) {
        var sub = p.motivo === 'antes de restaurar' ? 'Copia automática antes de volver atrás' : (p.resumen || plural(p.platos, 'plato', 'platos'));
        lista.appendChild(el('li', { clase: 'fila' }, [
          el('div', { clase: 'fila-abre fila-quieta' }, [
            el('span', { clase: 'fila-nombre', texto: fecha(p.creado) }),
            el('span', { clase: 'fila-meta' }, [el('span', { texto: sub }), i === 0 ? el('span', { clase: 'chip chip-bien', texto: 'En la web' }) : null])
          ]),
          i === 0 ? null : el('button', { type: 'button', clase: 'btn btn-s btn-peq', texto: 'Volver a esta', disabled: ocupado ? true : null,
            onclick: function () { vuelveA(p); } })
        ]));
      });
    }).catch(function (x) {
      cargando.textContent = 'No se ha podido cargar el historial.';
      aviso(traduceError(x), { tipo: 'error' });
    });
  }

  function vuelveA(p) {
    var cuando = fecha(p.creado);
    confirma({
      titulo: '¿Volver a la carta del ' + cuando + '?',
      texto: 'Se pierde todo lo que hayas cambiado desde entonces, también lo que esté sin publicar y los alérgenos ' +
        'revisados después. Antes de tocar nada se guarda una copia de cómo está la carta ahora, así que se puede deshacer.',
      si: 'Volver a esa carta', no: 'Cancelar', peligro: true
    }).then(function (ok) {
      if (!ok) return;
      return publicarEnGithub({ restaurar: p.id }).then(function () {
        empiezaSeguimiento({ tipo: 'restaurar', desde: Date.now(), objetivo: null, pdf: false, fecha: cuando, resultado: null });
        navega('/publicar');
      });
    }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); });
  }

  /* --- ajustes --- */
  var ICONOS_CAT = [['ramen', 'Ramen'], ['arroz', 'Arroz'], ['tapa', 'Tapa'], ['bebida', 'Bebida'],
    ['postre', 'Postre'], ['coctel', 'Cóctel'], ['generico', 'Genérico']];
  /* build.mjs casa 'punto' con el icono esc-nivel (ICO_ESC). */
  var ICONOS_ESC = [['chile', 'Chile', 'esc-chile'], ['caldo', 'Cuenco', 'esc-caldo'], ['punto', 'Barras', 'esc-nivel']];
  var icoEscala = function (icono) {
    var x = ICONOS_ESC.filter(function (i) { return i[0] === icono; })[0];
    return x ? x[2] : 'esc-nivel';
  };

  var siguienteOrdenDe = function (lista) {
    return lista.reduce(function (m, x) { return Math.max(m, x.orden || 0); }, 0) + 1;
  };

  function selectorIconos(leyenda, opciones, valor, alCambiar) {
    var nombre = nuevoId('ic');
    return el('fieldset', { clase: 'campo iconos' }, [
      el('legend', { texto: leyenda }),
      el('div', { clase: 'iconos-ops' }, opciones.map(function (op) {
        var input = el('input', { type: 'radio', name: nombre, value: op.valor, clase: 'seg-radio' });
        input.checked = op.valor === valor;
        input.addEventListener('change', function () { if (input.checked) alCambiar(op.valor); });
        return el('label', { clase: 'icono-op' }, [input, el('span', { clase: 'icono-cara' }, [ico(op.icono, 'ico-marcador'), el('span', { texto: op.texto })])]);
      }))
    ]);
  }

  function errorNombre(nombre, texto) {
    var input = nombre.entradas.es;
    var nodo = marcaError(input, texto, nombre.nodo);
    input.parentNode.parentNode.insertBefore(nodo, input.parentNode.nextSibling);
    input.focus();
  }

  function campoCorto(etiqueta, valor, pista, alCambiar) {
    var input = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', clase: 'corto' });
    input.value = valor;
    input.addEventListener('input', function () { alCambiar(input.value); });
    return { nodo: campo(etiqueta, input, pista), input: input };
  }

  /* Pie común de una hoja: Borrar a la izquierda, lejos de Guardar. */
  function pieHoja(nuevo, textoGuardar, guarda, borra, cancelar) {
    var botonG = el('button', { type: 'button', clase: 'btn btn-p', texto: textoGuardar, onclick: guarda });
    return {
      boton: botonG,
      nodos: [
        nuevo ? null : el('button', { type: 'button', clase: 'btn-t btn-peligro-t', texto: 'Borrar', onclick: borra }),
        el('span', { clase: 'hoja-hueco' }),
        el('button', { type: 'button', clase: 'btn btn-s', texto: 'Cancelar', onclick: cancelar }),
        botonG
      ]
    };
  }

  function trasGuardar(hoja, repinta, mensaje) {
    return cargaTodo().then(function () {
      hoja.cierra();
      recalculaPronto();
      repinta();
      aviso(mensaje);
    });
  }

  /* categorías */
  function platosEn(cat) {
    var ids = [cat.id].concat((idx.hijas[cat.id] || []).map(function (h) { return h.id; }));
    return estado.platos.filter(function (p) { return ids.indexOf(p.categoria_id) !== -1; });
  }

  function filaCategoria(cat, repinta) {
    var hija = !!(cat.padre_id && idx.cat[cat.padre_id]);
    var meta = [el('span', { texto: plural(platosEn(cat).length, 'plato', 'platos') })];
    if (cat.activa === false) meta.push(el('span', { clase: 'chip chip-aviso', texto: 'Apagada' }));
    return el('li', { clase: 'fila' + (hija ? ' fila-hija' : '') }, [
      el('button', { type: 'button', clase: 'fila-abre', onclick: function () { editorCategoria(cat, repinta); } }, [
        el('span', { clase: 'fila-nombre' }, [ico('pl-' + (cat.icono || 'generico'), 'ico-marcador'), el('span', { texto: t(cat.nombre) })]),
        el('span', { clase: 'fila-meta' }, meta)
      ])
    ]);
  }

  function editorCategoria(cat, repinta) {
    var nueva = !cat;
    var tieneHijas = !nueva && (idx.hijas[cat.id] || []).length > 0;
    var d = {
      nombre: copia(cat && cat.nombre), descripcion: copia(cat && cat.descripcion),
      padre_id: cat && cat.padre_id ? cat.padre_id : '', icono: (cat && cat.icono) || 'generico',
      orden: cat ? String(cat.orden || 0) : String(siguienteOrdenDe(idx.madres)),
      activa: cat ? cat.activa !== false : true
    };
    var inicial = canon(d);
    var cuerpoH = el('div', { clase: 'form-hoja' });
    var nombre = campoIdiomas({ titulo: 'Nombre', obj: d.nombre, obligatorio: true });
    cuerpoH.appendChild(nombre.nodo);
    cuerpoH.appendChild(filaInterruptor({
      etiqueta: 'Sale en la carta', activo: d.activa,
      pista: 'Si la apagas, la sección y sus platos desaparecen de la web al publicar. No se borra nada.',
      alCambiar: function (on) { d.activa = on; }
    }));

    var padre = el('select', {}, [el('option', { value: '', texto: 'Ninguna: es una sección principal' })].concat(
      idx.madres.filter(function (m) { return nueva || m.id !== cat.id; })
        .map(function (m) { return el('option', { value: m.id, texto: t(m.nombre) }); })));
    padre.value = d.padre_id;
    if (tieneHijas) padre.disabled = true;
    cuerpoH.appendChild(campo('Dentro de', padre,
      tieneHijas ? 'Tiene subsecciones, así que no puede ir dentro de otra: solo hay dos niveles.' : null));

    /* La carta solo pinta la descripción de las secciones principales
       (build.mjs, menuCarta): en una subsección no se enseña para no engañar. */
    var descripcion = campoPestanas({ titulo: 'Descripción', obj: d.descripcion, multilinea: true,
      pista: 'Sale debajo del título de la sección en la carta.' });
    cuerpoH.appendChild(descripcion);
    var orden = campoCorto('Orden', d.orden, 'Número más bajo, más arriba.', function (v) { d.orden = v; });
    padre.addEventListener('change', function () {
      d.padre_id = padre.value;
      descripcion.hidden = !!d.padre_id;
      if (nueva) {
        d.orden = String(siguienteOrdenDe(d.padre_id ? (idx.hijas[d.padre_id] || []) : idx.madres));
        orden.input.value = d.orden;
      }
    });
    descripcion.hidden = !!d.padre_id;
    cuerpoH.appendChild(selectorIconos('Marcador de sus platos sin foto',
      ICONOS_CAT.map(function (x) { return { valor: x[0], texto: x[1], icono: 'pl-' + x[0] }; }),
      d.icono, function (v) { d.icono = v; }));
    cuerpoH.appendChild(orden.nodo);

    function guarda() {
      limpiaErroresEn(cuerpoH);
      if (!(d.nombre.es || '').trim()) { errorNombre(nombre, 'Escribe el nombre en español.'); return; }
      var fila = {
        nombre: limpiaTexto(d.nombre),
        descripcion: d.padre_id ? ((cat && cat.descripcion) || {}) : limpiaTexto(d.descripcion),
        padre_id: d.padre_id || null, icono: d.icono, orden: parseInt(d.orden, 10) || 0, activa: d.activa
      };
      if (nueva) fila.slug = slugUnico(slugifica(d.nombre.es), estado.categorias.map(function (x) { return x.slug; }));
      pie.boton.disabled = true;
      (nueva ? inserta('categorias', [fila]) : parchea('categorias', 'id=eq.' + cat.id, fila))
        .then(function () { return trasGuardar(hoja, repinta, 'Guardado. Sale en la web cuando publiques.'); })
        .catch(function (x) { pie.boton.disabled = false; aviso(traduceError(x), { tipo: 'error' }); });
    }

    /* Borrar dice lo que arrastra. Una categoría con platos no se borra (la
       clave ajena es RESTRICT y antes salía el error crudo), y una madre se
       lleva sus hijas por cascada: se avisa antes. */
    function borra() {
      var hijas = idx.hijas[cat.id] || [];
      var n = platosEn(cat).length;
      if (n) {
        confirma({ titulo: 'No se puede borrar «' + t(cat.nombre) + '»',
          texto: 'Tiene ' + plural(n, 'plato', 'platos') + '. Muévelos antes a otra categoría, o apágala para que no salga en la carta.',
          acciones: [{ valor: false, texto: 'Entendido', clase: 'btn btn-p' }] });
        return;
      }
      confirma({ titulo: '¿Borrar «' + t(cat.nombre) + '»?',
        texto: hijas.length
          ? 'También se borran sus ' + plural(hijas.length, 'subsección', 'subsecciones') + ', que están vacías.'
          : 'No tiene platos, así que no se pierde nada más.',
        si: 'Borrar', no: 'Cancelar', peligro: true
      }).then(function (ok) {
        if (!ok) return;
        return elimina('categorias', 'id=eq.' + cat.id).then(function () {
          return trasGuardar(hoja, repinta, '«' + t(cat.nombre) + '» borrada.');
        });
      }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); });
    }

    var pie = pieHoja(nueva, nueva ? 'Crear' : 'Guardar', guarda, borra, function () { hoja.intentaCerrar(); });
    var hoja = abreHoja({ titulo: nueva ? 'Categoría nueva' : 'Editar «' + t(cat.nombre) + '»', cuerpo: cuerpoH, pie: pie.nodos,
      sucio: function () { return canon(d) !== inicial; } });
  }

  /* niveles */
  function filaNivel(e, repinta) {
    var n = estado.pescalas.filter(function (x) { return x.escala_id === e.id && x.valor > 0; }).length;
    return el('li', { clase: 'fila' }, [
      el('button', { type: 'button', clase: 'fila-abre', onclick: function () { editorNivel(e, repinta); } }, [
        el('span', { clase: 'fila-nombre' }, [ico(icoEscala(e.icono), 'ico-marcador'), el('span', { texto: t(e.nombre) })]),
        el('span', { clase: 'fila-meta', texto: 'Hasta ' + e.maximo + ' · ' + (n === 1 ? '1 plato lo usa' : n + ' platos lo usan') })
      ])
    ]);
  }

  function editorNivel(e, repinta) {
    var nuevo = !e;
    var d = {
      nombre: copia(e && e.nombre), maximo: String(e ? e.maximo : 3), icono: (e && e.icono) || 'punto',
      orden: String(e ? e.orden || 0 : siguienteOrdenDe(estado.escalas))
    };
    var inicial = canon(d);
    var cuerpoH = el('div', { clase: 'form-hoja' });
    var nombre = campoIdiomas({ titulo: 'Nombre', obj: d.nombre, obligatorio: true });
    var maximo = campoCorto('Máximo', d.maximo, 'Hasta cuántos puntos llega. El picante llega a 3.', function (v) { d.maximo = v; });
    var orden = campoCorto('Orden', d.orden, 'Número más bajo, más arriba.', function (v) { d.orden = v; });
    cuerpoH.appendChild(nombre.nodo);
    cuerpoH.appendChild(maximo.nodo);
    cuerpoH.appendChild(selectorIconos('Icono', ICONOS_ESC.map(function (x) { return { valor: x[0], texto: x[1], icono: x[2] }; }),
      d.icono, function (v) { d.icono = v; }));
    cuerpoH.appendChild(orden.nodo);

    function guarda() {
      limpiaErroresEn(cuerpoH);
      if (!(d.nombre.es || '').trim()) { errorNombre(nombre, 'Escribe el nombre en español.'); return; }
      var max = parseInt(d.maximo, 10);
      if (!(max >= 1 && max <= 10) || String(max) !== String(d.maximo).trim()) {
        marcaError(maximo.input, 'Tiene que ser un número del 1 al 10.', maximo.nodo);
        maximo.input.focus();
        return;
      }
      if (!nuevo) {
        var altos = estado.pescalas.filter(function (x) { return x.escala_id === e.id && x.valor > max; }).length;
        if (altos) {
          marcaError(maximo.input, 'Hay ' + plural(altos, 'plato', 'platos') + ' con un nivel por encima de ' + max +
            '. Bájaselo antes de acortar la escala.', maximo.nodo);
          maximo.input.focus();
          return;
        }
      }
      var fila = { nombre: limpiaTexto(d.nombre), maximo: max, icono: d.icono, orden: parseInt(d.orden, 10) || 0 };
      if (nuevo) fila.slug = slugUnico(slugifica(d.nombre.es), estado.escalas.map(function (x) { return x.slug; }));
      pie.boton.disabled = true;
      (nuevo ? inserta('escalas', [fila]) : parchea('escalas', 'id=eq.' + e.id, fila))
        .then(function () { return trasGuardar(hoja, repinta, 'Guardado. Sale en la web cuando publiques.'); })
        .catch(function (x) { pie.boton.disabled = false; aviso(traduceError(x), { tipo: 'error' }); });
    }

    function borra() {
      var n = estado.pescalas.filter(function (x) { return x.escala_id === e.id; }).length;
      confirma({ titulo: '¿Borrar «' + t(e.nombre) + '»?',
        texto: n ? 'Lo usan ' + plural(n, 'plato', 'platos') + '. Si lo borras, se les quita a todos.' : 'Ningún plato lo usa.',
        si: 'Borrar', no: 'Cancelar', peligro: true
      }).then(function (ok) {
        if (!ok) return;
        return elimina('escalas', 'id=eq.' + e.id).then(function () {
          return trasGuardar(hoja, repinta, '«' + t(e.nombre) + '» borrado.');
        });
      }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); });
    }

    var pie = pieHoja(nuevo, nuevo ? 'Crear' : 'Guardar', guarda, borra, function () { hoja.intentaCerrar(); });
    var hoja = abreHoja({ titulo: nuevo ? 'Nivel nuevo' : 'Editar «' + t(e.nombre) + '»', cuerpo: cuerpoH, pie: pie.nodos,
      sucio: function () { return canon(d) !== inicial; } });
  }

  /* grupos de opciones */
  function filaGrupo(g, repinta) {
    var ops = estado.opciones.filter(function (o) { return o.grupo_id === g.id; }).length;
    var usos = estado.pgrupos.filter(function (x) { return x.grupo_id === g.id; }).length;
    return el('li', { clase: 'fila' }, [
      el('button', { type: 'button', clase: 'fila-abre', onclick: function () { editorGrupo(g, repinta); } }, [
        el('span', { clase: 'fila-nombre', texto: t(g.nombre) }),
        el('span', { clase: 'fila-meta', texto: plural(ops, 'opción', 'opciones') + ' · ' + plural(usos, 'plato', 'platos') +
          ' · ' + (g.tipo === 'multiple' ? 'se eligen varias' : 'se elige una') })
      ])
    ]);
  }

  function editorGrupo(g, repinta) {
    var nuevo = !g;
    var d = {
      nombre: copia(g && g.nombre), tipo: (g && g.tipo) || 'unica',
      orden: String(g ? g.orden || 0 : siguienteOrdenDe(estado.grupos)),
      opciones: g ? estado.opciones.filter(function (o) { return o.grupo_id === g.id; }).sort(porOrden).map(function (o) {
        return { slug: o.slug, nombre: copia(o.nombre), texto: o.incremento == null ? '' : escribePrecio(o.incremento) };
      }) : []
    };
    var inicial = canon(d);
    var cuerpoH = el('div', { clase: 'form-hoja' });
    var nombre = campoIdiomas({ titulo: 'Nombre del grupo', obj: d.nombre, obligatorio: true });
    cuerpoH.appendChild(nombre.nodo);
    cuerpoH.appendChild(segmentado({
      leyenda: 'Cómo se elige', leyendaVisible: true, valor: d.tipo, clase: 'seg-ancho',
      opciones: [{ valor: 'unica', texto: 'Una sola' }, { valor: 'multiple', texto: 'Varias' }],
      alCambiar: function (v) { d.tipo = v; }
    }));

    var zona = el('div', { clase: 'opciones' });
    var cajaOps = el('fieldset', { clase: 'campo' }, [
      el('legend', { texto: 'Opciones' }),
      el('p', { clase: 'pista', texto: 'El suplemento: 0 si no cuesta nada, y vacío si hay que preguntarlo (la carta pone «Pregúntanos»).' }),
      zona
    ]);
    cuerpoH.appendChild(cajaOps);

    function pintaOps(focoEn) {
      zona.textContent = '';
      d.opciones.forEach(function (o, i) {
        var nombreO = campoCompacto(o.nombre, { etiqueta: 'Opción ' + (i + 1), placeholder: 'Nombre de la opción' });
        var precio = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '—', clase: 'precio-in',
          'aria-label': 'Suplemento de la opción ' + (i + 1) });
        precio.value = o.texto;
        precio.addEventListener('input', function () { o.texto = precio.value; });
        var mueve = function (delta) {
          var j = i + delta;
          var tmp = d.opciones[i]; d.opciones[i] = d.opciones[j]; d.opciones[j] = tmp;
          pintaOps();
          var btn = zona.querySelectorAll('.opcion-fila')[j].querySelector(delta < 0 ? '.sube' : '.baja');
          (btn && !btn.disabled ? btn : zona.querySelectorAll('.opcion-fila')[j].querySelector('input')).focus();
        };
        zona.appendChild(el('div', { clase: 'opcion-fila' }, [
          el('div', { clase: 'opcion-nombre' }, [nombreO.es]),
          el('div', { clase: 'precio-caja' }, [precio, el('span', { clase: 'precio-eur', 'aria-hidden': 'true', texto: '€' })]),
          el('div', { clase: 'opcion-acc' }, [
            el('button', { type: 'button', clase: 'btn-icono sube', 'aria-label': 'Subir la opción ' + (i + 1),
              disabled: i === 0 ? true : null, onclick: function () { mueve(-1); } }, [ico('pn-arriba')]),
            el('button', { type: 'button', clase: 'btn-icono baja', 'aria-label': 'Bajar la opción ' + (i + 1),
              disabled: i === d.opciones.length - 1 ? true : null, onclick: function () { mueve(1); } }, [ico('pn-abajo')]),
            el('button', { type: 'button', clase: 'btn-icono', 'aria-label': 'Quitar la opción ' + (i + 1),
              onclick: function () { d.opciones.splice(i, 1); pintaOps(); anadir.focus(); } }, [ico('pn-cerrar')])
          ]),
          nombreO.boton, nombreO.otros
        ]));
        if (focoEn === i) nombreO.es.focus();
      });
      var anadir = el('button', { type: 'button', clase: 'btn-t btn-anadir', onclick: function () {
        d.opciones.push({ slug: null, nombre: {}, texto: '0,00' });
        pintaOps(d.opciones.length - 1);
      } }, [ico('pn-mas', 'ico-peq'), el('span', { texto: 'Añadir una opción' })]);
      zona.appendChild(anadir);
    }
    pintaOps();
    var orden = campoCorto('Orden', d.orden, 'Número más bajo, más arriba.', function (v) { d.orden = v; });
    cuerpoH.appendChild(orden.nodo);

    function guarda() {
      limpiaErroresEn(cuerpoH);
      if (!(d.nombre.es || '').trim()) { errorNombre(nombre, 'Escribe el nombre en español.'); return; }
      if (d.opciones.some(function (o) { return !(o.nombre.es || '').trim(); })) {
        marcaError(null, 'Cada opción necesita su nombre en español.', cajaOps);
        var vacia = Array.prototype.filter.call(zona.querySelectorAll('.opcion-nombre input'), function (i) { return !i.value.trim(); })[0];
        if (vacia) vacia.focus();
        return;
      }
      if (d.opciones.some(function (o) { return isNaN(leePrecio(o.texto)); })) {
        marcaError(null, 'Escribe el suplemento con números, por ejemplo 1,50.', cajaOps);
        return;
      }
      var usados = d.opciones.map(function (o) { return o.slug; }).filter(Boolean);
      var payload = {
        id: g ? g.id : null,
        slug: g ? g.slug : slugUnico(slugifica(d.nombre.es), estado.grupos.map(function (x) { return x.slug; })),
        nombre: limpiaTexto(d.nombre), tipo: d.tipo, orden: parseInt(d.orden, 10) || 0,
        opciones: d.opciones.map(function (o) {
          var slug = o.slug;
          if (!slug) { slug = slugUnico(slugifica(o.nombre.es), usados); usados.push(slug); }
          return { slug: slug, nombre: limpiaTexto(o.nombre), incremento: leePrecio(o.texto) };
        })
      };
      pie.boton.disabled = true;
      rpc('guarda_grupo', { g: payload })
        .then(function () { return trasGuardar(hoja, repinta, 'Guardado. Sale en la web cuando publiques.'); })
        .catch(function (x) { pie.boton.disabled = false; aviso(traduceError(x), { tipo: 'error' }); });
    }

    function borra() {
      var usos = estado.pgrupos.filter(function (x) { return x.grupo_id === g.id; }).length;
      confirma({ titulo: '¿Borrar «' + t(g.nombre) + '»?',
        texto: usos ? 'Lo llevan ' + plural(usos, 'plato', 'platos') + '. Si lo borras, desaparece de todos, con sus opciones.'
          : 'Ningún plato lo lleva.',
        si: 'Borrar', no: 'Cancelar', peligro: true
      }).then(function (ok) {
        if (!ok) return;
        return elimina('grupos_opcion', 'id=eq.' + g.id).then(function () {
          return trasGuardar(hoja, repinta, '«' + t(g.nombre) + '» borrado.');
        });
      }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); });
    }

    var pie = pieHoja(nuevo, nuevo ? 'Crear' : 'Guardar', guarda, borra, function () { hoja.intentaCerrar(); });
    var hoja = abreHoja({ titulo: nuevo ? 'Grupo de opciones nuevo' : 'Editar «' + t(g.nombre) + '»', cuerpo: cuerpoH, pie: pie.nodos,
      sucio: function () { return canon(d) !== inicial; } });
  }

  /* etiquetas */
  function filaEtiqueta(e, repinta) {
    var n = estado.petiquetas.filter(function (x) { return x.etiqueta_id === e.id; }).length;
    return el('li', { clase: 'fila' }, [
      el('button', { type: 'button', clase: 'fila-abre', onclick: function () { editorEtiqueta(e, repinta); } }, [
        el('span', { clase: 'fila-nombre', texto: t(e.nombre) }),
        el('span', { clase: 'fila-meta', texto: plural(n, 'plato', 'platos') })
      ])
    ]);
  }

  function editorEtiqueta(e, repinta) {
    var nueva = !e;
    var d = { nombre: copia(e && e.nombre), orden: String(e ? e.orden || 0 : siguienteOrdenDe(estado.etiquetas)) };
    var inicial = canon(d);
    var cuerpoH = el('div', { clase: 'form-hoja' });
    var nombre = campoIdiomas({ titulo: 'Nombre', obj: d.nombre, obligatorio: true });
    var orden = campoCorto('Orden', d.orden, 'Número más bajo, más arriba.', function (v) { d.orden = v; });
    cuerpoH.appendChild(nombre.nodo);
    cuerpoH.appendChild(orden.nodo);

    function guarda() {
      limpiaErroresEn(cuerpoH);
      if (!(d.nombre.es || '').trim()) { errorNombre(nombre, 'Escribe el nombre en español.'); return; }
      var fila = { nombre: limpiaTexto(d.nombre), orden: parseInt(d.orden, 10) || 0, icono: (e && e.icono) || 'hoja' };
      if (nueva) fila.slug = slugUnico(slugifica(d.nombre.es), estado.etiquetas.map(function (x) { return x.slug; }));
      pie.boton.disabled = true;
      (nueva ? inserta('etiquetas', [fila]) : parchea('etiquetas', 'id=eq.' + e.id, fila))
        .then(function () { return trasGuardar(hoja, repinta, 'Guardado. Sale en la web cuando publiques.'); })
        .catch(function (x) { pie.boton.disabled = false; aviso(traduceError(x), { tipo: 'error' }); });
    }

    function borra() {
      var n = estado.petiquetas.filter(function (x) { return x.etiqueta_id === e.id; }).length;
      confirma({ titulo: '¿Borrar «' + t(e.nombre) + '»?',
        texto: n ? '«' + t(e.nombre) + '» está en ' + plural(n, 'plato', 'platos') + ' y se quitará de todos.' : 'Ningún plato la lleva.',
        si: 'Borrar', no: 'Cancelar', peligro: true
      }).then(function (ok) {
        if (!ok) return;
        return elimina('etiquetas', 'id=eq.' + e.id).then(function () {
          return trasGuardar(hoja, repinta, '«' + t(e.nombre) + '» borrada.');
        });
      }).catch(function (x) { aviso(traduceError(x), { tipo: 'error' }); });
    }

    var pie = pieHoja(nueva, nueva ? 'Crear' : 'Guardar', guarda, borra, function () { hoja.intentaCerrar(); });
    var hoja = abreHoja({ titulo: nueva ? 'Etiqueta nueva' : 'Editar «' + t(e.nombre) + '»', cuerpo: cuerpoH, pie: pie.nodos,
      sucio: function () { return canon(d) !== inicial; } });
  }

  var AJUSTES = {
    categorias: {
      titulo: 'Categorías', nuevo: 'Categoría nueva',
      pista: 'Las secciones de la carta. Una puede ir dentro de otra, como «Gyozas» dentro de «Tapas», y no hay más de dos niveles.',
      resumen: function () {
        return plural(idx.madres.length, 'sección', 'secciones') + ' y ' +
          plural(estado.categorias.length - idx.madres.length, 'subsección', 'subsecciones');
      },
      filas: function () {
        var r = [];
        idx.madres.forEach(function (m) { r.push(m); (idx.hijas[m.id] || []).forEach(function (h) { r.push(h); }); });
        return r;
      },
      fila: filaCategoria, editor: editorCategoria
    },
    niveles: {
      titulo: 'Niveles', nuevo: 'Nivel nuevo',
      pista: 'Escalas como el picante, que salen con puntos en la ficha del plato. Se crean aquí y se marcan desde cada plato.',
      resumen: function () { return estado.escalas.slice().sort(porOrden).map(function (e) { return t(e.nombre); }).join(', ') || 'Ninguno'; },
      filas: function () { return estado.escalas.slice().sort(porOrden); },
      fila: filaNivel, editor: editorNivel
    },
    opciones: {
      titulo: 'Opciones', nuevo: 'Grupo nuevo',
      pista: 'Extras, sabores, intensidad del caldo… Un grupo se engancha a muchos platos y se cambia una sola vez.',
      resumen: function () { return plural(estado.grupos.length, 'grupo', 'grupos') + ' con ' + plural(estado.opciones.length, 'opción', 'opciones'); },
      filas: function () { return estado.grupos.slice().sort(porOrden); },
      fila: filaGrupo, editor: editorGrupo
    },
    etiquetas: {
      titulo: 'Etiquetas', nuevo: 'Etiqueta nueva',
      pista: 'Vegano, vegetariano… Es con lo que la gente filtra la carta.',
      resumen: function () { return estado.etiquetas.slice().sort(porOrden).map(function (e) { return t(e.nombre); }).join(', ') || 'Ninguna'; },
      filas: function () { return estado.etiquetas.slice().sort(porOrden); },
      fila: filaEtiqueta, editor: editorEtiqueta
    }
  };

  function pintaAjustes(c, sub) {
    if (!sub) {
      c.appendChild(el('h1', { clase: 'pantalla-tit', texto: 'Ajustes de la carta' }));
      c.appendChild(el('p', { clase: 'pista', texto: 'Lo que se toca poco. Los platos se cambian desde Platos.' }));
      c.appendChild(el('ul', { clase: 'hub' }, Object.keys(AJUSTES).map(function (k) {
        var a = AJUSTES[k];
        return el('li', {}, [el('a', { clase: 'hub-i', href: '#/ajustes/' + k }, [
          el('span', { clase: 'hub-txt' }, [el('strong', { texto: a.titulo }), el('span', { texto: a.resumen() })]),
          ico('pn-derecha', 'ico-peq')
        ])]);
      })));
      return;
    }
    var def = AJUSTES[sub];
    if (!def) { reemplaza('/ajustes'); return; }
    c.appendChild(el('div', { clase: 'pantalla-cab' }, [
      el('a', { clase: 'volver', href: '#/ajustes', onclick: function (e) { e.preventDefault(); vuelve('/ajustes'); } },
        [ico('pn-atras', 'ico-peq'), el('span', { texto: 'Ajustes' })]),
      el('h1', { texto: def.titulo })
    ]));
    c.appendChild(el('p', { clase: 'pista', texto: def.pista }));
    var lista = el('ul', { clase: 'filas' });
    function repinta() {
      lista.textContent = '';
      def.filas().forEach(function (x) { lista.appendChild(def.fila(x, repinta)); });
      if (!lista.children.length) lista.appendChild(el('li', { clase: 'vacio', texto: 'Todavía no hay ninguno.' }));
    }
    c.appendChild(el('div', { clase: 'fila-botones' }, [
      el('button', { type: 'button', clase: 'btn btn-p', onclick: function () { def.editor(null, repinta); } },
        [ico('pn-mas', 'ico-peq'), el('span', { texto: def.nuevo })])
    ]));
    c.appendChild(lista);
    repinta();
  }

  /* ================================================================== */
  /* 9 · arranque                                                       */
  /* ================================================================== */

  function render() {
    if (!sesion || !estado) return;
    var ruta = rutaDeHash();
    if (rutaActual === '/platos' && ruta !== '/platos') estadoLista.scroll = window.scrollY;
    guardia = null;
    repintaPublicar = null;
    rutaActual = ruta;
    ultimoIndice = indiceHistoria();
    limpiaAvisosDeContexto();
    Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) { if (d.open) d.close(); d.remove(); });

    var partes = ruta.split('/').filter(Boolean);
    var pantalla = partes[0] || 'platos';
    var arg = partes.slice(1).join('/');
    var conAcciones = pantalla === 'plato' || pantalla === 'alergenos';
    var c = pintaArmazon(pantalla, conAcciones);
    if (pantalla !== 'platos') window.scrollTo(0, 0);

    if (pantalla === 'platos') pintaPlatos(c);
    else if (pantalla === 'plato') pintaFicha(c, arg || 'nuevo');
    else if (pantalla === 'alergenos') pintaRevision(c, arg);
    else if (pantalla === 'publicar') pintaPublicar(c);
    else if (pantalla === 'historial') pintaHistorial(c);
    else if (pantalla === 'ajustes') pintaAjustes(c, arg);
    else { reemplaza('/platos'); return; }

    pintaEstadoPub();
    /* Al cambiar de pantalla, el foco pasa al contenido nuevo: el elemento que
       lo tenía ya no existe. La lista pone el suyo después, si vuelve a un plato. */
    if (!document.activeElement || document.activeElement === document.body) c.focus({ preventScroll: true });
  }

  function arranca() {
    $('#app').innerHTML = '<p class="cargando">Cargando la carta…</p>';
    return cargaTodo().then(function () {
      /* Con RLS, una cuenta que no es admin no recibe un error: recibe listas
         vacías. Los 14 alérgenos están siempre, así que su ausencia lo delata. */
      if (!estado.alergenos.length) {
        olvidaSesion();
        estado = null;
        pintaEntrada('Esa cuenta existe, pero no puede cambiar la carta. Pídele a Yixuan que le dé permiso.');
        return;
      }
      if (!/^#\//.test(location.hash)) history.replaceState({ i: 1 }, '', '#/platos');
      else if (!indiceHistoria()) history.replaceState({ i: 1 }, '', location.hash);
      rutaActual = null;
      render();
      calculaPendientes().catch(noop);
      reanudaSeguimiento();
    }).catch(function (x) {
      estado = null;
      if (x && x.estado === 401) { olvidaSesion(); pintaEntrada('La sesión ha caducado. Vuelve a entrar.'); }
      else pintaEntrada('No se ha podido cargar la carta. ' + traduceError(x));
    });
  }

  document.body.insertAdjacentHTML('afterbegin', ICONOS_PANEL);
  if (!$('#avisos')) document.body.appendChild(el('div', { id: 'avisos', clase: 'avisos' }));

  fetch('/content/supabase.json').then(function (r) { return r.json(); }).then(function (c) {
    cfg = c;
    if (!cfg.anon || cfg.anon === 'PENDIENTE') {
      $('#app').innerHTML = '<main class="entrada-env"><div class="entrada"><h1>Falta la clave</h1>' +
        '<p class="entrada-sub">Pega la clave publicable de Supabase en <code>content/supabase.json</code> ' +
        'y vuelve a construir. Está en Project Settings → API.</p></div></main>';
      return;
    }
    try { sesion = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null'); } catch (e) { sesion = null; }
    if (sesion && sesion.refresh_token) {
      refresca().then(arranca).catch(function (x) {
        if (x && x.red) pintaEntrada('No hay conexión. Comprueba la red y vuelve a cargar la página.');
        else if (sesion) pintaEntrada();
      });
    } else {
      pintaEntrada();
    }
  }).catch(function () {
    $('#app').innerHTML = '<main class="entrada-env"><div class="entrada"><h1>Sin configuración</h1>' +
      '<p class="entrada-sub">No se encuentra <code>/content/supabase.json</code>.</p></div></main>';
  });
})();
