-- =============================================================================
--  0006 · El horario y el aviso de la web, «obligatorio» en las opciones y
--         reordenar con flechas
--
--  QUÉ TRAE
--    1 · horario   una fila por día de la semana, con sus turnos
--    2 · aviso     una sola fila: la franja temporal de la web
--    3 · guarda_horario(h)   los siete días de una vez, validados aquí
--    4 · sitio_json()        horario + aviso, lo que exporta tools/sitio.mjs
--    5 · guarda_grupo(g)     ahora también guarda «obligatorio»
--    6 · ordena(tabla, ids)  el orden de una lista de hermanos, de una vez
--
--  POR QUÉ EL HORARIO VIVE AQUÍ Y NO EN content/datos.json
--    Para que el restaurante lo cambie desde el panel. Viaja igual que la carta:
--    panel → Supabase → el flujo lo exporta a content/sitio.json → build.mjs lo
--    hornea en el HTML. La web pública sigue sin pedirle nada a nadie.
--
--  POR QUÉ NO ENTRA EN LAS COPIAS DEL HISTORIAL
--    carta_completa_json() y restaurar_publicacion() no se tocan A PROPÓSITO.
--    Volver a la carta de hace tres semanas no debe traer de vuelta el horario
--    de entonces ni un aviso ya caducado. El respaldo del horario es
--    content/sitio.json, versionado en git en cada publicación.
--
--  Se puede aplicar dos veces sin romper nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1 · horario
-- -----------------------------------------------------------------------------

-- El día va con su nombre, el mismo que usan content/sitio.json, build.mjs y
-- main.js: así no hay una tabla de traducción de números a días en tres sitios.
-- Cada turno es ["HH:MM","HH:MM"]. "24:00" como cierre es medianoche.
create table if not exists public.horario (
  dia         text primary key
              check (dia in ('lunes','martes','miercoles','jueves','viernes','sabado','domingo')),
  franjas     jsonb not null default '[]'::jsonb
              check (jsonb_typeof(franjas) = 'array'),
  actualizado timestamptz not null default now()
);

drop trigger if exists horario_actualizado on public.horario;
create trigger horario_actualizado
  before update on public.horario
  for each row execute function public.toca_actualizado();

-- La semilla con lo que hay publicado hoy (content/datos.json, Páxinas Galegas).
-- on conflict do nothing: aplicar la migración otra vez no pisa lo que el
-- restaurante haya cambiado desde el panel.
insert into public.horario (dia, franjas) values
  ('lunes',     '[["13:00","16:00"],["19:30","23:30"]]'),
  ('martes',    '[["13:00","16:00"],["19:30","23:30"]]'),
  ('miercoles', '[["13:00","16:00"],["19:30","23:30"]]'),
  ('jueves',    '[["13:00","16:00"],["19:30","23:30"]]'),
  ('viernes',   '[["13:00","16:30"],["19:30","23:30"]]'),
  ('sabado',    '[["13:00","16:30"],["19:30","23:30"]]'),
  ('domingo',   '[["13:00","16:30"],["19:30","23:30"]]')
on conflict (dia) do nothing;

-- -----------------------------------------------------------------------------
--  2 · aviso
-- -----------------------------------------------------------------------------

-- Una sola fila, y la clave primaria lo garantiza: id es siempre true.
-- hasta es el último día en que se enseña; null = hasta que se apague.
create table if not exists public.aviso (
  id          boolean primary key default true check (id),
  activo      boolean not null default false,
  texto       jsonb not null default '{}'::jsonb
              check (jsonb_typeof(texto) = 'object'),
  hasta       date,
  actualizado timestamptz not null default now()
);

drop trigger if exists aviso_actualizado on public.aviso;
create trigger aviso_actualizado
  before update on public.aviso
  for each row execute function public.toca_actualizado();

insert into public.aviso (id) values (true) on conflict (id) do nothing;

-- RLS igual que el resto: solo admin, y anon sin ninguna política.
do $$
declare t text;
begin
  foreach t in array array['horario','aviso'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.es_admin()) with check (public.es_admin())',
      t || '_admin', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
--  3 · guarda_horario
-- -----------------------------------------------------------------------------

