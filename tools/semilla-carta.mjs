/* =============================================================================
   Vuelca tools/semilla/carta-inicial.json en Supabase.
   Se ejecuta con:  node tools/semilla-carta.mjs
                    node tools/semilla-carta.mjs --seco   enseña qué haría

   Es re-ejecutable: todo va por upsert contra el slug, así que volver a pasarlo
   actualiza en vez de duplicar. Las relaciones de cada plato (precios, alérgenos,
   etiquetas, escalas y grupos) se borran y se reescriben, que es lo correcto
   para una semilla: el archivo manda.

   OJO: esto NO es el camino normal de edición. Lo normal es el panel de /admin/.
   Esto se usa para la carga inicial y para restaurar la carta desde el
   repositorio si el proyecto de Supabase se perdiera.
   ============================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, guarda, inserta, borra } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECO = process.argv.includes('--seco');
const lee = (n) => JSON.parse(readFileSync(join(RAIZ, 'tools', 'semilla', n), 'utf8'));
const d = lee('carta-inicial.json');
const v = lee('vocabularios.json');

console.log(
  `semilla: ${d.categorias.length} categorías · ${d.grupos.length} grupos · ${d.platos.length} platos`
);

if (SECO) {
  const porCat = {};
  for (const p of d.platos) porCat[p.categoria] = (porCat[p.categoria] || 0) + 1;
  console.table(porCat);
  console.log('--seco: no se ha escrito nada.');
  process.exit(0);
}

exigeEntorno();

const idPorSlug = (filas) => Object.fromEntries(filas.map((f) => [f.slug, f.id]));

/* --- 1 · Categorías. Las madres primero, porque las hijas las referencian ---- */

const madres = d.categorias.filter((c) => !c.padre);
const hijas = d.categorias.filter((c) => c.padre);

const filasMadre = await guarda(
  'categorias',
  madres.map((c) => ({
    slug: c.slug,
    padre_id: null,
    nombre: c.nombre,
    descripcion: c.descripcion || {},
    icono: c.icono || 'generico',
    orden: c.orden || 0,
    activa: true,
  })),
  'slug'
);

let cats = idPorSlug(filasMadre);

const filasHija = await guarda(
  'categorias',
  hijas.map((c) => ({
    slug: c.slug,
    padre_id: cats[c.padre],
    nombre: c.nombre,
    descripcion: c.descripcion || {},
    icono: c.icono || 'generico',
    orden: c.orden || 0,
    activa: true,
  })),
  'slug'
);

cats = { ...cats, ...idPorSlug(filasHija) };
console.log(`categorías: ${Object.keys(cats).length}`);

/* --- 2 · Grupos de opciones y sus opciones -------------------------------- */

const filasGrupo = await guarda(
  'grupos_opcion',
  d.grupos.map((g) => ({
    slug: g.slug,
    nombre: g.nombre,
    tipo: g.tipo || 'unica',
    obligatorio: !!g.obligatorio,
    orden: g.orden || 0,
  })),
  'slug'
);
const grupos = idPorSlug(filasGrupo);

for (const g of d.grupos) {
  await guarda(
    'opciones',
    g.opciones.map((o, i) => ({
      grupo_id: grupos[g.slug],
      slug: o.slug,
      nombre: o.nombre,
      incremento: o.incremento === undefined ? null : o.incremento,
      orden: i + 1,
    })),
    'grupo_id,slug'
  );
}
console.log(`grupos: ${Object.keys(grupos).length}`);

/* --- 3 · Vocabularios fijos ------------------------------------------------
   Salen de vocabularios.json, no del .sql: el .sql define la estructura y el
   JSON el contenido. Una sola fuente de verdad para cada cosa. */

const alergenos = idPorSlug(
  await guarda(
    'alergenos',
    v.alergenos.map((a) => ({ id: a.id, slug: a.slug, nombre: a.nombre, orden: a.orden })),
    'id'
  )
);
const etiquetas = idPorSlug(
  await guarda(
    'etiquetas',
    v.etiquetas.map((e) => ({ slug: e.slug, nombre: e.nombre, icono: e.icono, orden: e.orden })),
    'slug'
  )
);
const escalas = idPorSlug(
  await guarda(
    'escalas',
    v.escalas.map((e) => ({
      slug: e.slug,
      nombre: e.nombre,
      maximo: e.maximo,
      icono: e.icono,
      orden: e.orden,
    })),
    'slug'
  )
);
console.log(
  `vocabularios: ${Object.keys(alergenos).length} alérgenos · ` +
    `${Object.keys(etiquetas).length} etiquetas · ${Object.keys(escalas).length} escalas`
);

/* --- 4 · Platos ------------------------------------------------------------ */

const filasPlato = await guarda(
  'platos',
  d.platos.map((p) => ({
    slug: p.slug,
    numero: p.numero || null,
    categoria_id: cats[p.categoria],
    nombre: p.nombre,
    descripcion: p.descripcion || {},
    nota: p.nota || {},
    imagen: p.imagen || null,
    destacado: !!p.destacado,
    disponible: true,
    orden: p.orden || 0,
  })),
  'slug'
);
const platos = idPorSlug(filasPlato);
console.log(`platos: ${Object.keys(platos).length}`);

/* --- 5 · Las relaciones de cada plato -------------------------------------- */

const ids = Object.values(platos);
const enLista = `plato_id=in.(${ids.join(',')})`;

for (const t of ['plato_precios', 'plato_alergenos', 'plato_etiquetas', 'plato_escalas', 'plato_grupos']) {
  await borra(t, enLista);
}

const precios = [];
const alerg = [];
const etiq = [];
const esc = [];
const grup = [];

for (const p of d.platos) {
  const id = platos[p.slug];
  (p.precios || []).forEach((pr, i) =>
    precios.push({
      plato_id: id,
      etiqueta: pr.etiqueta || null,
      precio: pr.precio === undefined ? null : pr.precio,
      orden: i + 1,
    })
  );
  for (const a of p.alergenos || [])
    alerg.push({ plato_id: id, alergeno_id: alergenos[a], grado: 'contiene' });
  for (const e of p.etiquetas || []) etiq.push({ plato_id: id, etiqueta_id: etiquetas[e] });
  for (const s of p.escalas || [])
    esc.push({ plato_id: id, escala_id: escalas[s.slug], valor: s.valor });
  (p.grupos || []).forEach((g, i) => grup.push({ plato_id: id, grupo_id: grupos[g], orden: i + 1 }));
}

await inserta('plato_precios', precios);
await inserta('plato_alergenos', alerg);
await inserta('plato_etiquetas', etiq);
await inserta('plato_escalas', esc);
await inserta('plato_grupos', grup);

console.log(
  `relaciones: ${precios.length} precios · ${alerg.length} alérgenos · ` +
    `${etiq.length} etiquetas · ${esc.length} niveles · ${grup.length} grupos`
);
console.log('\nHecho. Ahora: node tools/carta.mjs && node tools/build.mjs');
