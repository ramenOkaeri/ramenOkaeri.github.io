-- =============================================================================
--  Historial de publicaciones  ·  esquema 0002
--  Proyecto Supabase: ymlswznlfmmjrxxisgva
--  Se aplica DESPUES de 0001_carta.sql y es idempotente: se puede repegar.
--
--  QUE RESUELVE
--    Cada vez que se publica se guarda una copia COMPLETA de la carta, y se
--    puede volver a ella. Completa quiere decir la de verdad: tambien los
--    platos que estan fuera de la carta y las categorias apagadas, que
--    carta_json() descarta a proposito porque es un documento de PRESENTACION.
--    Esto de aqui es un VOLCADO. Son dos trabajos distintos y no hay que
--    unificarlos: el dia que se unifiquen, o la web publica ensena los platos
--    apagados o la copia de seguridad deja de serlo.
--
--  QUE NO ENTRA EN LA COPIA
--    perfiles. Ahi viven el correo y el uuid de auth de cada cuenta, y una
--    copia de la carta no tiene nada que hacer con eso. Las otras doce tablas
--    son la carta, que esta impresa en la pared del local.
--
--  QUIEN ESCRIBE AQUI
--    El flujo de GitHub con la clave service_role, que salta RLS. El panel solo
--    LEE. Un registro que el cliente puede editar no es un registro.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1 · El volcado completo
-- -----------------------------------------------------------------------------

-- Se emite FILA ENTERA con to_jsonb(t), no un documento a mano como hace
-- carta_json(). Asi la vuelta es un jsonb_populate_recordset directo, sin una
-- sola linea de traduccion de campos, y anadir manana una columna a una tabla
-- no obliga a tocar dos funciones. Van los ids, el orden, el slug, disponible,
-- activa y padre_id: sin ids, restaurar por slug convertiria un renombrado en
-- un duplicado.
create or replace function public.carta_completa_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    -- Version del formato. Si algun dia cambia el esquema, una copia vieja se
    -- puede reconocer ANTES de intentar meterla.
    'version', 1,
    'generado', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'alergenos',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),    '[]'::jsonb) from public.alergenos x),
    'etiquetas',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.etiquetas x),
    'escalas',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.escalas x),
    -- Las madres primero, solo para que se lea bien: la vuelta no se fia del
    -- orden del array y filtra por padre_id.
    'categorias',      (select coalesce(jsonb_agg(to_jsonb(x) order by (x.padre_id is not null), x.orden), '[]'::jsonb) from public.categorias x),
    'grupos_opcion',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.grupos_opcion x),
    'opciones',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.opciones x),
    'platos',          (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.platos x),
    'plato_precios',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.plato_precios x),
    'plato_alergenos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.plato_alergenos x),
    'plato_etiquetas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.plato_etiquetas x),
    'plato_escalas',   (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.plato_escalas x),
    'plato_grupos',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.orden), '[]'::jsonb) from public.plato_grupos x)
  );
$$;

-- -----------------------------------------------------------------------------
--  2 · La tabla
-- -----------------------------------------------------------------------------

-- 'en_curso' es una publicacion empezada de la que todavia no se sabe si va a
-- llegar a la web. Solo las 'publicada' cuentan como historial: si el flujo se
-- cae despues de capturar, esa fila no debe gastar uno de los diez sitios ni
-- aparecer en el panel como algo a lo que volver, porque nunca estuvo en la web.
create table if not exists public.publicaciones (
  id         uuid primary key default gen_random_uuid(),
  creado     timestamptz not null default now(),
  estado     text not null default 'en_curso' check (estado in ('en_curso', 'publicada')),
  -- 'publicacion' o 'antes de restaurar'. Lo segundo es la red: volver atras
  -- tambien se deshace.
  motivo     text not null default 'publicacion',
  resumen    text,          -- "73 platos en 6 secciones", el mismo del commit
  platos     int  not null default 0,
  carta_sha  text,          -- la huella de content/carta.json que se publico
  commit_sha text,          -- el commit que la subio
  -- EL PDF NO SE GUARDA AQUI. Se guarda el sha del blob de git de
  -- assets/pdf/menu.pdf, que es lo que devuelve  git hash-object . Volver a el
  -- es  git cat-file blob <sha> , y un blob alcanzable desde la historia no lo
  -- borra git nunca. content/carta.json ya se versiona en cada publicacion por
  -- esta misma razon; el PDF va en el mismo barco y no cuesta ni un byte de
  -- almacenamiento ni una linea de recogida de huerfanos.
  pdf_blob   text,
  datos      jsonb not null
);

