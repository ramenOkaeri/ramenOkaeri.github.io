-- =============================================================================
--  Carta de Ramen Okaeri  ·  esquema 0001
--  Proyecto Supabase: ymlswznlfmmjrxxisgva
--
--  ESTE ARCHIVO ES LA FUENTE DE VERDAD DEL ESQUEMA.
--  Lo que solo vive dentro de un proyecto gratuito desaparece con el proyecto.
--  Se aplica entero desde el editor de SQL de Supabase, o con el conector MCP.
--
--  QUIEN LEE LA CARTA PUBLICA NO ENTRA AQUI.
--  La web publica no habla con Supabase: tools/carta.mjs exporta al construir y
--  el visitante recibe HTML estatico. Por eso el rol anonimo no tiene ni una
--  politica: no necesita acceso a nada.
--
--  EL TEXTO MULTIIDIOMA VA EN jsonb {"es":..,"en":..,"gl":..} y no en tablas de
--  traduccion. Con tres idiomas y un solo editor, una tabla aparte multiplica el
--  formulario y la exportacion sin comprar nada. "A que le falta el gallego"
--  sigue respondiendose con  nombre->>'gl' is null.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  0 · Utilidades
-- -----------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Marca de tiempo de la ultima edicion. La sube un trigger y no el cliente: si
-- la subiera el cliente, el panel podria decir "sin cambios" con cambios dentro.
create or replace function public.toca_actualizado()
returns trigger
language plpgsql
as $$
begin
  new.actualizado := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
--  1 · Quien puede entrar
-- -----------------------------------------------------------------------------

create table if not exists public.perfiles (
  id     uuid primary key references auth.users(id) on delete cascade,
  correo text,
  rol    text not null default 'lector' check (rol in ('admin', 'lector')),
  creado timestamptz not null default now()
);

-- security definer A PROPOSITO. Si consultara perfiles con los permisos de quien
-- llama, la politica de perfiles se consultaria a si misma y entraria en
-- recursion infinita. Es el error clasico de RLS y hay que saberlo antes.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin'
  );
$$;

-- Toda cuenta nueva nace 'lector'. Subir a admin es un UPDATE manual, a mano y a
-- conciencia: no hay camino automatico de anonimo a administrador.
create or replace function public.alta_perfil()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.perfiles (id, correo, rol)
  values (new.id, new.email, 'lector')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.alta_perfil();

-- -----------------------------------------------------------------------------
--  2 · Vocabularios: alergenos, etiquetas, escalas
-- -----------------------------------------------------------------------------

-- Los 14 de declaracion obligatoria del Reglamento (UE) 1169/2011. Lista cerrada:
-- no se anaden ni se quitan desde el panel, porque no la decide el restaurante.
create table if not exists public.alergenos (
  id     smallint primary key,
  slug   text unique not null,
  nombre jsonb not null,
  orden  smallint not null
);

-- Vegano, vegetariano y lo que venga. Esta si crece desde el panel.
create table if not exists public.etiquetas (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,
  nombre jsonb not null,
  icono  text,
  orden  int not null default 0
);

-- LOS "NIVELES". Una escala define el tipo (picante, de 0 a 3, icono de chile);
-- plato_escalas guarda cuanto tiene ESTE plato. Anadir o quitar un nivel de una
-- ficha es insertar o borrar una fila, y crear un tipo nuevo no toca el esquema.
create table if not exists public.escalas (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,
  nombre jsonb not null,
  maximo smallint not null default 3 check (maximo between 1 and 10),
  icono  text not null default 'punto',
  orden  int not null default 0
);

-- -----------------------------------------------------------------------------
--  3 · Categorias, en arbol de dos niveles
-- -----------------------------------------------------------------------------

-- padre_id apunta a la propia tabla: Ramen -> con caldo / sin caldo.
-- icono es el marcador que se pinta en los platos de esta categoria sin foto.
create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  padre_id    uuid references public.categorias(id) on delete cascade,
  nombre      jsonb not null,
  descripcion jsonb not null default '{}'::jsonb,
  icono       text not null default 'generico',
  orden       int not null default 0,
  activa      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create index if not exists categorias_padre on public.categorias (padre_id, orden);