-- { "lunes": [["13:00","16:00"],["19:30","23:30"]], "martes": [], … }
-- Tienen que venir los siete días. Un día con [] está cerrado.
-- El panel ya valida lo mismo junto a cada campo; esto es el cinturón, para
-- que ni un panel viejo ni una llamada a mano dejen un horario imposible.
create or replace function public.guarda_horario(h jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_dia     text;
  v_franjas jsonb;
  v_f       jsonb;
  v_ab      int;
  v_ci      int;
  v_prev    int;
  v_orden   jsonb;
begin
  if not public.es_admin() then
    raise exception 'sin_permiso' using hint = 'okaeri';
  end if;
  if h is null or jsonb_typeof(h) <> 'object' then
    raise exception 'horario_invalido' using hint = 'okaeri', detail = 'no es un objeto';
  end if;

  foreach v_dia in array array['lunes','martes','miercoles','jueves','viernes','sabado','domingo'] loop
    v_franjas := h->v_dia;
    if v_franjas is null or jsonb_typeof(v_franjas) <> 'array' then
      raise exception 'horario_invalido' using hint = 'okaeri', detail = 'falta ' || v_dia;
    end if;
    if jsonb_array_length(v_franjas) > 3 then
      raise exception 'horario_invalido' using hint = 'okaeri', detail = v_dia || ': más de tres turnos';
    end if;

    -- Cada turno: dos horas HH:MM, la segunda después de la primera.
    for v_f in select * from jsonb_array_elements(v_franjas) loop
      if jsonb_typeof(v_f) <> 'array' or jsonb_array_length(v_f) <> 2
         or coalesce(v_f->>0, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(v_f->>1, '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
        raise exception 'horario_invalido' using hint = 'okaeri', detail = v_dia || ': hora mal escrita';
      end if;
      v_ab := split_part(v_f->>0, ':', 1)::int * 60 + split_part(v_f->>0, ':', 2)::int;
      v_ci := split_part(v_f->>1, ':', 1)::int * 60 + split_part(v_f->>1, ':', 2)::int;
      if v_ci <= v_ab then
        raise exception 'horario_invalido' using hint = 'okaeri', detail = v_dia || ': cierra antes de abrir';
      end if;
    end loop;

    -- Ordenados por la hora de abrir, y sin solaparse.
    select coalesce(jsonb_agg(x.e order by x.e->>0), '[]'::jsonb)
      into v_orden
      from jsonb_array_elements(v_franjas) as x(e);
    v_prev := -1;
    for v_f in select * from jsonb_array_elements(v_orden) loop
      v_ab := split_part(v_f->>0, ':', 1)::int * 60 + split_part(v_f->>0, ':', 2)::int;
      if v_ab < v_prev then
        raise exception 'horario_invalido' using hint = 'okaeri', detail = v_dia || ': dos turnos se solapan';
      end if;
      v_prev := split_part(v_f->>1, ':', 1)::int * 60 + split_part(v_f->>1, ':', 2)::int;
    end loop;

    insert into public.horario (dia, franjas) values (v_dia, v_orden)
    on conflict (dia) do update set franjas = excluded.franjas
      where public.horario.franjas is distinct from excluded.franjas;
  end loop;

  return public.sitio_json()->'horario';
end;
$$;

-- -----------------------------------------------------------------------------
--  4 · sitio_json
-- -----------------------------------------------------------------------------

-- Lo que exporta tools/sitio.mjs a content/sitio.json. Mismo patrón y mismos
-- permisos que carta_json(): security definer, y la llaman la exportación con
-- la service_role y el panel para saber qué falta por publicar.
-- «hasta» sale como texto AAAA-MM-DD para que el JSON no dependa de la zona.
create or replace function public.sitio_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'horario', (
      select coalesce(jsonb_object_agg(dia, franjas), '{}'::jsonb) from public.horario
    ),
    'aviso', coalesce((
      select jsonb_build_object(
        'activo', a.activo,
        'texto',  a.texto,
        'hasta',  to_char(a.hasta, 'YYYY-MM-DD'))
      from public.aviso a where a.id
    ), jsonb_build_object('activo', false, 'texto', '{}'::jsonb, 'hasta', null))
  );
$$;

-- -----------------------------------------------------------------------------
--  5 · guarda_grupo, ahora con «obligatorio»
-- -----------------------------------------------------------------------------

-- Igual que en 0005 más una cosa: «obligatorio». Hasta ahora el panel no podía
-- tocarlo, y el asistente de pedido de la carta ya bloquea «Añadir» cuando un
-- grupo obligatorio está sin elegir.
-- Si la llamada no trae la clave (un panel viejo que siga en la caché de
-- alguien), se conserva el valor que había: no se apaga en silencio.
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
    insert into public.grupos_opcion (slug, nombre, tipo, obligatorio, orden)
    values (v_slug, g->'nombre', coalesce(nullif(g->>'tipo', ''), 'unica'),
            coalesce((g->>'obligatorio')::boolean, false),
            coalesce((g->>'orden')::int, 0))
    returning id into v_id;
  else
    update public.grupos_opcion
       set slug        = v_slug,
           nombre      = g->'nombre',
           tipo        = coalesce(nullif(g->>'tipo', ''), 'unica'),
           obligatorio = case when g ? 'obligatorio'
                              then coalesce((g->>'obligatorio')::boolean, false)
                              else obligatorio end,
           orden       = coalesce((g->>'orden')::int, 0)
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
--  6 · ordena
-- -----------------------------------------------------------------------------

-- El panel manda los ids de una lista de hermanos en el orden nuevo y cada uno
-- recibe su posición (1, 2, 3…). Una llamada y una transacción: cortar a mitad
-- no deja dos platos con el mismo número.
-- La tabla va en una LISTA BLANCA y entra con %I: el nombre lo manda el
-- navegador y no puede acabar pegado a mano dentro de un SQL.
-- security invoker: la RLS de cada tabla sigue decidiendo quién escribe.
create or replace function public.ordena(p_tabla text, p_ids uuid[])
returns int
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  if not public.es_admin() then
    raise exception 'sin_permiso' using hint = 'okaeri';
  end if;
  if p_tabla is null or p_tabla not in ('platos','categorias','grupos_opcion','escalas','etiquetas') then
    raise exception 'tabla_no_valida' using hint = 'okaeri';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  execute format(
    'update public.%I t set orden = x.n
       from unnest($1) with ordinality as x(id, n)
      where t.id = x.id and t.orden is distinct from x.n', p_tabla)
  using p_ids;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
--  7 · Permisos
-- -----------------------------------------------------------------------------

-- Por nombre de rol: en el esquema public, «from public» no quita nada
-- (lección de 0001, sección 9).
revoke execute on function public.guarda_horario(jsonb)  from public, anon;
revoke execute on function public.sitio_json()           from public, anon;
revoke execute on function public.guarda_grupo(jsonb)    from public, anon;
revoke execute on function public.ordena(text, uuid[])   from public, anon;

grant execute on function public.guarda_horario(jsonb)  to authenticated;
grant execute on function public.sitio_json()           to authenticated;
grant execute on function public.guarda_grupo(jsonb)    to authenticated;
grant execute on function public.ordena(text, uuid[])   to authenticated;

-- Que PostgREST vea ya las tablas y funciones nuevas sin esperar a su recarga.
notify pgrst, 'reload schema';
