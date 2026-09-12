/* =============================================================================
   El buzón de las fotos de plato.
   Se ejecuta con:  node tools/fotos-buzon.mjs --recoge   baja las que esperen
                    node tools/fotos-buzon.mjs --vacia    borra las que ya están

   POR QUÉ UN BUZÓN, IGUAL QUE EL PDF
     La carta pública no le pide nada a nadie de fuera del dominio. Si la foto se
     sirviera desde Supabase, cada visita a la carta saldría a un tercero y se
     perdería de golpe lo de no tener cookies ni banner, además de atar la carta
     a que Supabase esté en pie. Así que la foto solo PASA por Storage: el panel
     la deja ahí, este script la baja desde el flujo de GitHub, la escribe en
     assets/img/platos/ y —después de publicar— vacía el buzón.

   EL RECORTE NO SE HACE AQUÍ, SE HACE EN EL PANEL
     El navegador ya trae decodificador de imágenes, así que recorta el cuadrado
     y comprime el JPEG antes de subir. Eso deja este script en copiar bytes y
     resuelve de paso los tres fallos de verdad de subir una foto desde un móvil:
     los 4 MB del original, el HEIC del iPhone y la foto girada por el EXIF. Y
     sobre todo, deja el repositorio sin package.json: meter aquí el recorte
     obligaría a instalar sharp en cada pasada del flujo.

   POR QUÉ NO BORRA LAS FOTOS QUE YA NO USA NINGÚN PLATO
     Porque el Historial del panel deja volver a una carta de hace tres
     publicaciones, y esa carta referencia las fotos de entonces. Barriendo las
     no referenciadas, volver atrás pintaría cuadros roto. Y no se gana nada
     midiéndolo: borrarlas del árbol no recupera el espacio, que se queda en la
     historia de git de todas formas. Una foto de 192 px son 15 KB; el huérfano
     que deja cambiar una foto no es un problema que haya que resolver.
   ============================================================================= */

import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigeEntorno, almacen } from './supabase.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'assets', 'img', 'platos');
const CARTA = join(RAIZ, 'content', 'carta.json');

const CUBO = 'fotos';
/* Un mega, el mismo número que el file_size_limit del bucket. Lo que sube el
   panel son unos 15 KB; esto solo corta una subida que no haya pasado por el
   recorte. El motivo de fondo es el del PDF: cada foto se queda en la historia
   de git PARA SIEMPRE y ese espacio no se recupera. */
const TOPE = 1024 * 1024;

/* El nombre viene de Storage y de ahí sale a un join() que escribe en el árbol.
   Aunque solo un administrador pueda subir, el nombre NO se usa sin pasar por
   aquí: un "../../.github/workflows/carta.yml" escribiría en el flujo. Lo que se
   acepta es exactamente lo que genera el panel. */
const NOMBRE = /^[a-z0-9][a-z0-9-]{0,79}\.jpg$/;

/* Las claves se escriben DIRECTAMENTE en $GITHUB_OUTPUT y no por redirección del
   paso, por lo mismo que en pdf-buzon.mjs: ese archivo solo admite clave=valor y
   redirigiendo la salida entera se cuelan ahí las frases para leer. */
