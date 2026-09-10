/* =============================================================================
   Edge Function `publicar`
   La llama el botón de /admin/ y dispara el flujo de GitHub que vuelve a generar
   la carta y la sube. No publica nada por sí misma: solo tira del cable.

   POR QUÉ EXISTE, Y NO SE LLAMA A GITHUB DESDE EL NAVEGADOR
     Porque haría falta un token de GitHub con permiso de escritura dentro del
     JavaScript de una página pública. Cualquiera que abriese /admin/ podría
     leerlo y escribir en el repositorio. Aquí el token vive como secreto del
     proyecto y el navegador solo manda su sesión.

   DESPLIEGUE
     supabase functions deploy publicar --project-ref ymlswznlfmmjrxxisgva
     supabase secrets set GITHUB_TOKEN_CARTA=<token> --project-ref ymlswznlfmmjrxxisgva

   EL TOKEN
     Fine-grained, acotado SOLO al repositorio ramenOkaeri/ramenOkaeri.github.io
     y con un único permiso: Contents → Read and write (es lo que habilita
     repository_dispatch). No hace falta nada más y no se le da nada más.
   ============================================================================= */

const REPO = 'ramenOkaeri/ramenOkaeri.github.io';
const EVENTO = 'carta';

const CORS = {
  'Access-Control-Allow-Origin': 'https://ramenokaeri.com',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responde = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responde({ error: 'Solo POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const token = Deno.env.get('GITHUB_TOKEN_CARTA');
  if (!url || !anon || !token) {
    return responde({ error: 'Falta configuración en el servidor.' }, 500);
  }

  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return responde({ error: 'Hay que entrar primero.' }, 401);

  /* Quién llama, y si es admin. Se pregunta A LA BASE con el token de quien
     llama, no se cree lo que diga el cliente: es_admin() se evalúa en Postgres
     contra la tabla de perfiles. Un JWT válido de un usuario sin rol falla aquí. */
  const comprueba = await fetch(`${url}/rest/v1/rpc/es_admin`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!comprueba.ok) return responde({ error: 'La sesión no vale.' }, 401);
  const esAdmin = await comprueba.json().catch(() => false);
  if (esAdmin !== true) return responde({ error: 'Esa cuenta no puede publicar.' }, 403);

  /* repository_dispatch: el flujo .github/workflows/carta.yml escucha este
     evento. Devuelve 204 sin cuerpo cuando lo acepta. */
  const disparo = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'okaeri-panel',
    },
    body: JSON.stringify({ event_type: EVENTO }),
  });

  if (!disparo.ok) {
    const detalle = await disparo.text();
    console.error('GitHub respondió', disparo.status, detalle);
    return responde(
      { error: `GitHub ha rechazado la publicación (${disparo.status}).` },
      502,
    );
  }

  return responde({ ok: true, lanzado: new Date().toISOString() });
});
