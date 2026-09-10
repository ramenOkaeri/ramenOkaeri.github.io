/* =============================================================================
   Cliente mínimo de PostgREST y de Storage para los scripts de construcción.
   Sin dependencias: el repositorio no tiene package.json y no va a tenerlo.

   LAS CLAVES SE LEEN DEL ENTORNO Y NO SE ESCRIBEN EN NINGÚN SITIO.
     SUPABASE_URL          https://<ref>.supabase.co
     SUPABASE_SERVICE_KEY  clave service_role, que salta RLS

   La service_role vive en el secreto del repositorio y en el .env local de
   Yixuan. Nunca en un archivo versionado, nunca en una nota, nunca en el HTML.
   ============================================================================= */

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.SUPABASE_SERVICE_KEY || '';

export function exigeEntorno() {
  const faltan = [];
  if (!URL_BASE) faltan.push('SUPABASE_URL');
  if (!CLAVE) faltan.push('SUPABASE_SERVICE_KEY');
  if (faltan.length) {
    console.error(`Falta en el entorno: ${faltan.join(', ')}`);
    console.error('En local:  $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_KEY="..."');
    process.exit(1);
  }
}

const cabeceras = (extra = {}) => ({
  apikey: CLAVE,
  Authorization: `Bearer ${CLAVE}`,
  'Content-Type': 'application/json',
  ...extra,
});

/* PostgREST contesta 200 CON EL CUERPO VACÍO cuando le pides return=minimal, no
   204. Un cliente que decida entre null y res.json() mirando solo el 204 revienta
   con "Unexpected end of JSON input" DESPUÉS de que la escritura haya funcionado:
   dice que ha fallado algo que está guardado, y empuja a repetirlo. Se lee como
   texto y se parsea solo si trae algo, que cubre el 204, el 200 vacío y el 201
   vacío de una vez. Lección de la bóveda, 21 de agosto de 2026. */
async function cuerpo(res) {
  const txt = await res.text();
  if (!txt.trim()) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

async function pide(ruta, opciones = {}) {
  const res = await fetch(`${URL_BASE}${ruta}`, opciones);
  const datos = await cuerpo(res);
  if (!res.ok) {
    const detalle = typeof datos === 'string' ? datos : JSON.stringify(datos);
    throw new Error(`${opciones.method || 'GET'} ${ruta} → ${res.status} ${detalle}`);
  }
  return datos;
}

export const selecciona = (tabla, consulta = 'select=*') =>
  pide(`/rest/v1/${tabla}?${consulta}`, { headers: cabeceras() });

/* Upsert por una columna única. Sin `filas` no se llama: PostgREST rechaza el
   array vacío y no hay nada que escribir. */
export async function guarda(tabla, filas, unica) {
  if (!filas.length) return [];
  return pide(`/rest/v1/${tabla}?on_conflict=${unica}`, {
    method: 'POST',
    headers: cabeceras({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(filas),
  });
}

export async function inserta(tabla, filas) {
  if (!filas.length) return [];
  return pide(`/rest/v1/${tabla}`, {
    method: 'POST',
    headers: cabeceras({ Prefer: 'return=minimal' }),
    body: JSON.stringify(filas),
  });
}

export async function borra(tabla, filtro) {
  return pide(`/rest/v1/${tabla}?${filtro}`, {
    method: 'DELETE',
    headers: cabeceras({ Prefer: 'return=minimal' }),
  });
}

export const rpc = (nombre, args = {}) =>
  pide(`/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify(args),
  });

/* --- Storage --------------------------------------------------------------
   Storage es otro servicio del mismo proyecto y con la misma clave, pero NO es
   PostgREST: el cuerpo va en binario, así que no puede pasar por pide(), que
   trata todas las respuestas como texto y todas las peticiones como JSON.
   Se usa para el buzón del PDF de la carta — ver supabase/migraciones/0003. */
export const almacen = {
  async lista(cubo, prefijo = '') {
    const res = await fetch(`${URL_BASE}/storage/v1/object/list/${cubo}`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ prefix: prefijo, limit: 100 }),
    });
    if (!res.ok) throw new Error(`list ${cubo} → ${res.status} ${await res.text()}`);
    return res.json();
  },

  async baja(cubo, ruta) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${cubo}/${ruta}`, {
      headers: { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` },
    });
    if (!res.ok) throw new Error(`get ${cubo}/${ruta} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },

  async borra(cubo, ruta) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${cubo}/${ruta}`, {
      method: 'DELETE',
      headers: cabeceras(),
    });
    if (!res.ok) throw new Error(`delete ${cubo}/${ruta} → ${res.status} ${await res.text()}`);
  },
};
