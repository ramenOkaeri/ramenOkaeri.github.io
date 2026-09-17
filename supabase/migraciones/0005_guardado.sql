-- =============================================================================
--  Guardado de una sola vez desde el panel  ·  esquema 0005
--  Proyecto Supabase: ymlswznlfmmjrxxisgva
--  Se aplica DESPUES de 0001 a 0004 y es idempotente: se puede repegar.
--
--  QUE RESUELVE
--    Guardar un plato desde el panel eran 8 peticiones sueltas: el PATCH del
--    plato, cinco DELETE de las tablas puente y las inserciones. Si la red se
--    cortaba entre los borrados y las inserciones, el plato se quedaba sin
--    precios o sin alergenos, y lo segundo es un asunto legal (Reglamento (UE)
--    1169/2011). Aqui cada guardado es UNA funcion plpgsql, y PostgREST envuelve
--    cada llamada en una transaccion: o se guarda todo o no se guarda nada. Es
--    la misma garantia que ya da restaurar_publicacion() en 0002.
--
--  COMPATIBLE HACIA ATRAS
--    Solo anade tres funciones y una columna que admite nulos. El panel viejo
--    sigue funcionando con esto aplicado, asi que se pega ANTES de desplegar el
--    panel nuevo, que ya no sabe guardar de otra forma.
--
--  LOS ERRORES
--    Salen con una clave corta en el mensaje y hint = 'okaeri'. El texto que lee
--    el restaurante lo pone el panel (traduceError en admin.js): el SQL no lleva
--    ni tildes ni copy, y cambiar una frase no obliga a tocar la base.
--
--  LA PRUEBA
--    supabase/pruebas/0005_guardado.sql. Se pega despues de esto y se deshace
--    sola: termina lanzando una excepcion con el informe.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1 · La marca de alergenos revisados
-- -----------------------------------------------------------------------------

-- NULL = sin revisar; una fecha = revisados con la cocina ese dia.
--
-- TIENE QUE ADMITIR NULOS. restaurar_publicacion() (0002) mete las copias con
--   insert into public.platos select * from jsonb_populate_recordset(null::public.platos, ...)
-- y una copia guardada antes de esta migracion no trae la clave: con NOT NULL,
-- volver a cualquier publicacion vieja fallaria. carta_completa_json() la
-- recoge sola porque emite la fila entera con to_jsonb(t). carta_json() NO la
-- emite: la web publica no la necesita, y sin ella revisar alergenos no cuenta
-- como "cambio sin publicar".
alter table public.platos add column if not exists alergenos_revisados timestamptz;

-- -----------------------------------------------------------------------------
--  2 · guarda_plato
-- -----------------------------------------------------------------------------

