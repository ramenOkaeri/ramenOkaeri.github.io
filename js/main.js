/* Ramen Okaeri — comportamiento de la web.
   Sin dependencias. Todo degrada: sin JS la página sigue leyéndose entera. */
(function () {
  'use strict';

  var quieto = window.matchMedia('(prefers-reduced-motion: reduce)');
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ */
  /* Cabecera: se opaca en cuanto se sale de arriba del todo             */
  /* ------------------------------------------------------------------ */
  var cab = $('.cab');
  var barra = $('.barra');
  var hero = $('.hero');

  if (cab) {
    var centinela = document.createElement('div');
    centinela.setAttribute('aria-hidden', 'true');
    centinela.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:12px;pointer-events:none';
    document.body.prepend(centinela);
    new IntersectionObserver(function (e) {
      cab.classList.toggle('pegada', !e[0].isIntersecting);
    }).observe(centinela);
  }

  /* La barra de acciones aparece cuando el hero deja de verse.
     En las páginas sin hero se muestra desde el principio. */
  if (barra) {
    if (hero) {
      new IntersectionObserver(function (e) {
        barra.classList.toggle('visible', !e[0].isIntersecting);
      }, { rootMargin: '-40% 0px 0px 0px' }).observe(hero);
    } else {
      barra.classList.add('visible');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Menú de móvil                                                       */
  /* ------------------------------------------------------------------ */
  var hamb  = $('.hamb');
  var panel = $('.panel');

  if (hamb && panel) {
    var scrollY = 0;
    var abierto = false;
    /* tambien el enlace de salto: con el panel abierto no debe poder
       llevarte detras de el */
    var fondo = $$('body > *:not(.panel)');

    var cerrar = function (devolverFoco) {
      if (!abierto) return;
      abierto = false;
      panel.classList.remove('abierto');
      hamb.setAttribute('aria-expanded', 'false');
      hamb.setAttribute('aria-label', hamb.dataset.abrir);
      fondo.forEach(function (n) { n.removeAttribute('inert'); });
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
      if (devolverFoco) hamb.focus();
    };

    var abrir = function () {
      abierto = true;
      scrollY = window.scrollY;
      panel.classList.add('abierto');
      hamb.setAttribute('aria-expanded', 'true');
      hamb.setAttribute('aria-label', hamb.dataset.cerrar);
      /* iOS ignora overflow:hidden en body; fijarlo es lo único fiable */
      document.body.style.position = 'fixed';
      document.body.style.top = -scrollY + 'px';
      document.body.style.width = '100%';
      fondo.forEach(function (n) { if (n !== panel) n.setAttribute('inert', ''); });
      /* El panel sale de visibility:hidden con una transición, y mientras
         dura sus enlaces no son enfocables: el navegador acepta el focus()
         y acto seguido lo devuelve al body. Por eso se espera al final de
         la transición, con un respaldo por si el evento no llega. */
      var puesto = false;
      var enfoca = function () {
        if (puesto || !abierto) return;
        puesto = true;
        panel.removeEventListener('transitionend', enfoca);
        /* al botón de cerrar, que es lo que espera quien abre un diálogo */
        var primero = $('[data-cerrar]', panel) || $('a', panel);
        if (primero) primero.focus({ preventScroll: true });
      };
      panel.addEventListener('transitionend', enfoca);
      setTimeout(enfoca, 360);
    };

    hamb.addEventListener('click', function () { abierto ? cerrar(true) : abrir(); });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-cerrar]')) return cerrar(true);
      if (e.target.closest('a')) cerrar(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && abierto) cerrar(true);
    });
    /* el panel es de móvil: si la ventana crece, se cierra solo */
    window.matchMedia('(min-width: 900px)').addEventListener('change', function (e) {
      if (e.matches) cerrar(false);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Revelado al entrar en pantalla                                      */
  /* ------------------------------------------------------------------ */
  var revelables = $$('.rv');
  if (revelables.length) {
    if (!('IntersectionObserver' in window)) {
      revelables.forEach(function (n) { n.classList.add('visto'); });
    } else {
      var obs = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          if (!e.isIntersecting) return;
          var d = quieto.matches ? 0 : (parseInt(e.target.dataset.rv, 10) || 0);
          setTimeout(function () { e.target.classList.add('visto'); }, d);
          obs.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 });
      revelables.forEach(function (n) { obs.observe(n); });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Galería: flechas de escritorio sobre el scroll nativo               */
  /* El gesto táctil lo lleva el navegador, que ya trae inercia y goma.  */
  /* ------------------------------------------------------------------ */
  $$('[data-carrusel]').forEach(function (caja) {
    var tira = $('.tira', caja);
    if (!tira) return;
    var ant = $('.tira-ant', caja);
    var sig = $('.tira-sig', caja);

    var paso = function () {
      var f = tira.querySelector('figure');
      if (!f) return tira.clientWidth * 0.8;
      return f.getBoundingClientRect().width + 14;
    };
    var estado = function () {
      var max = tira.scrollWidth - tira.clientWidth - 2;
      if (ant) ant.disabled = tira.scrollLeft <= 2;
      if (sig) sig.disabled = tira.scrollLeft >= max;
    };
    var mover = function (signo) {
      tira.scrollBy({
        left: signo * paso(),
        behavior: quieto.matches ? 'auto' : 'smooth'
      });
    };
    if (ant) ant.addEventListener('click', function () { mover(-1); });
    if (sig) sig.addEventListener('click', function () { mover(1); });
    tira.addEventListener('scroll', estado, { passive: true });
    window.addEventListener('resize', estado);
    estado();
  });

  /* ------------------------------------------------------------------ */
  /* La carta a pantalla completa                                        */
  /* Donde existe la API se usa (Android y escritorio). Safari de iPhone  */
  /* no la trae para nada que no sea un vídeo, así que allí se esconde la */
  /* barra de arriba y el visor se queda con las 100svh enteras.          */
  /* ------------------------------------------------------------------ */
  var bPleno = $('.visor-pleno');
  if (bPleno) {
    var bSalir = $('.visor-salir');
    var raiz = document.documentElement;
    var pedir = raiz.requestFullscreen || raiz.webkitRequestFullscreen;
    var soltar = document.exitFullscreen || document.webkitExitFullscreen;
    var enPantalla = function () {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    };

    var pinta = function (activo) {
      document.body.classList.toggle('pleno', activo);
      bPleno.setAttribute('aria-label', activo ? bPleno.dataset.salir : bPleno.dataset.pleno);
    };

    var entra = function () {
      pinta(true);
      if (pedir) {
        var pr = pedir.call(raiz);
        if (pr && pr.catch) pr.catch(function () {});
      }
    };
    var sale = function () {
      pinta(false);
      if (soltar && enPantalla()) soltar.call(document);
    };

    bPleno.hidden = false;              /* sin JS no se enseña un botón muerto */
    bPleno.addEventListener('click', entra);
    if (bSalir) bSalir.addEventListener('click', sale);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('pleno')) sale();
    });
    /* si se sale desde el propio navegador, la clase se sincroniza */
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        if (pedir && !enPantalla()) pinta(false);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Abierto o cerrado ahora mismo                                       */
  /* Siempre en hora de Madrid: un turista puede llegar con otra zona.   */
  /* ------------------------------------------------------------------ */
  var caja = $('.estado');
  if (caja && window.OKAERI && window.OKAERI.horarios) {
    var dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

    var ahoraEnMadrid = function () {
      var f = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid', weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date());
      var v = {};
      f.forEach(function (p) { v[p.type] = p.value; });
      var idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v.weekday);
      var h = parseInt(v.hour, 10) % 24;
      return { dia: idx, min: h * 60 + parseInt(v.minute, 10) };
    };

    var aMin = function (t) {
      var p = t.split(':');
      return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    };
    var aTexto = function (m) {
      var h = Math.floor(m / 60), n = m % 60;
      return h + ':' + (n < 10 ? '0' : '') + n;
    };

    var pinta = function () {
      var n = ahoraEnMadrid();
      var franjas = window.OKAERI.horarios[dias[n.dia]] || [];
      var abierta = null, siguiente = null;

      franjas.forEach(function (f) {
        var a = aMin(f[0]), b = aMin(f[1]);
        if (n.min >= a && n.min < b) abierta = b;
        else if (n.min < a && siguiente === null) siguiente = a;
      });

      if (siguiente === null) {
        for (var i = 1; i <= 7 && siguiente === null; i++) {
          var d = window.OKAERI.horarios[dias[(n.dia + i) % 7]] || [];
          if (d.length) siguiente = aMin(d[0][0]);
        }
      }

      var txt = caja.querySelector('b');
      var t = window.OKAERI.textos;
      if (abierta !== null) {
        caja.dataset.abierto = 'si';
        txt.textContent = t.abierto;
        caja.querySelector('.detalle').textContent =
          '· ' + t.cierra.replace('{hora}', aTexto(abierta));
      } else {
        caja.dataset.abierto = 'no';
        txt.textContent = t.cerrado;
        caja.querySelector('.detalle').textContent = siguiente === null ? '' :
          '· ' + t.abre.replace('{hora}', aTexto(siguiente));
      }

      /* marca la fila del día en la tabla */
      $$('.horario li').forEach(function (li) {
        if (li.dataset.dia === dias[n.dia]) li.setAttribute('data-hoy', '');
        else li.removeAttribute('data-hoy');
      });
    };

    pinta();
    setInterval(pinta, 60000);
    caja.hidden = false;
  }

  /* ------------------------------------------------------------------ */
  /* Buscador y filtros de la carta                                      */
  /* ------------------------------------------------------------------ */
  /* Todo lo que filtra viaja en atributos del propio <li>, calculados al
     construir: no hay ningún JSON duplicado en la página y filtrar es
     comparar cadenas. Con 73 platos es instantáneo y cero peticiones.

     EL ESTADO VA EN EL HASH DE LA URL Y NO EN localStorage. Así una carta
     filtrada se comparte por WhatsApp y el botón atrás funciona, y de paso
     la web sigue sin estrenar almacenamiento en el navegador, que es una
     propiedad medida del sitio y no se toca por un filtro. */
  var forma = $('#filtros');
  if (forma) {
    var platos = $$('.cplato');
    var secciones = $$('.carta-sec');
    var cajaQ = $('#q');
    var cuenta = $('#cuenta');
    var anuncio = $('#anuncio');
    var vacio = $('#vacio');
    var limpiar = $('#limpiar');
    var abre = $('#abre-filtros');
    var marca = $('#filtro-cuenta');
    /* El numero ya viaja dentro del aria-label del boton, asi que como texto
       sobra. Se marca desde aqui y no en el HTML porque el validador avisa de que
       aria-hidden es redundante mientras el elemento nace con hidden. */
    if (marca) marca.setAttribute('aria-hidden', 'true');
    var plantilla = cuenta ? cuenta.getAttribute('data-plantilla') || '' : '';
    var plantillaUno = cuenta ? cuenta.getAttribute('data-uno') || '' : '';
    var nombreBoton = abre ? abre.getAttribute('data-nombre') || '' : '';
    var puestosVarios = abre ? abre.getAttribute('data-puestos') || '' : '';
    var puestosUno = abre ? abre.getAttribute('data-puesto') || '' : '';

    var pliega = function (s) {
      return String(s).normalize
        ? String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        : String(s).toLowerCase();
    };

    var marcadas = function (nombre) {
      return $$('input[name="' + nombre + '"]:checked', forma).map(function (i) { return i.value; });
    };

    /* El picante ya no es un <select> con emojis, son radios. La primera vale
       '' y quiere decir "da igual", que es el estado de partida. */
    var picElegido = function () {
      var r = forma.querySelector('input[name="pic"]:checked');
      return r && r.value !== '' ? parseInt(r.value, 10) : null;
    };

    /* La region viva espera a que se pare de escribir. Sin esta espera, un
       lector de pantalla cantaria un recuento por cada tecla del buscador. */
    var reloj = null;
    function anuncia(texto) {
      if (!anuncio) return;
      if (reloj) clearTimeout(reloj);
      reloj = setTimeout(function () { anuncio.textContent = texto; }, 350);
    }

    function aplica() {
      var q = pliega(cajaQ ? cajaQ.value.trim() : '');
      /* Se exigen TODAS las palabras y no la cadena entera. Antes era un
         indexOf desnudo, asi que "gyozas pollo" no encontraba nada: en el
         plato pone "Gyozas de pollo" y la subcadena literal no esta. */
      var palabras = q ? q.split(/\s+/) : [];
      var cats = marcadas('cat');
      var dietas = marcadas('dieta');
      var sin = marcadas('sin');
      var pic = picElegido();
      var vistos = 0;

      platos.forEach(function (li) {
        var etq = (li.getAttribute('data-etq') || '').split(' ');
        var alg = (li.getAttribute('data-alg') || '').split(' ');
        var ok = true;

        if (palabras.length) {
          var texto = li.getAttribute('data-buscar') || '';
          ok = palabras.every(function (w) { return texto.indexOf(w) !== -1; });
        }

        /* Las categorias van al reves que las dietas: marcar Ramen y Bebidas deja
           los dos grupos, porque un plato solo esta en una categoria y exigirlas
           todas devolveria siempre cero. Basta la madre: la hija cae dentro. */
        if (ok && cats.length) {
          ok = cats.indexOf(li.getAttribute('data-madre') || '') !== -1;
        }
        /* Las dietas suman: pedir vegano Y vegetariano deja solo lo que es las dos. */
        if (ok) {
          ok = dietas.every(function (d) { return etq.indexOf(d) !== -1; });
        }
        /* "Sin lactosa" quita lo que la lleva. Es una exclusión, no una búsqueda. */
        if (ok) {
          ok = !sin.some(function (a) { return alg.indexOf(a) !== -1; });
        }
        /* Nivel EXACTO y no "como mucho": pedir dos chiles devuelve los que pican
           dos, no tambien los que no pican. */
        if (ok && pic !== null) {
          ok = parseInt(li.getAttribute('data-e-picante') || '0', 10) === pic;
        }

        li.hidden = !ok;
        if (ok) vistos++;
      });

      /* Una sección sin ningún plato visible sobra: su título mentiría. */
      secciones.forEach(function (sec) {
        sec.hidden = !$$('.cplato', sec).some(function (li) { return !li.hidden; });
      });

      var resumen = vistos === 1
        ? plantillaUno
        : plantilla.replace('{n}', String(vistos));
      if (cuenta) cuenta.textContent = resumen;
      if (vacio) vacio.hidden = vistos !== 0;
      anuncia(vistos === 0 && vacio ? vacio.textContent : resumen);

      var activos = q || cats.length || dietas.length || sin.length || pic !== null;
      if (limpiar) limpiar.hidden = !activos;

      /* Con el cajon plegado no se ve que hay filtros puestos, y la carta
         recortada parecería rota. Antes lo decía un punto de siete píxeles sin
         texto: se veía y no decía nada a quien no ve. Ahora es un número, y el
         nombre accesible del botón lo lleva dentro. */
      var puestos = cats.length + dietas.length + sin.length + (pic !== null ? 1 : 0);
      if (marca) {
        marca.textContent = String(puestos);
        marca.hidden = puestos === 0;
      }
      if (abre && nombreBoton) {
        abre.setAttribute('aria-label', puestos === 0 ? nombreBoton
          : nombreBoton + ', ' + (puestos === 1 ? puestosUno : puestosVarios.replace('{n}', String(puestos))));
      }
      guarda(q, cats, dietas, sin, pic);
    }

    /* --- el estado, en la URL ---------------------------------------- */
    function guarda(q, cats, dietas, sin, pic) {
      var p = new URLSearchParams();
      if (q) p.set('q', cajaQ.value.trim());
      if (cats.length) p.set('cat', cats.join(','));
      if (dietas.length) p.set('dieta', dietas.join(','));
      if (sin.length) p.set('sin', sin.join(','));
      if (pic !== null) p.set('pic', String(pic));
      var s = p.toString();
      var destino = location.pathname + (s ? '#' + s : '');
      if (destino !== location.pathname + location.hash) {
        history.replaceState(null, '', destino);
      }
    }

    function lee() {
      var h = location.hash.replace(/^#/, '');
      /* Un ancla de sección (#sec-ramen) no es estado de filtro: se deja pasar
         para que el enlace siga saltando donde tiene que saltar. */
      if (!h || h.indexOf('=') === -1) return;
      var p = new URLSearchParams(h);
      if (cajaQ && p.get('q')) cajaQ.value = p.get('q');
      ['cat', 'dieta', 'sin'].forEach(function (n) {
        var v = (p.get(n) || '').split(',');
        $$('input[name="' + n + '"]', forma).forEach(function (i) {
          i.checked = v.indexOf(i.value) !== -1;
        });
      });
      var pic = p.get('pic');
      /* Solo dígitos: ese valor viene del hash, o sea de fuera, y se usa para
         componer un selector. */
      if (pic !== null && /^\d+$/.test(pic)) {
        var r = forma.querySelector('input[name="pic"][value="' + pic + '"]');
        if (r) r.checked = true;
      }
    }

    if (abre) {
      abre.addEventListener('click', function () {
        var abierto = forma.classList.toggle('abierto');
        abre.setAttribute('aria-expanded', abierto ? 'true' : 'false');
        mideBarra();
      });
    }

    forma.addEventListener('input', aplica);
    forma.addEventListener('change', aplica);
    /* La barra vive dentro de un <form> para que el teclado del móvil enseñe
       "buscar", pero no hay servidor al que enviar nada. */
    forma.addEventListener('submit', function (e) {
      e.preventDefault();
      if (cajaQ) cajaQ.blur();
    });
    if (limpiar) {
      limpiar.addEventListener('click', function () {
        forma.reset();
        if (cajaQ) cajaQ.value = '';
        aplica();
        if (cajaQ) cajaQ.focus();
      });
    }

    /* La barra es pegajosa y tapa el sitio al que salta un ancla de seccion.
       Su alto no se puede escribir en el CSS —cambia con el ancho y con los
       chips que quepan—, asi que se mide aqui y se publica. */
    function mideBarra() {
      var alto = Math.round(forma.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--alto-filtros', alto + 'px');
    }
    var relojBarra = null;
    window.addEventListener('resize', function () {
      if (relojBarra) clearTimeout(relojBarra);
      relojBarra = setTimeout(mideBarra, 150);
    });

    lee();
    forma.hidden = false;
    aplica();
    mideBarra();
    /* Si la URL ya trae filtros —un enlace compartido—, el cajon nace abierto:
       si no, se llega a una carta recortada sin saber por que. */
    if (marca && !marca.hidden && abre) {
      forma.classList.add('abierto');
      abre.setAttribute('aria-expanded', 'true');
    }
  }
})();