create index if not exists publicaciones_recientes on public.publicaciones (creado desc);

-- -----------------------------------------------------------------------------
--  3 · La poda
-- -----------------------------------------------------------------------------

-- Diez y no mas. Es un carrusel, no un archivo: diez pasos atras cubren
-- cualquier error de un dia, y cada fila pesa del orden de 150 KB de jsonb.
create or replace function public.podar_publicaciones()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  with sobran as (
    select id from public.publicaciones
     where estado = 'publicada'
     order by creado desc
     offset 10
  )
  delete from public.publicaciones p using sobran s where p.id = s.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
--  4 · Abrir, cerrar y descartar
-- -----------------------------------------------------------------------------

-- LOS PARAMETROS LLEVAN p_ DELANTE A PROPOSITO. En plpgsql un parametro que se
-- llame  id  tapa la columna  id  dentro de un where, y el update se lleva por
-- delante la tabla entera sin quejarse. Es el error clasico.

create or replace function public.abrir_publicacion(p_motivo text default 'publicacion')
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  -- Barrido de las que se quedaron a medias. Si un flujo murio entre abrir y
  -- cerrar, su fila no llega nunca a 'publicada'. Una hora es de sobra: el
  -- flujo entero tarda un minuto o dos. Asi no hace falta ningun cron.
  delete from public.publicaciones
   where estado = 'en_curso' and creado < now() - interval '1 hour';

  insert into public.publicaciones (estado, motivo, platos, datos)
  values ('en_curso',
          coalesce(nullif(p_motivo, ''), 'publicacion'),
          (select count(*) from public.platos),
          public.carta_completa_json())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.cerrar_publicacion(
  p_id         uuid,
  p_resumen    text default null,
  p_carta_sha  text default null,
  p_commit_sha text default null,
  p_pdf_blob   text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.publicaciones
     set estado     = 'publicada',
         resumen    = p_resumen,
         carta_sha  = p_carta_sha,
         commit_sha = p_commit_sha,
         pdf_blob   = p_pdf_blob
   where id = p_id and estado = 'en_curso';

  if not found then
    raise exception 'No hay ninguna publicacion a medias con ese identificador.';
  end if;

  return jsonb_build_object('ok', true, 'podadas', public.podar_publicaciones());
end;
$$;

-- Se llama cuando el flujo termina y resulta que no habia nada que publicar
-- (git status limpio), o cuando el flujo falla. Sin esto, darle dos veces
-- seguidas al boton dejaria dos copias identicas y echaria una buena.
create or replace function public.descartar_publicacion(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  delete from public.publicaciones where id = p_id and estado = 'en_curso';
$$;

-- -----------------------------------------------------------------------------
--  5 · Volver a una publicacion guardada
-- -----------------------------------------------------------------------------

-- ES ATOMICA, Y NO POR CASUALIDAD. PostgREST envuelve cada llamada a una
-- funcion en UNA transaccion. Como todo esto es una sola funcion plpgsql, o
-- pasa entero o no pasa nada: cualquier raise, cualquier clave foranea rota,
-- cualquier not null sin rellenar, y Postgres deshace hasta antes del primer
-- delete. NO EXISTE EL ESTADO "MEDIA CARTA".
create or replace function public.restaurar_publicacion(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  fila public.publicaciones%rowtype;
  d    jsonb;
begin
  select * into fila
    from public.publicaciones
   where id = p_id and estado = 'publicada';
  if not found then
    raise exception 'No hay ninguna publicacion guardada con ese identificador.';
  end if;

  -- Se copia el volcado a una variable ANTES de nada. La red de abajo inserta
  -- una fila y poda, y la poda podria llevarse por delante justo esta si era la
  -- mas vieja de las diez. Con el jsonb ya en la mano, da igual.
  d := fila.datos;

  if coalesce((d->>'version')::int, 0) <> 1 then
    raise exception 'Esa copia es de un formato que este esquema no sabe leer.';
  end if;

  -- --- La red: como esta la carta AHORA, antes de tocarla -------------------
  -- Volver atras tambien se deshace. Y se hereda el pdf_blob de lo ultimo que
  -- se publico, que es el PDF que hay ahora mismo en la web: sin eso, deshacer
  -- una restauracion devolveria los platos pero no el PDF.
  insert into public.publicaciones (estado, motivo, resumen, platos, pdf_blob, datos)
  values ('publicada',
          'antes de restaurar',
          'copia automatica antes de volver a la carta del '
            || to_char(fila.creado at time zone 'Europe/Madrid', 'DD/MM HH24:MI'),
          (select count(*) from public.platos),
          (select p.pdf_blob from public.publicaciones p
            where p.estado = 'publicada' order by p.creado desc limit 1),
          public.carta_completa_json());

  perform public.podar_publicaciones();

  -- --- Borrado: de las hojas al tronco --------------------------------------
  -- Las cinco tablas puente caen solas por cascada al borrar platos. Se borran
  -- a mano igualmente para que el orden se lea AQUI y no haya que ir tabla por
  -- tabla mirando cada clave foranea.
  delete from public.plato_precios;
  delete from public.plato_alergenos;
  delete from public.plato_etiquetas;
  delete from public.plato_escalas;
  delete from public.plato_grupos;
  -- platos ANTES que categorias: platos.categoria_id es ON DELETE RESTRICT, asi
  -- que con un solo plato vivo el borrado de su categoria falla.
  delete from public.platos;
  delete from public.opciones;
  delete from public.grupos_opcion;
  -- categorias.padre_id se referencia a si misma con ON DELETE CASCADE: un
  -- unico delete sobre toda la tabla vale, la cascada sobre filas ya borradas
  -- no hace nada.
  delete from public.categorias;
  delete from public.etiquetas;
  delete from public.escalas;
  -- alergenos NO SE BORRA NUNCA. Es la lista cerrada del Reglamento (UE)
  -- 1169/2011, plato_alergenos.alergeno_id la referencia con ON DELETE RESTRICT
  -- y sus ids son fijos. Se pone al dia por upsert y en paz.

  -- --- Insercion: del tronco a las hojas ------------------------------------
  -- El slug NO se toca en el upsert de alergenos: es la clave con la que
  -- carta_json() y build.mjs casan las traducciones, y ademas es unique, asi
  -- que reescribirlo puede chocar con otra fila a mitad de la pasada.
  insert into public.alergenos
  select * from jsonb_populate_recordset(null::public.alergenos, coalesce(d->'alergenos', '[]'::jsonb))
  on conflict (id) do update set nombre = excluded.nombre, orden = excluded.orden;

  insert into public.etiquetas
  select * from jsonb_populate_recordset(null::public.etiquetas, coalesce(d->'etiquetas', '[]'::jsonb));

  insert into public.escalas
  select * from jsonb_populate_recordset(null::public.escalas, coalesce(d->'escalas', '[]'::jsonb));

  -- Dos pasadas y no una: la clave foranea padre_id se comprueba fila a fila, y
  -- ademas el trigger categorias_dos_niveles va a buscar la madre a la tabla.
  -- Con las hijas primero, las dos cosas fallan. Es el mismo orden que ya usa
  -- tools/semilla-carta.mjs.
  insert into public.categorias
  select * from jsonb_populate_recordset(null::public.categorias, coalesce(d->'categorias', '[]'::jsonb)) c
   where c.padre_id is null;
  insert into public.categorias
  select * from jsonb_populate_recordset(null::public.categorias, coalesce(d->'categorias', '[]'::jsonb)) c
   where c.padre_id is not null;

  insert into public.grupos_opcion
  select * from jsonb_populate_recordset(null::public.grupos_opcion, coalesce(d->'grupos_opcion', '[]'::jsonb));
  insert into public.opciones
  select * from jsonb_populate_recordset(null::public.opciones, coalesce(d->'opciones', '[]'::jsonb));
  insert into public.platos
  select * from jsonb_populate_recordset(null::public.platos, coalesce(d->'platos', '[]'::jsonb));

  insert into public.plato_precios
  select * from jsonb_populate_recordset(null::public.plato_precios, coalesce(d->'plato_precios', '[]'::jsonb));
  insert into public.plato_alergenos
  select * from jsonb_populate_recordset(null::public.plato_alergenos, coalesce(d->'plato_alergenos', '[]'::jsonb));
  insert into public.plato_etiquetas
  select * from jsonb_populate_recordset(null::public.plato_etiquetas, coalesce(d->'plato_etiquetas', '[]'::jsonb));
  insert into public.plato_escalas
  select * from jsonb_populate_recordset(null::public.plato_escalas, coalesce(d->'plato_escalas', '[]'::jsonb));
  insert into public.plato_grupos
  select * from jsonb_populate_recordset(null::public.plato_grupos, coalesce(d->'plato_grupos', '[]'::jsonb));

  -- --- La fecha de edicion es AHORA, no la del dia que se guardo ------------
  -- El panel compara max(actualizado) con assets/version.json para decir "hay
  -- cambios sin publicar" (admin.js:816-833). Si se reinstalaran las fechas
  -- viejas, el panel diria "todo publicado" con la carta recien cambiada
  -- debajo, y si el flujo se cayera despues de restaurar, nadie se enteraria.
  update public.platos        set actualizado = now();
  update public.categorias    set actualizado = now();
  update public.grupos_opcion set actualizado = now();

  return jsonb_build_object(
    'ok', true,
    'creado', fila.creado,
    'resumen', fila.resumen,
    'pdf_blob', fila.pdf_blob,
    'platos', (select count(*) from public.platos)
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  6 · La lista que ve el panel
-- -----------------------------------------------------------------------------

-- Una vista SIN la columna datos. Sin ella, un select=* del panel se traeria
-- diez volcados de 150 KB cada vez que se abre la pestana. Y de paso solo
-- ensena las publicadas: las 'en_curso' no son sitios a los que volver.
-- security_invoker = true para que la RLS de la tabla se siga evaluando con los
-- permisos de quien mira, y no con los del dueno de la vista.
create or replace view public.publicaciones_lista
with (security_invoker = true) as
  select id, creado, motivo, resumen, platos, carta_sha, commit_sha, pdf_blob
    from public.publicaciones
   where estado = 'publicada'
   order by creado desc;

-- -----------------------------------------------------------------------------
--  7 · RLS
-- -----------------------------------------------------------------------------

alter table public.publicaciones enable row level security;

-- SOLO LECTURA para el panel, y solo si es admin. No hay politica de insert, de
-- update ni de delete: quien escribe aqui es el flujo con la service_role, que
-- salta RLS. Un registro que el cliente puede editar no es un registro.
drop policy if exists publicaciones_lee on public.publicaciones;
create policy publicaciones_lee on public.publicaciones
  for select to authenticated
  using (public.es_admin());

-- anon no tiene politica, igual que en las trece de 0001. Pero aqui se le quita
-- ademas el permiso de tabla: sin politica un select de anon devuelve [] en vez
-- de un error, y un [] no distingue "no hay nada" de "no puedo".
revoke all on table public.publicaciones       from anon;
revoke all on table public.publicaciones_lista from anon;
grant select on public.publicaciones_lista to authenticated;

-- -----------------------------------------------------------------------------
--  8 · Permisos de las funciones
-- -----------------------------------------------------------------------------

-- "revoke ... from public" NO QUITA NADA en el esquema public: Supabase concede
-- EXECUTE directo a anon y authenticated por privilegios por defecto, asi que
-- hay que revocar POR NOMBRE DE ROL. Es la misma leccion de 0001, seccion 9.
--
-- NINGUNA de estas la puede llamar el panel. Ni siquiera restaurar_publicacion:
-- el panel pide la vuelta atras a la Edge Function, que dispara el flujo, que
-- es quien llama aqui con la service_role. Un solo camino, y ese camino es el
-- que ademas sabe devolver el PDF de aquel dia y reconstruir la web.
revoke execute on function public.carta_completa_json()   from public, anon, authenticated;
revoke execute on function public.podar_publicaciones()   from public, anon, authenticated;
revoke execute on function public.abrir_publicacion(text) from public, anon, authenticated;
revoke execute on function public.cerrar_publicacion(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.descartar_publicacion(uuid) from public, anon, authenticated;
revoke execute on function public.restaurar_publicacion(uuid) from public, anon, authenticated;

grant execute on function public.carta_completa_json()   to service_role;
grant execute on function public.podar_publicaciones()   to service_role;
grant execute on function public.abrir_publicacion(text) to service_role;
grant execute on function public.cerrar_publicacion(uuid, text, text, text, text) to service_role;
grant execute on function public.descartar_publicacion(uuid) to service_role;
grant execute on function public.restaurar_publicacion(uuid) to service_role;
