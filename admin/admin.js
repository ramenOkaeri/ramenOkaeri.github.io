/* Panel de la carta de Ramen Okaeri.
   Sin dependencias, igual que el resto del sitio: PostgREST y GoTrue son dos
   APIs REST y no hacen falta 60 KB de librería para hablar con ellas.

   ESTA ES LA ÚNICA PÁGINA DEL SITIO QUE HABLA CON UN TERCERO. La web pública
   no toca Supabase: lee el HTML que tools/carta.mjs horneó al construir. Por
   eso el visitante sigue sin cookies, sin almacenamiento y sin peticiones fuera
   del dominio, y esa propiedad no se pierde por tener un panel. */
(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var IDIOMAS = ['es', 'en', 'gl'];
  var CLAVE_SESION = 'okaeri.panel.sesion';

  var cfg = null;
  var sesion = null;
  var estado = {};
  var pestana = 'platos';
  var editando = null;

  /* ------------------------------------------------------------------ */
  /* utilidades                                                          */
  /* ------------------------------------------------------------------ */
  function el(tag, props, hijos) {
    var e = document.createElement(tag);
    for (var k in props || {}) {
      if (k === 'clase') e.className = props[k];
      else if (k === 'texto') e.textContent = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== null && props[k] !== undefined && props[k] !== false) e.setAttribute(k, props[k]);
    }
    (hijos || []).forEach(function (h) { if (h) e.appendChild(h); });
    return e;
  }
  var t = function (o, l) { return (o && (o[l || 'es'] || o.es)) || ''; };
  var eur = function (n) { return n == null ? '—' : Number(n).toFixed(2).replace('.', ',') + ' €'; };

  function aviso(msg, tipo) {
    var caja = $('#aviso');
    caja.textContent = msg;
    caja.className = 'aviso ' + (tipo || 'ok');
    caja.hidden = false;
    if (tipo !== 'error') setTimeout(function () { caja.hidden = true; }, 4000);
  }

  function slugifica(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /* ------------------------------------------------------------------ */
  /* red                                                                 */
  /* ------------------------------------------------------------------ */
  /* PostgREST contesta 200 con el cuerpo vacío cuando le pides return=minimal,
     no 204. Se lee como texto y se parsea solo si trae algo. */
  function cuerpo(res) {
    return res.text().then(function (txt) {
      if (!txt.trim()) return null;
      try { return JSON.parse(txt); } catch (e) { return txt; }
    });
  }

  function api(ruta, opciones) {
    opciones = opciones || {};
    var h = Object.assign({
      apikey: cfg.anon,
      'Content-Type': 'application/json'
    }, opciones.headers || {});
    if (sesion && sesion.access_token) h.Authorization = 'Bearer ' + sesion.access_token;
    return fetch(cfg.url + ruta, Object.assign({}, opciones, { headers: h })).then(function (res) {
      return cuerpo(res).then(function (d) {
        if (res.status === 401 && sesion) return refresca().then(function () { return api(ruta, opciones); });
        if (!res.ok) {
          var m = d && d.message ? d.message : (typeof d === 'string' ? d : res.status);
          throw new Error(m);
        }
        return d;
      });
    });
  }

  var lee = function (tabla, q) { return api('/rest/v1/' + tabla + '?' + (q || 'select=*')); };

  function escribe(tabla, filas, unica) {
    return api('/rest/v1/' + tabla + (unica ? '?on_conflict=' + unica : ''), {
      method: 'POST',
      headers: { Prefer: (unica ? 'resolution=merge-duplicates,' : '') + 'return=representation' },
      body: JSON.stringify(filas)
    });
  }
  var parchea = function (tabla, filtro, datos) {
    return api('/rest/v1/' + tabla + '?' + filtro, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(datos)
    });
  };
  var elimina = function (tabla, filtro) {
    return api('/rest/v1/' + tabla + '?' + filtro, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  };

  /* ------------------------------------------------------------------ */
  /* sesión                                                              */
  /* ------------------------------------------------------------------ */
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
    }).then(function (r) {
      return cuerpo(r).then(function (d) {
        if (!r.ok) throw new Error((d && (d.error_description || d.msg || d.message)) || 'No se ha podido entrar.');
        guardaSesion(d);
        return d;
      });
    });
  }
  function refresca() {
    if (!sesion || !sesion.refresh_token) return Promise.reject(new Error('sin sesión'));
    return fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sesion.refresh_token })
    }).then(function (r) {
      return cuerpo(r).then(function (d) {
        if (!r.ok) { olvidaSesion(); pintaEntrada(); throw new Error('La sesión ha caducado.'); }
        guardaSesion(d);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* carga                                                               */
  /* ------------------------------------------------------------------ */
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
    });
  }

  var cat = function (id) { return estado.categorias.find(function (c) { return c.id === id; }); };
  var deCat = function (id) {
    var c = cat(id); if (!c) return '';
    var m = c.padre_id ? cat(c.padre_id) : null;
    return (m ? t(m.nombre) + ' · ' : '') + t(c.nombre);
  };

  /* ------------------------------------------------------------------ */
  /* pantalla de entrada                                                 */
  /* ------------------------------------------------------------------ */
  function pintaEntrada(msg) {
    var app = $('#app');
    app.textContent = '';
    var correo = el('input', { type: 'email', id: 'correo', autocomplete: 'username', required: 'required' });
    var clave = el('input', { type: 'password', id: 'clave', autocomplete: 'current-password', required: 'required' });
    var boton = el('button', { clase: 'btn btn-p', type: 'submit', texto: 'Entrar' });
    var err = el('p', { clase: 'aviso error', hidden: msg ? null : 'hidden', texto: msg || '' });

    var form = el('form', { clase: 'entrada', onsubmit: function (e) {
      e.preventDefault();
      boton.disabled = true; boton.textContent = 'Entrando…';
      entra(correo.value.trim(), clave.value)
        .then(arranca)
        .catch(function (x) {
          err.textContent = x.message; err.hidden = false;
          boton.disabled = false; boton.textContent = 'Entrar';
        });
    } }, [
      el('h1', { texto: 'La carta' }),
      el('p', { clase: 'entrada-sub', texto: 'Entra para cambiar platos, precios y alérgenos.' }),
      err,
      el('label', { for: 'correo', texto: 'Correo' }), correo,
      el('label', { for: 'clave', texto: 'Contraseña' }), clave,
      boton,
      el('p', { clase: 'entrada-pie' }, [el('a', { href: '/menu/', texto: 'Volver a la carta' })])
    ]);
    app.appendChild(form);
  }

  /* ------------------------------------------------------------------ */
  /* armazón                                                             */
  /* ------------------------------------------------------------------ */
  var PESTANAS = [
    ['platos', 'Platos'],
    ['categorias', 'Categorías'],
    ['escalas', 'Niveles'],
    ['grupos', 'Opciones'],
    ['etiquetas', 'Etiquetas'],
    ['publicar', 'Publicar']
  ];

  function pintaApp() {
    var app = $('#app');
    app.textContent = '';
    var nav = el('nav', { clase: 'pest', 'aria-label': 'Secciones del panel' },
      PESTANAS.map(function (p) {
        return el('button', {
          type: 'button', clase: 'pest-b' + (pestana === p[0] ? ' activa' : ''),
          'aria-current': pestana === p[0] ? 'true' : null, texto: p[1],
          onclick: function () { pestana = p[0]; editando = null; pintaApp(); }
        });
      }));

    app.appendChild(el('header', { clase: 'panel-cab' }, [
      el('div', { clase: 'panel-marca' }, [
        el('strong', { texto: 'Ramen Okaeri' }),
        el('span', { texto: 'panel de la carta' })
      ]),
      el('div', { clase: 'panel-acc' }, [
        el('a', { clase: 'btn-t', href: '/menu/', target: '_blank', rel: 'noopener', texto: 'Ver la carta' }),
        el('button', { type: 'button', clase: 'btn-t', texto: 'Salir', onclick: function () {
          olvidaSesion(); pintaEntrada();
        } })
      ])
    ]));
    app.appendChild(nav);
    var cuerpoEl = el('main', { clase: 'panel-cuerpo', id: 'cuerpo' });
    app.appendChild(cuerpoEl);

    if (editando) return pintaFicha(cuerpoEl);
    if (pestana === 'platos') return pintaPlatos(cuerpoEl);
    if (pestana === 'categorias') return pintaCategorias(cuerpoEl);
    if (pestana === 'escalas') return pintaEscalas(cuerpoEl);
    if (pestana === 'grupos') return pintaGrupos(cuerpoEl);
    if (pestana === 'etiquetas') return pintaEtiquetas(cuerpoEl);
    if (pestana === 'publicar') return pintaPublicar(cuerpoEl);
  }

  /* ------------------------------------------------------------------ */
  /* platos: la lista                                                    */
  /* ------------------------------------------------------------------ */
  function pintaPlatos(c) {
    var filtro = '', filtroCat = '';

    var buscador = el('input', { type: 'search', placeholder: 'Buscar un plato…', 'aria-label': 'Buscar un plato',
      oninput: function () { filtro = this.value.toLowerCase(); pinta(); } });
    var selCat = el('select', { 'aria-label': 'Filtrar por categoría',
      onchange: function () { filtroCat = this.value; pinta(); } }, [el('option', { value: '', texto: 'Todas las categorías' })].concat(
      estado.categorias.map(function (x) { return el('option', { value: x.id, texto: deCat(x.id) }); })));

    var lista = el('div', { clase: 'lista' });

    c.appendChild(el('div', { clase: 'barra' }, [
      buscador, selCat,
      el('button', { clase: 'btn btn-p', type: 'button', texto: 'Plato nuevo', onclick: function () {
        editando = { nuevo: true, nombre: {}, descripcion: {}, nota: {}, disponible: true, destacado: false,
          orden: (Math.max.apply(null, [0].concat(estado.platos.map(function (p) { return p.orden || 0; }))) + 1),
          _precios: [{ etiqueta: null, precio: null }], _alergenos: [], _etiquetas: [], _escalas: [], _grupos: [] };
        pintaApp();
      } })
    ]));
    c.appendChild(lista);

    function pinta() {
      lista.textContent = '';
      var vistos = estado.platos.filter(function (p) {
        if (filtroCat && p.categoria_id !== filtroCat) return false;
        if (!filtro) return true;
        return (t(p.nombre) + ' ' + t(p.descripcion) + ' ' + (p.numero || '')).toLowerCase().indexOf(filtro) !== -1;
      }).sort(function (a, b) {
        var ca = deCat(a.categoria_id), cb = deCat(b.categoria_id);
        return ca.localeCompare(cb) || (a.orden || 0) - (b.orden || 0);
      });

      if (!vistos.length) { lista.appendChild(el('p', { clase: 'vacio', texto: 'No hay ningún plato con eso.' })); return; }

      var catActual = null;
      vistos.forEach(function (p) {
        var nc = deCat(p.categoria_id);
        if (nc !== catActual) { catActual = nc; lista.appendChild(el('h2', { clase: 'lista-cat', texto: nc })); }
        var precios = estado.precios.filter(function (x) { return x.plato_id === p.id; });
        lista.appendChild(el('div', { clase: 'fila' + (p.disponible ? '' : ' apagado') }, [
          el('div', { clase: 'fila-txt' }, [
            el('strong', { texto: (p.numero ? p.numero + '. ' : '') + t(p.nombre) }),
            el('span', { clase: 'fila-sub', texto: precios.map(function (x) {
              return (x.etiqueta ? t(x.etiqueta) + ' ' : '') + eur(x.precio);
            }).join('  ·  ') || 'sin precio' }),
            IDIOMAS.filter(function (l) { return !p.nombre[l]; }).length
              ? el('span', { clase: 'pincho', texto: 'falta ' + IDIOMAS.filter(function (l) { return !p.nombre[l]; }).join(', ') })
              : null
          ]),
          el('div', { clase: 'fila-acc' }, [
            el('button', { type: 'button', clase: 'btn-t', texto: p.disponible ? 'Quitar de la carta' : 'Devolver a la carta',
              onclick: function () {
                parchea('platos', 'id=eq.' + p.id, { disponible: !p.disponible }).then(function () {
                  p.disponible = !p.disponible; pinta();
                  aviso(p.disponible ? 'Vuelve a estar en la carta.' : 'Fuera de la carta.');
                }).catch(function (x) { aviso(x.message, 'error'); });
              } }),
            el('button', { type: 'button', clase: 'btn btn-s', texto: 'Editar', onclick: function () {
              editando = cargaFicha(p); pintaApp();
            } })
          ])
        ]));
      });
    }
    pinta();
  }

  function cargaFicha(p) {
    var f = Object.assign({}, p);
    f.nombre = Object.assign({}, p.nombre); f.descripcion = Object.assign({}, p.descripcion || {});
    f.nota = Object.assign({}, p.nota || {});
    f._precios = estado.precios.filter(function (x) { return x.plato_id === p.id; })
      .map(function (x) { return { etiqueta: x.etiqueta, precio: x.precio }; });
    if (!f._precios.length) f._precios = [{ etiqueta: null, precio: null }];
    f._alergenos = estado.palergenos.filter(function (x) { return x.plato_id === p.id; })
      .map(function (x) { return { id: x.alergeno_id, grado: x.grado }; });
    f._etiquetas = estado.petiquetas.filter(function (x) { return x.plato_id === p.id; })
      .map(function (x) { return x.etiqueta_id; });
    f._escalas = estado.pescalas.filter(function (x) { return x.plato_id === p.id; })
      .map(function (x) { return { id: x.escala_id, valor: x.valor }; });
    f._grupos = estado.pgrupos.filter(function (x) { return x.plato_id === p.id; })
      .map(function (x) { return x.grupo_id; });
    return f;
  }

  /* ------------------------------------------------------------------ */
  /* platos: la ficha                                                    */
  /* ------------------------------------------------------------------ */
  function campoIdioma(titulo, obj, multi) {
    var caja = el('div', { clase: 'campo' }, [el('label', { texto: titulo })]);
    var tabs = el('div', { clase: 'idiomas' });
    var zona = el('div');
    var actual = 'es';
    function pinta() {
      zona.textContent = '';
      var entrada = multi
        ? el('textarea', { rows: '3', oninput: function () { obj[actual] = this.value; } })
        : el('input', { type: 'text', oninput: function () { obj[actual] = this.value; } });
      entrada.value = obj[actual] || '';
      entrada.setAttribute('lang', actual);
      zona.appendChild(entrada);
      $$('.idi-b', tabs).forEach(function (b) {
        b.classList.toggle('activa', b.dataset.l === actual);
        b.classList.toggle('falta', !obj[b.dataset.l]);
      });
    }
    IDIOMAS.forEach(function (l) {
      tabs.appendChild(el('button', { type: 'button', clase: 'idi-b', 'data-l': l, texto: l,
        onclick: function () { actual = l; pinta(); } }));
    });
    caja.appendChild(tabs); caja.appendChild(zona);
    pinta();
    return caja;
  }

  function pintaFicha(c) {
    var f = editando;

    var zonaPrecios = el('div', { clase: 'precios' });
    function pintaPrecios() {
      zonaPrecios.textContent = '';
      f._precios.forEach(function (pr, i) {
        var et = el('input', { type: 'text', placeholder: 'Etiqueta (2 uds, Botella…)', value: pr.etiqueta ? t(pr.etiqueta) : '',
          oninput: function () { pr.etiqueta = this.value.trim() ? { es: this.value, en: this.value, gl: this.value } : null; } });
        var v = el('input', { type: 'number', step: '0.05', min: '0', placeholder: '0,00',
          value: pr.precio == null ? '' : pr.precio,
          oninput: function () { pr.precio = this.value === '' ? null : parseFloat(this.value); } });
        zonaPrecios.appendChild(el('div', { clase: 'precio-fila' }, [
          et, v,
          f._precios.length > 1 ? el('button', { type: 'button', clase: 'btn-t', texto: 'Quitar',
            onclick: function () { f._precios.splice(i, 1); pintaPrecios(); } }) : null
        ]));
      });
      zonaPrecios.appendChild(el('button', { type: 'button', clase: 'btn-t', texto: '+ Otra variante de precio',
        onclick: function () { f._precios.push({ etiqueta: null, precio: null }); pintaPrecios(); } }));
    }
    pintaPrecios();

    /* alérgenos: los 14, con contiene / trazas / nada */
    var zonaAlg = el('div', { clase: 'rejilla' });
    estado.alergenos.forEach(function (a) {
      var actual = f._alergenos.find(function (x) { return x.id === a.id; });
      var sel = el('select', { 'aria-label': t(a.nombre), onchange: function () {
        var i = f._alergenos.findIndex(function (x) { return x.id === a.id; });
        if (i !== -1) f._alergenos.splice(i, 1);
        if (this.value) f._alergenos.push({ id: a.id, grado: this.value });
      } }, [
        el('option', { value: '', texto: 'No lleva' }),
        el('option', { value: 'contiene', texto: 'Contiene' }),
        el('option', { value: 'trazas', texto: 'Trazas' })
      ]);
      sel.value = actual ? actual.grado : '';
      zonaAlg.appendChild(el('div', { clase: 'rej-item' }, [el('span', { texto: t(a.nombre) }), sel]));
    });

    var zonaEtq = el('div', { clase: 'chips' });
    estado.etiquetas.forEach(function (e) {
      var on = f._etiquetas.indexOf(e.id) !== -1;
      var b = el('button', { type: 'button', clase: 'chip-t' + (on ? ' activa' : ''), texto: t(e.nombre),
        onclick: function () {
          var i = f._etiquetas.indexOf(e.id);
          if (i === -1) f._etiquetas.push(e.id); else f._etiquetas.splice(i, 1);
          this.classList.toggle('activa');
        } });
      zonaEtq.appendChild(b);
    });

    /* niveles: añadir o quitar de la ficha, con su valor */
    var zonaEsc = el('div', { clase: 'rejilla' });
    estado.escalas.forEach(function (e) {
      var actual = f._escalas.find(function (x) { return x.id === e.id; });
      var opciones = [el('option', { value: '', texto: 'No aplica' })];
      for (var i = 0; i <= e.maximo; i++) opciones.push(el('option', { value: String(i), texto: i + ' de ' + e.maximo }));
      var sel = el('select', { 'aria-label': t(e.nombre), onchange: function () {
        var j = f._escalas.findIndex(function (x) { return x.id === e.id; });
        if (j !== -1) f._escalas.splice(j, 1);
        if (this.value !== '') f._escalas.push({ id: e.id, valor: parseInt(this.value, 10) });
      } }, opciones);
      sel.value = actual ? String(actual.valor) : '';
      zonaEsc.appendChild(el('div', { clase: 'rej-item' }, [el('span', { texto: t(e.nombre) }), sel]));
    });

    var zonaGru = el('div', { clase: 'chips' });
    estado.grupos.forEach(function (g) {
      var on = f._grupos.indexOf(g.id) !== -1;
      zonaGru.appendChild(el('button', { type: 'button', clase: 'chip-t' + (on ? ' activa' : ''),
        texto: t(g.nombre), onclick: function () {
          var i = f._grupos.indexOf(g.id);
          if (i === -1) f._grupos.push(g.id); else f._grupos.splice(i, 1);
          this.classList.toggle('activa');
        } }));
    });

    var selCat = el('select', { id: 'f-cat', required: 'required' }, estado.categorias.map(function (x) {
      return el('option', { value: x.id, texto: deCat(x.id) });
    }));
    if (f.categoria_id) selCat.value = f.categoria_id;

    var numero = el('input', { type: 'text', id: 'f-num', value: f.numero || '', placeholder: '1, 13P…' });
    var orden = el('input', { type: 'number', id: 'f-ord', value: f.orden || 0 });
    var imagen = el('input', { type: 'text', id: 'f-img', value: f.imagen || '',
      placeholder: '/assets/img/platos/tonkotsu.jpg' });
    var destacado = el('input', { type: 'checkbox', id: 'f-dest' });
    destacado.checked = !!f.destacado;
    var disponible = el('input', { type: 'checkbox', id: 'f-disp' });
    disponible.checked = f.disponible !== false;

    var guardar = el('button', { clase: 'btn btn-p', type: 'submit', texto: f.nuevo ? 'Crear el plato' : 'Guardar' });

    var form = el('form', { clase: 'ficha', onsubmit: function (e) {
      e.preventDefault();
      f.categoria_id = selCat.value;
      f.numero = numero.value.trim() || null;
      f.orden = parseInt(orden.value, 10) || 0;
      f.imagen = imagen.value.trim() || null;
      f.destacado = destacado.checked;
      f.disponible = disponible.checked;
      if (!f.nombre.es) { aviso('El nombre en español es obligatorio.', 'error'); return; }
      guardar.disabled = true; guardar.textContent = 'Guardando…';
      guardaPlato(f).then(function () {
        return cargaTodo();
      }).then(function () {
        editando = null; pintaApp(); aviso('Guardado. Acuérdate de publicar.');
      }).catch(function (x) {
        aviso(x.message, 'error'); guardar.disabled = false; guardar.textContent = 'Guardar';
      });
    } }, [
      el('div', { clase: 'ficha-cab' }, [
        el('button', { type: 'button', clase: 'btn-t', texto: '← Volver a la lista',
          onclick: function () { editando = null; pintaApp(); } }),
        f.nuevo ? null : el('button', { type: 'button', clase: 'btn-t peligro', texto: 'Borrar el plato',
          onclick: function () {
            if (!confirm('¿Borrar «' + t(f.nombre) + '»? No se puede deshacer.')) return;
            elimina('platos', 'id=eq.' + f.id).then(cargaTodo).then(function () {
              editando = null; pintaApp(); aviso('Borrado. Acuérdate de publicar.');
            }).catch(function (x) { aviso(x.message, 'error'); });
          } })
      ]),
      campoIdioma('Nombre del plato', f.nombre, false),
      campoIdioma('Descripción', f.descripcion, true),
      el('div', { clase: 'dos' }, [
        el('div', { clase: 'campo' }, [el('label', { for: 'f-cat', texto: 'Categoría' }), selCat]),
        el('div', { clase: 'campo' }, [el('label', { for: 'f-num', texto: 'Número en la carta' }), numero])
      ]),
      el('div', { clase: 'campo' }, [el('label', { texto: 'Precio' }), zonaPrecios]),
      el('div', { clase: 'campo' }, [
        el('label', { texto: 'Alérgenos' }),
        el('p', { clase: 'pista', texto: 'Los 14 de declaración obligatoria. Lo que marques aquí es lo que ve quien filtra por «sin lactosa».' }),
        zonaAlg
      ]),
      el('div', { clase: 'campo' }, [el('label', { texto: 'Etiquetas' }), zonaEtq]),
      el('div', { clase: 'campo' }, [
        el('label', { texto: 'Niveles' }),
        el('p', { clase: 'pista', texto: 'Se pintan como puntos en la ficha. Deja «No aplica» para que no salga.' }),
        zonaEsc
      ]),
      el('div', { clase: 'campo' }, [
        el('label', { texto: 'Grupos de opciones' }),
        el('p', { clase: 'pista', texto: 'Se comparten entre platos: si cambias «Extras», cambia en todos los que lo lleven.' }),
        zonaGru
      ]),
      campoIdioma('Nota (opcional)', f.nota, false),
      el('div', { clase: 'dos' }, [
        el('div', { clase: 'campo' }, [el('label', { for: 'f-img', texto: 'Imagen (opcional)' }), imagen,
          el('p', { clase: 'pista', texto: 'Sin imagen se pinta el marcador de su categoría.' })]),
        el('div', { clase: 'campo' }, [el('label', { for: 'f-ord', texto: 'Orden' }), orden])
      ]),
      el('div', { clase: 'interruptores' }, [
        el('label', { clase: 'inter' }, [disponible, el('span', { texto: 'En la carta' })]),
        el('label', { clase: 'inter' }, [destacado, el('span', { texto: 'Destacado en la portada' })])
      ]),
      guardar
    ]);
    c.appendChild(form);
  }

  function guardaPlato(f) {
    var base = {
      slug: f.slug || slugifica(f.nombre.es),
      numero: f.numero, categoria_id: f.categoria_id, nombre: f.nombre,
      descripcion: f.descripcion, nota: f.nota, imagen: f.imagen,
      disponible: f.disponible, destacado: f.destacado, orden: f.orden
    };
    var paso = f.nuevo
      ? escribe('platos', [base]).then(function (r) { return r[0].id; })
      : parchea('platos', 'id=eq.' + f.id, base).then(function () { return f.id; });

    return paso.then(function (id) {
      var q = 'plato_id=eq.' + id;
      return Promise.all([
        elimina('plato_precios', q), elimina('plato_alergenos', q),
        elimina('plato_etiquetas', q), elimina('plato_escalas', q), elimina('plato_grupos', q)
      ]).then(function () {
        var tareas = [];
        var precios = f._precios.filter(function (p) { return p.precio != null || p.etiqueta; });
        if (precios.length) tareas.push(escribe('plato_precios', precios.map(function (p, i) {
          return { plato_id: id, etiqueta: p.etiqueta, precio: p.precio, orden: i + 1 };
        })));
        if (f._alergenos.length) tareas.push(escribe('plato_alergenos', f._alergenos.map(function (a) {
          return { plato_id: id, alergeno_id: a.id, grado: a.grado };
        })));
        if (f._etiquetas.length) tareas.push(escribe('plato_etiquetas', f._etiquetas.map(function (e) {
          return { plato_id: id, etiqueta_id: e };
        })));
        if (f._escalas.length) tareas.push(escribe('plato_escalas', f._escalas.map(function (e) {
          return { plato_id: id, escala_id: e.id, valor: e.valor };
        })));
        if (f._grupos.length) tareas.push(escribe('plato_grupos', f._grupos.map(function (g, i) {
          return { plato_id: id, grupo_id: g, orden: i + 1 };
        })));
        return Promise.all(tareas);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* categorías, niveles, opciones, etiquetas                            */
  /* ------------------------------------------------------------------ */
  /* Un editor de lista genérico: las cuatro pestañas son la misma pantalla
     con campos distintos, así que se escribe una vez. */
  function editorLista(c, opciones) {
    var tabla = opciones.tabla, filas = opciones.filas;
    var lista = el('div', { clase: 'lista' });

    c.appendChild(el('div', { clase: 'barra' }, [
      el('h2', { clase: 'barra-tit', texto: opciones.titulo }),
      el('button', { clase: 'btn btn-p', type: 'button', texto: opciones.nuevo, onclick: function () { abre({}); } })
    ]));
    if (opciones.pista) c.appendChild(el('p', { clase: 'pista pista-suelta', texto: opciones.pista }));
    c.appendChild(lista);

    function pinta() {
      lista.textContent = '';
      filas().forEach(function (f) {
        lista.appendChild(el('div', { clase: 'fila' }, [
          el('div', { clase: 'fila-txt' }, [
            el('strong', { texto: t(f.nombre) }),
            el('span', { clase: 'fila-sub', texto: opciones.sub(f) })
          ]),
          el('div', { clase: 'fila-acc' }, [
            el('button', { type: 'button', clase: 'btn btn-s', texto: 'Editar', onclick: function () { abre(f); } })
          ])
        ]));
      });
      if (!filas().length) lista.appendChild(el('p', { clase: 'vacio', texto: 'Todavía no hay ninguno.' }));
    }

    function abre(f) {
      var nuevo = !f.id;
      var datos = Object.assign({ nombre: {} }, f);
      datos.nombre = Object.assign({}, f.nombre || {});
      var extra = opciones.campos(datos);
      var cajaEl = el('div', { clase: 'modal' }, [
        el('div', { clase: 'modal-caja' }, [
          el('h3', { texto: nuevo ? opciones.nuevo : 'Editar' }),
          campoIdioma('Nombre', datos.nombre, false)
        ].concat(extra.nodos).concat([
          el('div', { clase: 'modal-acc' }, [
            el('button', { type: 'button', clase: 'btn-t', texto: 'Cancelar', onclick: cierra }),
            nuevo ? null : el('button', { type: 'button', clase: 'btn-t peligro', texto: 'Borrar', onclick: function () {
              if (!confirm('¿Borrar «' + t(datos.nombre) + '»?')) return;
              elimina(tabla, 'id=eq.' + datos.id).then(cargaTodo).then(function () { cierra(); pinta(); })
                .catch(function (x) { aviso(x.message, 'error'); });
            } }),
            el('button', { type: 'button', clase: 'btn btn-p', texto: 'Guardar', onclick: function () {
              if (!datos.nombre.es) { aviso('El nombre en español es obligatorio.', 'error'); return; }
              var cuerpoFila = Object.assign({ nombre: datos.nombre, slug: datos.slug || slugifica(datos.nombre.es) },
                extra.valores());
              var p = nuevo ? escribe(tabla, [cuerpoFila]) : parchea(tabla, 'id=eq.' + datos.id, cuerpoFila);
              p.then(function (r) {
                var id = datos.id || (r && r[0] && r[0].id);
                return extra.guardaExtra ? extra.guardaExtra(id) : null;
              }).then(cargaTodo).then(function () {
                cierra(); pinta(); aviso('Guardado. Acuérdate de publicar.');
              }).catch(function (x) { aviso(x.message, 'error'); });
            } })
          ])
        ]))
      ]);
      function cierra() { cajaEl.remove(); }
      cajaEl.addEventListener('click', function (e) { if (e.target === cajaEl) cierra(); });
      document.body.appendChild(cajaEl);
    }
    pinta();
  }

  function pintaCategorias(c) {
    var ICONOS = ['ramen', 'arroz', 'tapa', 'bebida', 'postre', 'coctel', 'generico'];
    editorLista(c, {
      tabla: 'categorias',
      titulo: 'Categorías',
      nuevo: 'Categoría nueva',
      pista: 'Una categoría puede colgar de otra: «Ramen» con «Con caldo» y «Sin caldo» dentro. Dos niveles como mucho.',
      filas: function () { return estado.categorias; },
      sub: function (f) {
        var n = estado.platos.filter(function (p) { return p.categoria_id === f.id; }).length;
        return (f.padre_id ? 'dentro de ' + t(cat(f.padre_id).nombre) + ' · ' : '') + n + ' plato(s) · marcador ' + f.icono;
      },
      campos: function (d) {
        var padre = el('select', {}, [el('option', { value: '', texto: 'Ninguna (categoría principal)' })].concat(
          estado.categorias.filter(function (x) { return !x.padre_id && x.id !== d.id; })
            .map(function (x) { return el('option', { value: x.id, texto: t(x.nombre) }); })));
        padre.value = d.padre_id || '';
        var icono = el('select', {}, ICONOS.map(function (i) { return el('option', { value: i, texto: i }); }));
        icono.value = d.icono || 'generico';
        var orden = el('input', { type: 'number', value: d.orden || 0 });
        return {
          nodos: [
            el('div', { clase: 'campo' }, [el('label', { texto: 'Dentro de' }), padre]),
            el('div', { clase: 'dos' }, [
              el('div', { clase: 'campo' }, [el('label', { texto: 'Marcador de sus platos sin foto' }), icono]),
              el('div', { clase: 'campo' }, [el('label', { texto: 'Orden' }), orden])
            ])
          ],
          valores: function () {
            return { padre_id: padre.value || null, icono: icono.value, orden: parseInt(orden.value, 10) || 0 };
          }
        };
      }
    });
  }

  function pintaEscalas(c) {
    editorLista(c, {
      tabla: 'escalas',
      titulo: 'Niveles',
      nuevo: 'Nivel nuevo',
      pista: 'Un nivel es una escala de puntos que se enseña en la ficha del plato: picante 2 de 3. Se crea aquí y se engancha desde cada plato.',
      filas: function () { return estado.escalas; },
      sub: function (f) {
        var n = estado.pescalas.filter(function (x) { return x.escala_id === f.id; }).length;
        return 'de 0 a ' + f.maximo + ' · ' + n + ' plato(s) lo usan';
      },
      campos: function (d) {
        var max = el('input', { type: 'number', min: '1', max: '10', value: d.maximo || 3 });
        var icono = el('select', {}, ['chile', 'punto'].map(function (i) { return el('option', { value: i, texto: i }); }));
        icono.value = d.icono || 'punto';
        var orden = el('input', { type: 'number', value: d.orden || 0 });
        return {
          nodos: [el('div', { clase: 'dos' }, [
            el('div', { clase: 'campo' }, [el('label', { texto: 'Máximo' }), max]),
            el('div', { clase: 'campo' }, [el('label', { texto: 'Icono' }), icono])
          ]), el('div', { clase: 'campo' }, [el('label', { texto: 'Orden' }), orden])],
          valores: function () {
            return { maximo: parseInt(max.value, 10) || 3, icono: icono.value, orden: parseInt(orden.value, 10) || 0 };
          }
        };
      }
    });
  }

  function pintaEtiquetas(c) {
    editorLista(c, {
      tabla: 'etiquetas',
      titulo: 'Etiquetas',
      nuevo: 'Etiqueta nueva',
      pista: 'Vegano, vegetariano, sin gluten… Son con lo que la gente filtra la carta.',
      filas: function () { return estado.etiquetas; },
      sub: function (f) {
        return estado.petiquetas.filter(function (x) { return x.etiqueta_id === f.id; }).length + ' plato(s)';
      },
      campos: function (d) {
        var orden = el('input', { type: 'number', value: d.orden || 0 });
        return {
          nodos: [el('div', { clase: 'campo' }, [el('label', { texto: 'Orden' }), orden])],
          valores: function () { return { icono: d.icono || 'hoja', orden: parseInt(orden.value, 10) || 0 }; }
        };
      }
    });
  }

  function pintaGrupos(c) {
    editorLista(c, {
      tabla: 'grupos_opcion',
      titulo: 'Grupos de opciones',
      nuevo: 'Grupo nuevo',
      pista: 'Extras, sabores, intensidad del caldo… Un grupo se engancha a muchos platos y se edita una sola vez.',
      filas: function () { return estado.grupos; },
      sub: function (f) {
        var ops = estado.opciones.filter(function (o) { return o.grupo_id === f.id; });
        var usos = estado.pgrupos.filter(function (x) { return x.grupo_id === f.id; }).length;
        return ops.length + ' opción(es) · ' + usos + ' plato(s) · ' + (f.tipo === 'multiple' ? 'varias' : 'una sola');
      },
      campos: function (d) {
        var tipo = el('select', {}, [
          el('option', { value: 'unica', texto: 'Se elige una sola' }),
          el('option', { value: 'multiple', texto: 'Se pueden elegir varias' })
        ]);
        tipo.value = d.tipo || 'unica';
        var orden = el('input', { type: 'number', value: d.orden || 0 });

        var ops = d.id ? estado.opciones.filter(function (o) { return o.grupo_id === d.id; })
          .map(function (o) { return { slug: o.slug, nombre: Object.assign({}, o.nombre), incremento: o.incremento }; })
          : [];
        var zona = el('div', { clase: 'opciones' });
        function pintaOps() {
          zona.textContent = '';
          ops.forEach(function (o, i) {
            var n = el('input', { type: 'text', placeholder: 'Nombre', value: t(o.nombre),
              oninput: function () { o.nombre = { es: this.value, en: this.value, gl: this.value }; } });
            var inc = el('input', { type: 'number', step: '0.05', placeholder: '+0,00',
              value: o.incremento == null ? '' : o.incremento,
              oninput: function () { o.incremento = this.value === '' ? null : parseFloat(this.value); } });
            zona.appendChild(el('div', { clase: 'precio-fila' }, [n, inc,
              el('button', { type: 'button', clase: 'btn-t', texto: 'Quitar',
                onclick: function () { ops.splice(i, 1); pintaOps(); } })]));
          });
          zona.appendChild(el('button', { type: 'button', clase: 'btn-t', texto: '+ Otra opción',
            onclick: function () { ops.push({ nombre: {}, incremento: 0 }); pintaOps(); } }));
        }
        pintaOps();

        return {
          nodos: [
            el('div', { clase: 'dos' }, [
              el('div', { clase: 'campo' }, [el('label', { texto: 'Cómo se elige' }), tipo]),
              el('div', { clase: 'campo' }, [el('label', { texto: 'Orden' }), orden])
            ]),
            el('div', { clase: 'campo' }, [
              el('label', { texto: 'Opciones' }),
              el('p', { clase: 'pista', texto: 'Deja el precio vacío si no está confirmado: la carta pondrá «Pregúntanos».' }),
              zona
            ])
          ],
          valores: function () { return { tipo: tipo.value, orden: parseInt(orden.value, 10) || 0 }; },
          /* Las opciones se borran y se reescriben enteras: es lo correcto aqui
             porque el formulario es la verdad, y evita casar filas a mano. */
          guardaExtra: function (id) {
            if (!id) return null;
            return elimina('opciones', 'grupo_id=eq.' + id).then(function () {
              var buenas = ops.filter(function (o) { return o.nombre && o.nombre.es; });
              if (!buenas.length) return null;
              return escribe('opciones', buenas.map(function (o, i) {
                return { grupo_id: id, slug: o.slug || slugifica(o.nombre.es), nombre: o.nombre,
                         incremento: o.incremento, orden: i + 1 };
              }));
            });
          }
        };
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* publicar                                                            */
  /* ------------------------------------------------------------------ */
  function pintaPublicar(c) {
    var estadoEl = el('p', { clase: 'pub-estado', texto: 'Mirando…' });
    var boton = el('button', { clase: 'btn btn-p', type: 'button', texto: 'Publicar la carta', disabled: 'disabled' });
    var detalle = el('p', { clase: 'pista' });

    c.appendChild(el('div', { clase: 'publicar' }, [
      el('h2', { texto: 'Publicar' }),
      el('p', { clase: 'pista', texto: 'Lo que cambias aquí no sale en la web hasta que publicas. Al publicar, la carta se vuelve a generar y se sube sola: tarda un minuto o dos.' }),
      estadoEl, detalle, boton
    ]));

    var ultima = estado.platos.concat(estado.categorias, estado.grupos)
      .map(function (x) { return x.actualizado; }).filter(Boolean).sort().pop();

    fetch('/assets/version.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) {
        var publicado = v && v.publicado;
        if (!publicado) {
          estadoEl.textContent = 'La carta todavía no se ha publicado nunca.';
          estadoEl.classList.add('pendiente');
        } else if (ultima && ultima > publicado) {
          estadoEl.textContent = 'Hay cambios sin publicar.';
          estadoEl.classList.add('pendiente');
          detalle.textContent = 'Último cambio: ' + fecha(ultima) + '  ·  publicado: ' + fecha(publicado);
        } else {
          estadoEl.textContent = 'Todo publicado.';
          detalle.textContent = 'Publicado el ' + fecha(publicado) + '.';
        }
        boton.disabled = false;
      });

    boton.addEventListener('click', function () {
      boton.disabled = true; boton.textContent = 'Publicando…';
      fetch(cfg.publicar, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sesion.access_token, apikey: cfg.anon, 'Content-Type': 'application/json' },
        body: '{}'
      }).then(function (r) {
        return cuerpo(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || 'No se ha podido lanzar la publicación.');
          estadoEl.textContent = 'Publicando. En un minuto o dos estará en la web.';
          estadoEl.classList.remove('pendiente');
          boton.textContent = 'Publicar la carta';
          aviso('Lanzado.');
        });
      }).catch(function (x) {
        aviso(x.message, 'error'); boton.disabled = false; boton.textContent = 'Publicar la carta';
      });
    });
  }

  function fecha(iso) {
    try {
      return new Date(iso).toLocaleString('es-ES',
        { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    } catch (e) { return iso; }
  }

  /* ------------------------------------------------------------------ */
  /* arranque                                                            */
  /* ------------------------------------------------------------------ */
  function arranca() {
    $('#app').innerHTML = '<p class="cargando">Cargando la carta…</p>';
    cargaTodo().then(function () {
      pestana = 'platos'; editando = null; pintaApp();
    }).catch(function (x) {
      if (/permission|denied|JWT|row-level/i.test(x.message)) {
        olvidaSesion();
        pintaEntrada('Esa cuenta existe pero no es administradora. Pídele a Yixuan que le suba el rol.');
      } else {
        pintaEntrada('No se ha podido cargar la carta: ' + x.message);
      }
    });
  }

  fetch('/content/supabase.json').then(function (r) { return r.json(); }).then(function (c) {
    cfg = c;
    if (!cfg.anon || cfg.anon === 'PENDIENTE') {
      $('#app').innerHTML = '<div class="entrada"><h1>Falta la clave</h1>' +
        '<p class="entrada-sub">Pega la clave publicable de Supabase en <code>content/supabase.json</code> ' +
        'y vuelve a construir. Está en Project Settings → API.</p></div>';
      return;
    }
    try { sesion = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null'); } catch (e) { sesion = null; }
    if (sesion && sesion.refresh_token) refresca().then(arranca).catch(function () { pintaEntrada(); });
    else pintaEntrada();
  }).catch(function () {
    $('#app').innerHTML = '<div class="entrada"><h1>Sin configuración</h1>' +
      '<p class="entrada-sub">No se encuentra <code>/content/supabase.json</code>.</p></div>';
  });
})();
