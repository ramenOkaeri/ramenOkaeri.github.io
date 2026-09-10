/* =============================================================================
   Exporta la carta de Supabase a content/carta.json.
   Se ejecuta con:  node tools/carta.mjs          escribe
                    node tools/carta.mjs --verificar   solo cuenta, no escribe

   POR QUÉ AQUÍ Y NO EN EL NAVEGADOR
     Es la misma razón que en tools/resenas.py y no se repite por gusto:
     pidiéndola al construir, la clave nunca llega al visitante, la web sigue sin
     pedir nada a terceros —y por tanto sin banner de cookies— y Google indexa
     cada plato, porque acaba siendo texto de verdad en el HTML.

     Y de propina: content/carta.json se compromete al repositorio en cada
     publicación, así que la carta entera queda versionada en git. Si el proyecto
     de Supabase desapareciera, el dato sigue aquí con su historial. Es la
     lección que costó el esquema de Noctarea.
   ============================================================================= */

import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, rpc } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'content', 'carta.json');
const SOLO_VERIFICA = process.argv.includes('--verificar');
const DESDE_SEMILLA = process.argv.includes('--desde-semilla');

const NOTA =
  'GENERADO por tools/carta.mjs desde Supabase. No se edita a mano: se vuelve a ' +
  'ejecutar. La fuente de verdad es la base de datos; este archivo es su foto ' +
  'publicada y, de paso, el respaldo versionado de la carta.';

/* --desde-semilla arma el mismo documento que carta_json() pero leyendo los JSON
   del repositorio, sin tocar Supabase. Sirve para dos cosas:
     · desarrollar y verificar la carta en local sin credenciales
     · reconstruirla entera si el proyecto de Supabase desapareciera
   Si esto y la función de SQL dejaran de dar lo mismo, lo canta la verificación. */
function desdeSemilla() {
  const lee = (n) => JSON.parse(readFileSync(join(RAIZ, 'tools', 'semilla', n), 'utf8'));
  const s = lee('carta-inicial.json');
  const v = lee('vocabularios.json');

  const porSlug = Object.fromEntries(s.categorias.map((c) => [c.slug, c]));
  const maxEscala = Object.fromEntries(v.escalas.map((e) => [e.slug, e.maximo]));
  const ordenAlergeno = Object.fromEntries(v.alergenos.map((a) => [a.slug, a.orden]));

  const madres = s.categorias.filter((c) => !c.padre).sort((a, b) => a.orden - b.orden);
  const ordenMadre = Object.fromEntries(madres.map((c, i) => [c.slug, i]));

  const platos = s.platos
    .map((p) => {
      const cat = porSlug[p.categoria];
      const madre = cat.padre ? porSlug[cat.padre] : cat;
      return {
        slug: p.slug,
        numero: p.numero || null,
        categoria: cat.slug,
        categoria_madre: madre.slug,
        icono: cat.icono !== 'generico' ? cat.icono : madre.icono,
        nombre: p.nombre,
        descripcion: p.descripcion || {},
        imagen: p.imagen || null,
        nota: p.nota || {},
        destacado: !!p.destacado,
        precios: (p.precios || []).map((x) => ({
          etiqueta: x.etiqueta || null,
          precio: x.precio === undefined ? null : x.precio,
        })),
        alergenos: (p.alergenos || [])
          .slice()
          .sort((a, b) => ordenAlergeno[a] - ordenAlergeno[b])
          .map((a) => ({ slug: a, grado: 'contiene' })),
        etiquetas: p.etiquetas || [],
        escalas: (p.escalas || []).map((e) => ({
          slug: e.slug,
          valor: e.valor,
          maximo: maxEscala[e.slug],
        })),
        // Solo los slugs: la definición de cada grupo va una vez en la raíz.
        grupos: p.grupos || [],
        _orden: [ordenMadre[madre.slug], cat.orden || 0, p.orden || 0],
      };
    })
    .sort((a, b) => a._orden[0] - b._orden[0] || a._orden[1] - b._orden[1] || a._orden[2] - b._orden[2])
    .map(({ _orden, ...p }) => p);

  return {
    generado: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    actualizado: null,
    origen: 'semilla',
    alergenos: v.alergenos.map((a) => ({ slug: a.slug, nombre: a.nombre })),
    etiquetas: v.etiquetas.map((e) => ({ slug: e.slug, nombre: e.nombre, icono: e.icono })),
    escalas: v.escalas.map((e) => ({
      slug: e.slug,
      nombre: e.nombre,
      maximo: e.maximo,
      icono: e.icono,
    })),
    grupos: s.grupos.map((g) => ({
      slug: g.slug,
      nombre: g.nombre,
      tipo: g.tipo || 'unica',
      obligatorio: !!g.obligatorio,
      opciones: g.opciones.map((o) => ({
        slug: o.slug,
        nombre: o.nombre,
        incremento: o.incremento === undefined ? null : o.incremento,
      })),
    })),
    categorias: madres.map((m) => ({
      slug: m.slug,
      nombre: m.nombre,
      descripcion: m.descripcion || {},
      icono: m.icono,
      hijas: s.categorias
        .filter((c) => c.padre === m.slug)
        .sort((a, b) => a.orden - b.orden)
        .map((c) => ({
          slug: c.slug,
          nombre: c.nombre,
          descripcion: c.descripcion || {},
          icono: c.icono,
        })),
    })),
    platos,
  };
}