function salida(clave, valor) {
  const linea = `${clave}=${valor}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, linea + '\n');
  console.log(linea);
}

const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8);

/* Lo que de verdad dice si una foto vale. Cualquier JPEG empieza por FF D8 FF y
   termina en FF D9. Ese último es el que caza la subida cortada, que es el fallo
   realista con la cobertura de un móvil: una foto a medias se pinta como media
   foto gris y nadie sabe por qué. */
function revisa(buf) {
  const fallos = [];
  if (buf.length < 512) fallos.push('pesa menos de 512 bytes');
  if (buf.length > TOPE) fallos.push(`pesa ${(buf.length / 1024).toFixed(0)} KB y el tope es 1 MB`);
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    fallos.push('no empieza por FF D8 FF, así que no es un JPEG');
  }
  const fin = buf.subarray(Math.max(0, buf.length - 2));
  if (fin[0] !== 0xff || fin[1] !== 0xd9) fallos.push('no termina en FF D9, así que llegó cortada');
  return fallos;
}

async function recoge() {
  const objetos = await almacen.lista(CUBO);
  const esperando = (objetos || []).filter((o) => o && o.name && o.name !== '.emptyFolderPlaceholder');

  if (!esperando.length) {
    console.log('El buzón de fotos está vacío. Las fotos de la web se quedan como están.');
    salida('recogido', 'no');
    salida('nuevas', '0');
    cuenta();
    return;
  }

  mkdirSync(DESTINO, { recursive: true });
  let nuevas = 0;
  let identicas = 0;

  for (const o of esperando) {
    if (!NOMBRE.test(o.name)) {
      console.error(`::error::"${o.name}" no tiene la forma de un nombre de foto del panel. Se queda en el buzón sin tocar.`);
      continue;
    }

    const buf = await almacen.baja(CUBO, o.name);
    const fallos = revisa(buf);
    if (fallos.length) {
      /* Rojo y bien visible, pero NO tumba la publicación: la carta es el
         producto y una foto es un asunto lateral. Se queda en el buzón para
         poder mirarla. */
      console.error(`::error::La foto "${o.name}" no vale: ${fallos.join(', ')}. No se escribe y se queda en el buzón.`);
      continue;
    }

    const destino = join(DESTINO, o.name);
    /* El nombre lleva la huella del contenido, así que "ya existe" es "ya es
       exactamente esta". Se comprueba de todas formas en vez de creérselo. */
    if (existsSync(destino) && sha(readFileSync(destino)) === sha(buf)) {
      console.log(`${o.name}: ya estaba publicada, idéntica. No se toca.`);
      identicas++;
      continue;
    }
    writeFileSync(destino, buf);
    console.log(`${o.name}: recogida, ${(buf.length / 1024).toFixed(0)} KB.`);
    nuevas++;
  }

  salida('recogido', nuevas + identicas > 0 ? 'si' : 'no');
  salida('nuevas', String(nuevas));
  cuenta();
}

/* Un plato puede apuntar a una foto que no está en el árbol ni en el buzón: se
   publicó justo mientras se subía, o alguien escribió la ruta a mano cuando el
   campo todavía era una caja de texto. Eso se sirve como imagen roto, y el <img>
   de la carta no tiene respaldo al que caerse. No tumba la publicación
   —blanquear la columna desde aquí sería que el flujo escribiese en la base—,
   pero sale en amarillo con el nombre del plato para poder arreglarlo. */
function cuenta() {
  if (!existsSync(CARTA)) return;
  let platos;
  try {
    platos = JSON.parse(readFileSync(CARTA, 'utf8')).platos || [];
  } catch {
    return;
  }
  const conFoto = platos.filter((p) => p.imagen);
  for (const p of conFoto) {
    const m = String(p.imagen).match(/^\/assets\/img\/platos\/([^/?#]+)$/);
    if (!m || !existsSync(join(DESTINO, m[1]))) {
      console.log(`::warning::"${p.slug}" apunta a ${p.imagen} y esa foto no está en el árbol. Vuelve a subirla desde el panel.`);
    }
  }
  const total = existsSync(DESTINO) ? readdirSync(DESTINO).filter((f) => f.endsWith('.jpg')).length : 0;
  console.log(`${total} foto(s) en assets/img/platos · ${conFoto.length} plato(s) con foto`);
}

/* Se vacía SOLO lo que ya está en el árbol. Es una comprobación sin memoria: el
   nombre lleva la huella del contenido, así que "el archivo existe" es "esta
   foto exacta llegó a la web". Así --vacia no necesita que --recoge le cuente
   nada, que son dos procesos distintos, y una foto que no se pudo recoger se
   queda esperando a la próxima publicación en vez de perderse. */
async function vacia() {
  const objetos = await almacen.lista(CUBO);
  let borradas = 0;
  for (const o of objetos || []) {
    if (!o || !o.name || !NOMBRE.test(o.name)) continue;
    if (!existsSync(join(DESTINO, o.name))) {
      console.log(`${o.name}: no ha llegado al árbol. Se queda en el buzón.`);
      continue;
    }
    await almacen.borra(CUBO, o.name);
    borradas++;
  }
  console.log(`Buzón de fotos: ${borradas} borrada(s).`);
}

exigeEntorno();

if (process.argv.includes('--recoge')) {
  /* Un tropiezo del almacén —el bucket sin crear, un corte de red— avisa y deja
     seguir. Que la carta no se pueda publicar porque no se han podido mirar las
     fotos sería cambiar un problema pequeño por uno grande. */
  try {
    await recoge();
  } catch (e) {
    console.log('::warning::No se ha podido mirar el buzón de fotos (' + e.message + '). Se publica la carta con las fotos que ya están.');
    salida('recogido', 'no');
    salida('nuevas', '0');
  }
} else if (process.argv.includes('--vacia')) {
  await vacia();
} else {
  console.error('Hace falta --recoge o --vacia.');
  process.exit(1);
}