-- Recibe la ficha entera y la deja exactamente asi:
--   { "id": uuid o null (null = plato nuevo), "slug", "numero", "categoria_id",
--     "nombre": {"es","en","gl"}, "descripcion": {...}, "nota": {...},
--     "imagen", "disponible", "orden",
--     "precios":   [ {"etiqueta": {...} o null, "precio": numero o null} ],
--     "alergenos": [ {"id": 1..14, "grado": "contiene" | "trazas"} ],
--     "etiquetas": [ uuid ], "escalas": [ {"id": uuid, "valor": n} ],
--     "grupos":    [ uuid ],
--     "alergenos_revisados": true | false   (opcional; si no viene, no se toca) }
--
-- NO TOCA destacado. La portada ya no lo lee (sus platos salen de datos.json)
-- y el panel ya no lo ensena.
--
-- security invoker A PROPOSITO: se aplica la RLS de 0001 (es_admin) igual que
-- a cualquier escritura del panel. La comprobacion de arriba no sustituye a la
-- RLS, solo sirve para devolver un error que se pueda traducir.
create or replace function public.guarda_plato(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_slug text := nullif(btrim(coalesce(p->>'slug', '')), '');
  v_rev  boolean := case when p ? 'alergenos_revisados'
                         then coalesce((p->>'alergenos_revisados')::boolean, false) end;
begin
  if not public.es_admin() then
    raise exception 'sin_permiso' using hint = 'okaeri';
  end if;
  if coalesce(btrim(p->'nombre'->>'es'), '') = '' then
    raise exception 'sin_nombre' using hint = 'okaeri';
  end if;
  -- La misma regla que carta.yml aplica al publicar. Comprobarla aqui evita que
  -- un plato guardado sin precio tumbe despues la publicacion entera.
  -- Son dos if y no un or: SQL no promete evaluar el or de izquierda a derecha,
  -- y jsonb_array_length() revienta si le llega algo que no es una lista.
  if jsonb_typeof(p->'precios') is distinct from 'array' then
    raise exception 'sin_precio' using hint = 'okaeri';
  end if;
  if jsonb_array_length(p->'precios') = 0 then
    raise exception 'sin_precio' using hint = 'okaeri';
  end if;
  if v_slug is null then
    raise exception 'sin_slug' using hint = 'okaeri';
  end if;

  if v_id is null then
    insert into public.platos (slug, numero, categoria_id, nombre, descripcion, nota,
                               imagen, disponible, orden, alergenos_revisados)
    values (v_slug,
            nullif(btrim(coalesce(p->>'numero', '')), ''),
            (p->>'categoria_id')::uuid,
            p->'nombre',
            coalesce(p->'descripcion', '{}'::jsonb),
            coalesce(p->'nota', '{}'::jsonb),
            nullif(p->>'imagen', ''),
            coalesce((p->>'disponible')::boolean, true),
            coalesce((p->>'orden')::int, 0),
            case when v_rev then now() end)
    returning id into v_id;
  else
    update public.platos
       set slug         = v_slug,
           numero       = nullif(btrim(coalesce(p->>'numero', '')), ''),
           categoria_id = (p->>'categoria_id')::uuid,
           nombre       = p->'nombre',
           descripcion  = coalesce(p->'descripcion', '{}'::jsonb),
           nota         = coalesce(p->'nota', '{}'::jsonb),
           imagen       = nullif(p->>'imagen', ''),
           disponible   = coalesce((p->>'disponible')::boolean, true),
           orden        = coalesce((p->>'orden')::int, 0),
           -- Marcar conserva la fecha de la primera revision; desmarcar la borra.
           alergenos_revisados = case
             when v_rev is null then alergenos_revisados
             when v_rev then coalesce(alergenos_revisados, now())
             else null end
     where id = v_id;
    if not found then
      raise exception 'plato_no_existe' using hint = 'okaeri';
    end if;
  end if;

  -- Las cinco tablas puente se sustituyen enteras: el formulario es la verdad.
  -- Dentro de la transaccion no hay ventana en la que el plato este vacio.
  delete from public.plato_precios   where plato_id = v_id;
  delete from public.plato_alergenos where plato_id = v_id;
  delete from public.plato_etiquetas where plato_id = v_id;
  delete from public.plato_escalas   where plato_id = v_id;
  delete from public.plato_grupos    where plato_id = v_id;

  -- ->'etiqueta' devuelve el null de JSON como 'null'::jsonb, no como NULL de
  -- SQL. El nullif lo convierte, para que "sin etiqueta" sea NULL como siempre.
  insert into public.plato_precios (plato_id, etiqueta, precio, orden)
  select v_id, nullif(x.e->'etiqueta', 'null'::jsonb), (x.e->>'precio')::numeric(6,2), x.n::int
    from jsonb_array_elements(p->'precios') with ordinality as x(e, n);

  insert into public.plato_alergenos (plato_id, alergeno_id, grado)
  select v_id, (x->>'id')::smallint, coalesce(nullif(x->>'grado', ''), 'contiene')
    from jsonb_array_elements(coalesce(p->'alergenos', '[]'::jsonb)) as x;

  -- #>> '{}' saca el texto de un escalar JSON: "abc" -> abc, sin las comillas.
  insert into public.plato_etiquetas (plato_id, etiqueta_id)
  select v_id, (x #>> '{}')::uuid
    from jsonb_array_elements(coalesce(p->'etiquetas', '[]'::jsonb)) as x;

  -- El trigger plato_escalas_rango (0001) sigue vigilando que el valor no se
  -- salga de su escala; si salta, se deshace el guardado entero.
  insert into public.plato_escalas (plato_id, escala_id, valor)
  select v_id, (x->>'id')::uuid, (x->>'valor')::smallint
    from jsonb_array_elements(coalesce(p->'escalas', '[]'::jsonb)) as x;

  insert into public.plato_grupos (plato_id, grupo_id, orden)
  select v_id, (x.e #>> '{}')::uuid, x.n::int
    from jsonb_array_elements(coalesce(p->'grupos', '[]'::jsonb)) with ordinality as x(e, n);

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;

-- -----------------------------------------------------------------------------
--  3 · guarda_grupo
-- -----------------------------------------------------------------------------

-- { "id": uuid o null, "slug", "nombre": {...}, "tipo": "unica" | "multiple",
--   "orden", "opciones": [ {"slug", "nombre": {...}, "incremento": numero o null} ] }
--
-- Las opciones se sustituyen enteras, como hacia el panel, pero ahora dentro de
-- la misma transaccion. Nadie referencia el id de una opcion: carta_json() va
-- por slug y plato_grupos apunta al grupo, no a la opcion.
-- obligatorio no se toca: el panel no lo edita.
create or replace function public.guarda_grupo(g jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id   uuid := nullif(g->>'id', '')::uuid;
  v_slug text := nullif(btrim(coalesce(g->>'slug', '')), '');
begin
  if not public.es_admin() then
    raise exception 'sin_permiso' using hint = 'okaeri';
  end if;
  if coalesce(btrim(g->'nombre'->>'es'), '') = '' then
    raise exception 'sin_nombre' using hint = 'okaeri';
  end if;
  if v_slug is null then
    raise exception 'sin_slug' using hint = 'okaeri';
  end if;

  if v_id is null then
    insert into public.grupos_opcion (slug, nombre, tipo, orden)
    values (v_slug, g->'nombre', coalesce(nullif(g->>'tipo', ''), 'unica'),
            coalesce((g->>'orden')::int, 0))
    returning id into v_id;
  else
    update public.grupos_opcion
       set slug   = v_slug,
           nombre = g->'nombre',
           tipo   = coalesce(nullif(g->>'tipo', ''), 'unica'),
           orden  = coalesce((g->>'orden')::int, 0)
     where id = v_id;
    if not found then
      raise exception 'grupo_no_existe' using hint = 'okaeri';
    end if;
  end if;

  delete from public.opciones where grupo_id = v_id;

  insert into public.opciones (grupo_id, slug, nombre, incremento, orden)
  select v_id, x.e->>'slug', x.e->'nombre', (x.e->>'incremento')::numeric(6,2), x.n::int
    from jsonb_array_elements(coalesce(g->'opciones', '[]'::jsonb)) with ordinality as x(e, n);

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;

-- -----------------------------------------------------------------------------
--  4 · guarda_alergenos
-- -----------------------------------------------------------------------------

-- Solo los alergenos de un plato y su marca de revisado. Es lo que usa la
-- pantalla de revision, y existe aparte de guarda_plato A PROPOSITO: esa
-- sustituye la ficha entera, y si la revision la usara, repasar alergenos con
-- una copia de hace diez minutos podria pisar un precio que otra persona acaba
-- de cambiar. Esta no toca nada mas.
create or replace function public.guarda_alergenos(
  p_plato     uuid,
  p_alergenos jsonb,
  p_revisados boolean default true)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare v_rev timestamptz;
begin
  if not public.es_admin() then
    raise exception 'sin_permiso' using hint = 'okaeri';
  end if;
  if not exists (select 1 from public.platos where id = p_plato) then
    raise exception 'plato_no_existe' using hint = 'okaeri';
  end if;

  delete from public.plato_alergenos where plato_id = p_plato;

  insert into public.plato_alergenos (plato_id, alergeno_id, grado)
  select p_plato, (x->>'id')::smallint, coalesce(nullif(x->>'grado', ''), 'contiene')
    from jsonb_array_elements(coalesce(p_alergenos, '[]'::jsonb)) as x;

  update public.platos
     set alergenos_revisados = case when p_revisados
                                    then coalesce(alergenos_revisados, now())
                                    else null end
   where id = p_plato
  returning alergenos_revisados into v_rev;

  return jsonb_build_object('id', p_plato, 'alergenos_revisados', v_rev);
end;
$$;

-- -----------------------------------------------------------------------------
--  5 · Permisos
-- -----------------------------------------------------------------------------

-- Por nombre de rol, que "from public" no quita nada en este esquema: es la
-- leccion de 0001, seccion 9. Las llama el panel con la sesion de quien entra.
revoke execute on function public.guarda_plato(jsonb)                   from public, anon;
revoke execute on function public.guarda_grupo(jsonb)                   from public, anon;
revoke execute on function public.guarda_alergenos(uuid, jsonb, boolean) from public, anon;

grant execute on function public.guarda_plato(jsonb)                   to authenticated;
grant execute on function public.guarda_grupo(jsonb)                   to authenticated;
grant execute on function public.guarda_alergenos(uuid, jsonb, boolean) to authenticated;

-- Que PostgREST vea ya las funciones nuevas sin esperar a su recarga.
notify pgrst, 'reload schema';
