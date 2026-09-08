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
    var fondo = $$('body > *:not(.panel):not(.saltar)');

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
        var primero = $('a', panel);
        if (primero) primero.focus({ preventScroll: true });
      };
      panel.addEventListener('transitionend', enfoca);
      setTimeout(enfoca, 360);
    };

    hamb.addEventListener('click', function () { abierto ? cerrar(true) : abrir(); });
    panel.addEventListener('click', function (e) { if (e.target.closest('a')) cerrar(false); });
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
  var tira = $('.tira');
  if (tira) {
    var ant = $('.tira-ant');
    var sig = $('.tira-sig');

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
})();