-- Dos niveles y no mas: una subcategoria no puede tener hijas.
create or replace function public.categoria_dos_niveles()
returns trigger
language plpgsql
as $$
begin
  if new.padre_id is not null then
    if new.padre_id = new.id then
      raise exception 'Una categoria no puede ser su propia madre.';
    end if;
    if exists (select 1 from public.categorias
               where id = new.padre_id and padre_id is not null) then
      raise exception 'El arbol de categorias solo admite dos niveles.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists categorias_dos_niveles on public.categorias;
create trigger categorias_dos_niveles
  before insert or update on public.categorias
  for each row execute function public.categoria_dos_niveles();

drop trigger if exists categorias_actualizado on public.categorias;
create trigger categorias_actualizado
  before update on public.categorias
  for each row execute function public.toca_actualizado();

-- -----------------------------------------------------------------------------
--  4 · Grupos de opciones, reutilizables entre platos
-- -----------------------------------------------------------------------------

-- "Extras del ramen", "Sabores del mochi", "Intensidad del caldo". Un grupo se
-- engancha a muchos platos: los nueve ramen comparten uno y se edita una vez.
create table if not exists public.grupos_opcion (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  nombre      jsonb not null,
  tipo        text not null default 'unica' check (tipo in ('unica', 'multiple')),
  obligatorio boolean not null default false,
  orden       int not null default 0,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create table if not exists public.opciones (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references public.grupos_opcion(id) on delete cascade,
  slug       text not null,
  nombre     jsonb not null,
  -- Lo que suma al precio del plato. 0 = no cuesta nada (Bajo/Medio/Alto).
  -- NULL = el precio esta sin confirmar y no se pinta.
  incremento numeric(6,2),
  orden      int not null default 0,
  unique (grupo_id, slug)
);

drop trigger if exists grupos_actualizado on public.grupos_opcion;
create trigger grupos_actualizado
  before update on public.grupos_opcion
  for each row execute function public.toca_actualizado();

-- -----------------------------------------------------------------------------
--  5 · Platos
-- -----------------------------------------------------------------------------

create table if not exists public.platos (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  numero       text,                                   -- el "1." de la carta
  categoria_id uuid not null references public.categorias(id) on delete restrict,
  nombre       jsonb not null,
  descripcion  jsonb not null default '{}'::jsonb,
  -- Ruta relativa dentro del repositorio, o NULL. Sin foto se pinta el marcador
  -- de su categoria: hoy no hay ni una foto de plato y la carta no espera por eso.
  imagen       text,
  nota         jsonb not null default '{}'::jsonb,     -- "por confirmar en el local"
  disponible   boolean not null default true,
  destacado    boolean not null default false,
  orden        int not null default 0,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now()
);

create index if not exists platos_categoria on public.platos (categoria_id, orden);

drop trigger if exists platos_actualizado on public.platos;
create trigger platos_actualizado
  before update on public.platos
  for each row execute function public.toca_actualizado();

-- Una fila = precio simple (etiqueta NULL). Varias = variantes con etiqueta:
-- "2 uds"/"4 uds", "Botella"/"Tokkuri"/"Chupito", "Copa"/"Botella". La carta
-- real las necesita, asi que el precio no puede ser una columna de platos.
-- precio NULL = el PDF no lo trae y no se inventa: se pinta "consultar".
create table if not exists public.plato_precios (
  id       uuid primary key default gen_random_uuid(),
  plato_id uuid not null references public.platos(id) on delete cascade,
  etiqueta jsonb,
  precio   numeric(6,2),
  orden    int not null default 0
);

create index if not exists precios_plato on public.plato_precios (plato_id, orden);

create table if not exists public.plato_alergenos (
  plato_id    uuid not null references public.platos(id) on delete cascade,
  alergeno_id smallint not null references public.alergenos(id) on delete restrict,
  grado       text not null default 'contiene' check (grado in ('contiene', 'trazas')),
  primary key (plato_id, alergeno_id)
);

create table if not exists public.plato_etiquetas (
  plato_id    uuid not null references public.platos(id) on delete cascade,
  etiqueta_id uuid not null references public.etiquetas(id) on delete cascade,
  primary key (plato_id, etiqueta_id)
);

create table if not exists public.plato_escalas (
  plato_id  uuid not null references public.platos(id) on delete cascade,
  escala_id uuid not null references public.escalas(id) on delete cascade,
  valor     smallint not null check (valor >= 0),
  primary key (plato_id, escala_id)
);

create table if not exists public.plato_grupos (
  plato_id uuid not null references public.platos(id) on delete cascade,
  grupo_id uuid not null references public.grupos_opcion(id) on delete cascade,
  orden    int not null default 0,
  primary key (plato_id, grupo_id)
);

-- -----------------------------------------------------------------------------
--  6 · Los vocabularios fijos NO se siembran aqui
-- -----------------------------------------------------------------------------

-- Los 14 alergenos, las etiquetas y las escalas viven en
-- tools/semilla/vocabularios.json y los carga tools/semilla-carta.mjs.
--
-- Estan alli y no aqui a proposito: este archivo define la ESTRUCTURA y el JSON
-- define el CONTENIDO. Tenerlos en los dos sitios seria dos fuentes de verdad
-- para el mismo dato, y la que se olvidara de actualizar mentiria en silencio.
-- Ademas el exportador los necesita en JavaScript para poder reconstruir la
-- carta sin Supabase (node tools/carta.mjs --desde-semilla).

-- -----------------------------------------------------------------------------
--  7 · La carta entera en una sola llamada
-- -----------------------------------------------------------------------------

-- Una llamada y no doce: la exportacion sale de una foto coherente, no de doce
-- consultas que podrian caer a caballo de una edicion.
create or replace function public.carta_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'generado', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'actualizado', (
      select to_char(max(t) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from (
        select max(actualizado) t from public.platos
        union all select max(actualizado) from public.categorias
        union all select max(actualizado) from public.grupos_opcion
      ) x
    ),
    'alergenos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', slug, 'nombre', nombre) order by orden), '[]'::jsonb)
      from public.alergenos
    ),
    'etiquetas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', slug, 'nombre', nombre, 'icono', icono) order by orden), '[]'::jsonb)
      from public.etiquetas
    ),
    'escalas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', slug, 'nombre', nombre, 'maximo', maximo, 'icono', icono) order by orden), '[]'::jsonb)
      from public.escalas
    ),
    'grupos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', g.slug, 'nombre', g.nombre, 'tipo', g.tipo,
        'obligatorio', g.obligatorio,
        'opciones', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'slug', o.slug, 'nombre', o.nombre, 'incremento', o.incremento)
            order by o.orden), '[]'::jsonb)
          from public.opciones o where o.grupo_id = g.id
        )) order by g.orden), '[]'::jsonb)
      from public.grupos_opcion g
    ),
    'categorias', (
      select coalesce(jsonb_agg(c order by c.orden), '[]'::jsonb) from (
        select jsonb_build_object(
          'slug', m.slug, 'nombre', m.nombre, 'descripcion', m.descripcion,
          'icono', m.icono,
          'hijas', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'slug', h.slug, 'nombre', h.nombre, 'descripcion', h.descripcion,
              'icono', h.icono) order by h.orden), '[]'::jsonb)
            from public.categorias h
            where h.padre_id = m.id and h.activa
          )
        ) c, m.orden
        from public.categorias m
        where m.padre_id is null and m.activa
      ) c
    ),
    'platos', (
      select coalesce(jsonb_agg(p order by p.corden, p.orden), '[]'::jsonb) from (
        select jsonb_build_object(
          'slug', pl.slug,
          'numero', pl.numero,
          'categoria', cat.slug,
          'categoria_madre', coalesce(mad.slug, cat.slug),
          'icono', coalesce(nullif(cat.icono, 'generico'), mad.icono, cat.icono),
          'nombre', pl.nombre,
          'descripcion', pl.descripcion,
          'imagen', pl.imagen,
          'nota', pl.nota,
          'destacado', pl.destacado,
          'precios', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'etiqueta', pr.etiqueta, 'precio', pr.precio) order by pr.orden), '[]'::jsonb)
            from public.plato_precios pr where pr.plato_id = pl.id
          ),
          'alergenos', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'slug', a.slug, 'grado', pa.grado) order by a.orden), '[]'::jsonb)
            from public.plato_alergenos pa
            join public.alergenos a on a.id = pa.alergeno_id
            where pa.plato_id = pl.id
          ),
          'etiquetas', (
            select coalesce(jsonb_agg(e.slug order by e.orden), '[]'::jsonb)
            from public.plato_etiquetas pe
            join public.etiquetas e on e.id = pe.etiqueta_id
            where pe.plato_id = pl.id
          ),
          'escalas', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'slug', es.slug, 'valor', pes.valor, 'maximo', es.maximo) order by es.orden), '[]'::jsonb)
            from public.plato_escalas pes
            join public.escalas es on es.id = pes.escala_id
            where pes.plato_id = pl.id
          ),
          -- Solo los slugs: la definicion de cada grupo va una sola vez en la
          -- raiz del documento. Repetirla en cada plato multiplicaba por nueve
          -- los siete extras del ramen.
          'grupos', (
            select coalesce(jsonb_agg(g.slug order by pg.orden), '[]'::jsonb)
            from public.plato_grupos pg
            join public.grupos_opcion g on g.id = pg.grupo_id
            where pg.plato_id = pl.id
          )
        ) p,
        coalesce(mad.orden, cat.orden) corden,
        pl.orden
        from public.platos pl
        join public.categorias cat on cat.id = pl.categoria_id
        left join public.categorias mad on mad.id = cat.padre_id
        where pl.disponible and cat.activa and (mad.id is null or mad.activa)
      ) p
    )
  );
