/* =============================================================================
   Vuelve a una publicación guardada.
   Se ejecuta con:  INSTANTANEA=<uuid> node tools/restaura.mjs

   POR QUÉ PASA POR AQUÍ Y NO LA LLAMA EL PANEL
     Porque el panel no puede tocar git, y volver atrás no es solo devolver los
     platos: también hay que devolver el PDF de aquel día y reconstruir la web.
     Así que la vuelta atrás viaja por el mismo cable que publicar —panel →
     Edge Function → repository_dispatch → este flujo— y restaurar_publicacion()
     ni siquiera necesita permiso de ejecución para el rol authenticated.

   EL PDF SE SACA DE GIT, NO DE UNA COPIA GUARDADA
     La fila de publicaciones no guarda los bytes del PDF: guarda el sha de su
     blob de git. `git cat-file blob <sha>` lo devuelve intacto, y un blob
     alcanzable desde la historia no lo borra git nunca. Eso ahorra un bucket
     entero, el direccionamiento por contenido para no duplicar 2,2 MB diez
     veces, y la recogida de huérfanos al podar.

   EL IDENTIFICADOR SE COMPRUEBA AQUÍ TAMBIÉN
     La Edge Function ya comprueba que es un uuid. Se vuelve a comprobar porque
     este valor viene de fuera y acaba en una variable de entorno de un paso de
     GitHub Actions: una comprobación que solo existe en un sitio es una
     comprobación que un día se olvida.
   ============================================================================= */

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, rpc } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PDF = join(RAIZ, 'assets', 'pdf', 'menu.pdf');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = (process.env.INSTANTANEA || '').trim();

if (!UUID.test(ID)) {
  console.error('::error::El identificador de la publicación no tiene forma de identificador.');
  process.exit(1);
}

exigeEntorno();

const r = await rpc('restaurar_publicacion', { p_id: ID });
console.log(`Vuelta la carta del ${r.creado} · ${r.platos} platos.`);

if (r.pdf_blob) {
  try {
    const buf = execFileSync('git', ['cat-file', 'blob', r.pdf_blob], { maxBuffer: 32 << 20 });
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('ese blob no es un PDF');
    writeFileSync(PDF, buf);
    console.log(`PDF de aquel día recuperado de git: ${buf.length} bytes.`);
  } catch (e) {
    /* Que no se recupere el PDF no puede tirar abajo la vuelta atrás: los platos
       ya han vuelto y eso es lo que importa. Se avisa y se sigue con el que hay. */
    console.log(`::warning::No se ha podido recuperar el PDF (${e.message}). Se queda el que hay.`);
  }
} else {
  console.log('Esa copia no tiene PDF apuntado. Se queda el que hay.');
}
