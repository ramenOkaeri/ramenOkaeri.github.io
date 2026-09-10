/* =============================================================================
   La copia de seguridad de cada publicación.
   Se ejecuta con:  node tools/instantanea.mjs --abre [motivo]
                    node tools/instantanea.mjs --cierra <id> [--resumen X] …
                    node tools/instantanea.mjs --descarta <id>

   POR QUÉ SE CAPTURA AQUÍ Y NO EN LA EDGE FUNCTION
     Porque una copia solo debe existir si esa carta llegó a la web. Capturando
     al pulsar el botón se guardarían también los intentos que la validación
     rechaza —menos de diez platos, un plato sin precio— y esas filas fantasma
     se comerían los diez sitios echando copias buenas.

     Y un trigger sería peor todavía: guardaPlato() borra y reinserta cinco
     tablas puente por cada plato guardado, así que un trigger por fila
     dispararía decenas de volcados completos de la carta por plato editado.

   EN DOS FASES
     --abre    después de validar la carta, cuando ya se sabe que el estado de
               la base es sano. Devuelve el identificador.
     --cierra  después del push, con el commit y el sha del PDF ya conocidos.
     --descarta cuando resulta que no había nada que publicar, o si la pasada
               se cae. Sin esto, darle dos veces al botón dejaría dos copias
               idénticas y echaría una buena.
   ============================================================================= */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, rpc } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = join(RAIZ, 'assets', 'version.json');

/* Lee un argumento con valor:  --resumen "73 platos"  →  "73 platos" */
function arg(nombre) {
  const i = process.argv.indexOf(nombre);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/* Lee el valor que va detrás de una bandera:  --cierra <id> */
function tras(bandera) {
  const i = process.argv.indexOf(bandera);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function salida(clave, valor) {
  const linea = `${clave}=${valor}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, linea + '\n');
  console.log(linea);
}

exigeEntorno();

if (process.argv.includes('--abre')) {
  const motivo = tras('--abre') && !tras('--abre').startsWith('--') ? tras('--abre') : 'publicacion';
  const id = await rpc('abrir_publicacion', { p_motivo: motivo });
  if (!id) {
    console.error('::error::Supabase no ha devuelto ningún identificador de publicación.');
    process.exit(1);
  }
  salida('id', id);
} else if (process.argv.includes('--cierra')) {
  const id = tras('--cierra');
  if (!id) {
    console.error('Hace falta el identificador de la publicación.');
    process.exit(1);
  }
  /* La huella de la carta la calcula build.mjs y la deja en version.json: no
     hace falta recalcularla, y así las dos no pueden discrepar. */
  let cartaSha = null;
  if (existsSync(VERSION)) {
    try {
      cartaSha = JSON.parse(readFileSync(VERSION, 'utf8')).carta || null;
    } catch {
      cartaSha = null;
    }
  }
  const r = await rpc('cerrar_publicacion', {
    p_id: id,
    p_resumen: arg('--resumen'),
    p_carta_sha: cartaSha,
    p_commit_sha: arg('--commit'),
    p_pdf_blob: arg('--pdf'),
  });
  console.log(`copia guardada · ${r?.podadas || 0} vieja(s) podada(s)`);
} else if (process.argv.includes('--descarta')) {
  const id = tras('--descarta');
  if (!id) {
    console.error('Hace falta el identificador de la publicación.');
    process.exit(1);
  }
  await rpc('descartar_publicacion', { p_id: id });
  console.log('copia descartada: no había nada que publicar.');
} else {
  console.error('Hace falta --abre, --cierra <id> o --descarta <id>.');
  process.exit(1);
}
