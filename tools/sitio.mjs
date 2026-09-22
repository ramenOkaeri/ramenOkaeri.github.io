/* =============================================================================
   Exporta el horario y el aviso de la web de Supabase a content/sitio.json.
   Se ejecuta con:  node tools/sitio.mjs            escribe
                    node tools/sitio.mjs --verificar   solo comprueba, no escribe

   Es hermano de tools/carta.mjs y va aparte A PROPÓSITO: carta.mjs termina con
   process.exit(0) en cuanto la carta no ha cambiado, así que un cambio que solo
   tocara el horario no llegaría nunca a exportarse si viviera detrás.

   Lo que escribe lo lee tools/build.mjs: la tabla de horarios de la portada, el
   JSON-LD, el «Abierto ahora» y la franja del aviso. Como la carta, se hornea
   al construir y la web pública no le pide nada a Supabase.
   ============================================================================= */

import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, rpc } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'content', 'sitio.json');
const SOLO_VERIFICA = process.argv.includes('--verificar');

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const CIERRE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));

const NOTA =
  'GENERADO por tools/sitio.mjs desde Supabase. No se edita a mano: se cambia ' +
  'desde el panel (Ajustes > Horario y Ajustes > Aviso en la web) y se publica.';

exigeEntorno();
const s = await rpc('sitio_json');

/* Mismo criterio que la carta: una respuesta rara no pisa lo publicado. */
const fallos = [];
const h = (s && s.horario) || {};
for (const d of DIAS) {
  const f = h[d];
  if (!Array.isArray(f)) { fallos.push(`Falta el ${d}.`); continue; }
  let prev = -1;
  for (const x of f) {
    if (!Array.isArray(x) || !HORA.test(x[0] || '') || !CIERRE.test(x[1] || '')) {
      fallos.push(`El ${d} tiene una hora mal escrita: ${JSON.stringify(x)}.`);
      continue;
    }
    if (min(x[1]) <= min(x[0])) fallos.push(`El ${d} cierra antes de abrir: ${x.join('–')}.`);
    if (min(x[0]) < prev) fallos.push(`El ${d} tiene turnos que se solapan.`);
    prev = min(x[1]);
  }
}
const a = (s && s.aviso) || {};
if (a.activo && !(a.texto && String(a.texto.es || '').trim())) {
  fallos.push('El aviso está encendido y no tiene texto en español.');
}
if (fallos.length) {
  console.error('::error::El horario no ha pasado las comprobaciones. No se escribe nada.');
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}

/* Los días en el orden de la semana, no en el que devuelve jsonb (que ordena
   las claves por longitud): así el archivo se lee de un vistazo en git. */
const salida = {
  _nota: NOTA,
  horario: Object.fromEntries(DIAS.map((d) => [d, h[d]])),
  aviso: {
    activo: !!a.activo,
    texto: Object.fromEntries(['es', 'en', 'gl']
      .filter((l) => a.texto && String(a.texto[l] || '').trim())
      .map((l) => [l, a.texto[l].trim()])),
    hasta: a.hasta || null,
  },
};

const resumen = DIAS.map((d) => `${d.slice(0, 3)} ${salida.horario[d].map((x) => x.join('–')).join(' · ') || 'cerrado'}`);
console.log(resumen.join('\n'));
console.log(`aviso: ${salida.aviso.activo ? 'encendido' + (salida.aviso.hasta ? ' hasta ' + salida.aviso.hasta : '') : 'apagado'}`);

if (SOLO_VERIFICA) {
  console.log('--verificar: no se ha escrito nada.');
  process.exit(0);
}

const texto = JSON.stringify(salida, null, 2) + '\n';
let previo = null;
try { previo = readFileSync(DESTINO, 'utf8'); } catch { /* la primera vez no existe */ }
if (previo !== null && JSON.stringify(JSON.parse(previo)) === JSON.stringify(salida)) {
  console.log('El horario y el aviso son los publicados. No se toca el archivo.');
  process.exit(0);
}
writeFileSync(DESTINO, texto, 'utf8');
console.log('content/sitio.json escrito.');
