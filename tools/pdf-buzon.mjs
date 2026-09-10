/* =============================================================================
   El buzón del PDF de la carta.
   Se ejecuta con:  node tools/pdf-buzon.mjs --recoge    baja el PDF que espere
                    node tools/pdf-buzon.mjs --vacia     borra el del buzón

   POR QUÉ UN BUZÓN
     El PDF pesa 2,28 MB y el client_payload de un repository_dispatch tiene un
     tope de unos 64 KB, así que el PDF no puede viajar por el mismo cable que
     el aviso de publicar. El panel lo deja en un bucket privado de Supabase
     Storage y este script lo recoge desde el flujo de GitHub, lo escribe en
     assets/pdf/menu.pdf y —después de que se haya publicado— vacía el buzón.

     Un buzón que se queda el correo hace que cada publicación se baje 2,2 MB
     para nada y que el panel nunca pueda decir con verdad si hay algo esperando.

   LO QUE COMPRUEBA ANTES DE ESCRIBIR EN EL ÁRBOL
     Que empieza por %PDF-, que no viene vacío, que no pasa del tope y que los
     últimos kilobytes traen %%EOF. Ese último es el que caza una subida
     truncada, que es el fallo realista: un PDF a medias abre en blanco y el
     visor no dice por qué.
   ============================================================================= */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, almacen } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'assets', 'pdf', 'menu.pdf');

const CUBO = 'buzon';
const OBJETO = 'menu.pdf';
/* Doce megas, el mismo número que el file_size_limit del bucket. El motivo no
   es el ancho de banda: cada versión del PDF se queda en la historia de git
   PARA SIEMPRE y ese espacio no se recupera. */
const TOPE = 12 * 1024 * 1024;

/* El flujo lee estas líneas con  >> "$GITHUB_OUTPUT"  para decidir los pasos
   siguientes. En local no existe la variable y se imprimen y ya está. */
function salida(clave, valor) {
  const linea = `${clave}=${valor}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, linea + '\n');
  console.log(linea);
}

const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8);

async function recoge() {
  const objetos = await almacen.lista(CUBO);
  const suyo = (objetos || []).find((o) => o.name === OBJETO);

  if (!suyo) {
    console.log('El buzón está vacío. El PDF de la web se queda como está.');
    salida('recogido', 'no');
    return;
  }

  const buf = await almacen.baja(CUBO, OBJETO);
  const fallos = [];
  if (buf.length < 1024) fallos.push('pesa menos de 1 KB');
  if (buf.length > TOPE) fallos.push(`pesa ${(buf.length / 1048576).toFixed(1)} MB y el tope son 12`);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') fallos.push('no empieza por %PDF-');
  /* El marcador de fin va al final del archivo, pero puede llevar detrás algún
     byte de relleno; se busca en los últimos 2 KB y no solo en la última línea. */
  if (!buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1').includes('%%EOF')) {
    fallos.push('no termina en %%EOF, así que llegó cortado');
  }

  if (fallos.length) {
    console.error('::error::El PDF del buzón no vale: ' + fallos.join(', ') + '.');
    console.error('No se toca assets/pdf/menu.pdf. El archivo se queda en el buzón para poder mirarlo.');
    process.exit(1);
  }

  const antes = existsSync(DESTINO) ? sha(readFileSync(DESTINO)) : null;
  const ahora = sha(buf);

  if (antes === ahora) {
    console.log(`El PDF del buzón es idéntico al que ya está publicado (${ahora}). No se toca nada.`);
    salida('recogido', 'si');
    salida('identico', 'si');
    salida('bytes', String(buf.length));
    return;
  }

  writeFileSync(DESTINO, buf);
  console.log(`PDF nuevo recogido: ${buf.length} bytes · huella ${antes || 'ninguno'} → ${ahora}`);
  salida('recogido', 'si');
  salida('identico', 'no');
  salida('bytes', String(buf.length));
}

async function vacia() {
  await almacen.borra(CUBO, OBJETO);
  console.log('Buzón vaciado.');
}

exigeEntorno();

if (process.argv.includes('--recoge')) {
  await recoge();
} else if (process.argv.includes('--vacia')) {
  await vacia();
} else {
  console.error('Hace falta --recoge o --vacia.');
  process.exit(1);
}