$$;

-- -----------------------------------------------------------------------------
--  8 · RLS
-- -----------------------------------------------------------------------------

-- Todas con RLS y el rol anonimo SIN NINGUNA POLITICA: la web publica no lee
-- Supabase, asi que anon no necesita acceso a nada. Es mas simple y mas seguro
-- que abrir una lectura publica "por si acaso".
do $$
declare t text;
begin
  foreach t in array array[
    'perfiles','alergenos','etiquetas','escalas','categorias',
    'grupos_opcion','opciones','platos','plato_precios',
    'plato_alergenos','plato_etiquetas','plato_escalas','plato_grupos'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.es_admin()) with check (public.es_admin())',
      t || '_admin', t);
  end loop;
end $$;

-- Cada uno ve su propio perfil aunque no sea admin: sin esto, una cuenta recien
-- creada no puede ni saber que rol tiene y el panel no sabe que mensaje pintar.
drop policy if exists perfiles_propio on public.perfiles;
create policy perfiles_propio on public.perfiles
  for select to authenticated
  using (id = auth.uid());

-- -----------------------------------------------------------------------------
--  9 · Permisos de las funciones
-- -----------------------------------------------------------------------------

-- "revoke ... from public" NO QUITA NADA en el esquema public: Supabase concede
-- EXECUTE directo a anon y authenticated por privilegios por defecto, asi que
-- hay que revocar POR NOMBRE DE ROL. Se comprueba con has_function_privilege.
revoke execute on function public.carta_json()      from public, anon;
revoke execute on function public.alta_perfil()     from public, anon, authenticated;
revoke execute on function public.toca_actualizado() from public, anon, authenticated;
revoke execute on function public.categoria_dos_niveles() from public, anon, authenticated;

-- es_admin conserva el EXECUTE de authenticated a proposito: las politicas de
-- RLS se evaluan con los permisos de quien llama y sin el dejarian de resolver.
revoke execute on function public.es_admin() from public, anon;
grant  execute on function public.es_admin() to authenticated;

-- carta_json la llama la exportacion con la clave service_role, que salta RLS,
-- y el panel para la vista previa.
grant execute on function public.carta_json() to authenticated;