let carta;
if (DESDE_SEMILLA) {
  console.log('--desde-semilla: se arma desde el repositorio, sin tocar Supabase.');
  carta = desdeSemilla();
} else {
  exigeEntorno();
  carta = await rpc('carta_json');
}

/* Comprobaciones antes de escribir nada. Una respuesta rara dejaría la web con
   la carta vacía, que es peor que dejarla como estaba. */
const fallos = [];
if (!carta || typeof carta !== 'object') fallos.push('La respuesta no es un objeto.');
const platos = carta?.platos || [];
const categorias = carta?.categorias || [];
if (!platos.length) fallos.push('No ha venido ningún plato.');
if (!categorias.length) fallos.push('No ha venido ninguna categoría.');
if (!(carta?.alergenos || []).length) fallos.push('No ha venido la lista de alérgenos.');

for (const p of platos) {
  if (!p.nombre?.es) fallos.push(`El plato "${p.slug}" no tiene nombre en español.`);
  if (!p.precios?.length) fallos.push(`El plato "${p.slug}" no tiene ningún precio.`);
}

if (fallos.length) {
  console.error('::error::La carta no ha pasado las comprobaciones. No se escribe nada.');
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}

/* Cuántos platos por idioma tienen nombre, para ver de un vistazo si falta
   traducción. El gallego lo escribí yo y lo tiene que repasar alguien de allí. */
const cuenta = (l) => platos.filter((p) => p.nombre?.[l]).length;
const sinPrecio = platos.filter((p) => p.precios.some((x) => x.precio === null)).length;

console.log(`platos: ${platos.length}  ·  categorías: ${categorias.length}`);
console.log(`nombres  es ${cuenta('es')}  ·  en ${cuenta('en')}  ·  gl ${cuenta('gl')}`);
if (sinPrecio) console.log(`${sinPrecio} plato(s) con algún precio sin confirmar`);

if (SOLO_VERIFICA) {
  console.log('--verificar: no se ha escrito nada.');
  process.exit(0);
}

const salida = { _nota: NOTA, ...carta };
const texto = JSON.stringify(salida, null, 2) + '\n';

/* Si no ha cambiado nada, no se toca el archivo: así el flujo de publicación no
   hace un commit vacío y `git status` sigue diciendo la verdad. El campo
   `generado` cambia en cada llamada, así que se compara sin él. */
let previo = null;
try {
  previo = JSON.parse(readFileSync(DESTINO, 'utf8'));
} catch {
  /* la primera vez no existe */
}
const sinSello = (o) => {
  if (!o) return null;
  const { generado, _nota, ...resto } = o;
  return JSON.stringify(resto);
};
if (previo && sinSello(previo) === sinSello(salida)) {
  console.log('La carta es la misma que la publicada. No se toca el archivo.');
  process.exit(0);
}

writeFileSync(DESTINO, texto, 'utf8');
console.log(`content/carta.json  ${(Buffer.byteLength(texto) / 1024).toFixed(1)} KB`);
