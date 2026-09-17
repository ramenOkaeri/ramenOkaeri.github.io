-- =============================================================================
--  Prueba de 0005_guardado.sql contra produccion, SIN DEJAR RASTRO
--
--  Todo va dentro de un bloque do que TERMINA LANZANDO UNA EXCEPCION a
--  proposito: la excepcion deshace la transaccion entera y su mensaje es el
--  informe. Es el metodo de las pruebas de 0002: no depende de que el editor
--  respete un begin ... rollback, y el mensaje se ve.
--
--  COMO SE LEE EL RESULTADO
--    Sale como ERROR, y eso es lo esperado. El texto empieza por PRUEBA 0005 y
--    cada linea dice ok o FALLO. Si sale un error que no empieza por PRUEBA
--    0005, la prueba se ha caido antes de terminar y ese error es el dato.
--
--  COMO SE HACE PASAR POR EL PANEL
--    Cambia al rol authenticated y rellena request.jwt.claims con el uuid de la
--    cuenta admin, que es lo que hace PostgREST con el JWT del panel. Asi se
--    prueban las funciones con la RLS puesta, igual que desde el navegador.
--    Las lecturas de comprobacion vuelven antes a postgres (reset role), que es
--    el dueno de las tablas: miden lo que hay, sin filtro de nadie.
-- =============================================================================

do $$
declare
  v_admin   uuid;
  v_otro    uuid := gen_random_uuid();
  v_plato   uuid;
  v_grupo   uuid;
  v_ficha   jsonb;
  v_antes   jsonb;
  v_ahora   jsonb;
  v_grupo_j jsonb;
  v_estado  text;
  v_msg     text;
  v_n       int;
  v_rev     timestamptz;
  informe   text := '';
begin
  -- ---------------------------------------------------------------------------
  -- 0 · Compatibilidad con el historial de 0002
  -- ---------------------------------------------------------------------------
  if public.carta_completa_json()->'platos'->0 ? 'alergenos_revisados' then
    informe := informe || E'\nok     la copia completa ya trae alergenos_revisados';
  else
    informe := informe || E'\nFALLO  la copia completa no trae alergenos_revisados';
  end if;

  -- Las copias guardadas ANTES de 0005 no traen la clave. Si la columna no
  -- admitiera nulos, esto es lo que romperia restaurar_publicacion().
  select count(*) into v_n
    from public.publicaciones p,
         lateral jsonb_populate_recordset(null::public.platos, p.datos->'platos') x
   where p.estado = 'publicada';
  informe := informe || format(E'\nok     las copias guardadas se siguen leyendo como platos (%s filas)', v_n);

  -- Foto de un plato: la fila (sin las dos marcas de tiempo) y sus cinco tablas.
  create or replace function pg_temp.estado_plato(p_id uuid)
  returns jsonb
  language sql
  stable
  as $f$
    select jsonb_build_object(
      'plato',     (select to_jsonb(x) - 'actualizado' - 'alergenos_revisados'
                      from public.platos x where x.id = p_id),
      'precios',   coalesce((select jsonb_agg(jsonb_build_object('etiqueta', etiqueta, 'precio', precio) order by orden)
                               from public.plato_precios where plato_id = p_id), '[]'::jsonb),
      'alergenos', coalesce((select jsonb_agg(jsonb_build_object('id', alergeno_id, 'grado', grado) order by alergeno_id)
                               from public.plato_alergenos where plato_id = p_id), '[]'::jsonb),
      'etiquetas', coalesce((select jsonb_agg(etiqueta_id order by etiqueta_id)
                               from public.plato_etiquetas where plato_id = p_id), '[]'::jsonb),
      'escalas',   coalesce((select jsonb_agg(jsonb_build_object('id', escala_id, 'valor', valor) order by escala_id)
                               from public.plato_escalas where plato_id = p_id), '[]'::jsonb),
      'grupos',    coalesce((select jsonb_agg(grupo_id order by orden)
                               from public.plato_grupos where plato_id = p_id), '[]'::jsonb))
  $f$;

  -- ---------------------------------------------------------------------------
  -- 1 · La cuenta admin y un plato real con precio y alergenos
  -- ---------------------------------------------------------------------------
  select id into v_admin from public.perfiles where rol = 'admin' order by creado limit 1;
  if v_admin is null then
    raise exception 'PRUEBA 0005 · no hay ninguna cuenta con rol admin en perfiles';
  end if;

  select pl.id into v_plato
    from public.platos pl
   where exists (select 1 from public.plato_precios pr where pr.plato_id = pl.id and pr.precio is not null)
     and exists (select 1 from public.plato_alergenos pa where pa.plato_id = pl.id)
   order by pl.orden, pl.slug
   limit 1;
  if v_plato is null then
    raise exception 'PRUEBA 0005 · no hay ningun plato con precio y alergenos para probar';
  end if;

  v_antes := pg_temp.estado_plato(v_plato);

  -- La ficha tal y como la manda el panel, con todos los precios un euro mas.
  select jsonb_build_object(
           'id', pl.id, 'slug', pl.slug, 'numero', pl.numero, 'categoria_id', pl.categoria_id,
           'nombre', pl.nombre, 'descripcion', pl.descripcion, 'nota', pl.nota, 'imagen', pl.imagen,
           'disponible', pl.disponible, 'orden', pl.orden,
           'precios', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', pr.etiqueta, 'precio', pr.precio + 1) order by pr.orden)
                                  from public.plato_precios pr where pr.plato_id = pl.id), '[]'::jsonb),
           'alergenos', v_antes->'alergenos',
           'etiquetas', v_antes->'etiquetas',
           'escalas',   v_antes->'escalas',
           'grupos',    v_antes->'grupos')
    into v_ficha
    from public.platos pl
   where pl.id = v_plato;

  -- ---------------------------------------------------------------------------
  -- 2 · guarda_plato cambia lo que se le pide y nada mas
  -- ---------------------------------------------------------------------------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  perform public.guarda_plato(v_ficha);

  execute 'reset role';
  v_ahora := pg_temp.estado_plato(v_plato);
  if v_ahora->'precios' = v_ficha->'precios'
     and v_ahora->'alergenos' = v_antes->'alergenos'
     and v_ahora->'etiquetas' = v_antes->'etiquetas'
     and v_ahora->'escalas'   = v_antes->'escalas'
     and v_ahora->'grupos'    = v_antes->'grupos'
     and v_ahora->'plato'     = v_antes->'plato' then
    informe := informe || E'\nok     guarda_plato sube los precios y deja igual todo lo demas';
  else
    informe := informe || format(E'\nFALLO  guarda_plato · antes %s · despues %s', v_antes, v_ahora);
  end if;

  -- ---------------------------------------------------------------------------
  -- 3 · Un fallo a mitad no deja el plato a medias
  -- ---------------------------------------------------------------------------
  -- Un alergeno que no existe (99) rompe la clave ajena DESPUES de que la
  -- funcion haya borrado y reescrito los precios. Si el guardado no fuera de una
  -- vez, el plato se quedaria sin alergenos.
  execute 'set local role authenticated';
  begin
    perform public.guarda_plato(jsonb_set(v_ficha, '{alergenos}',
      (v_ficha->'alergenos') || '[{"id": 99, "grado": "contiene"}]'::jsonb));
    v_estado := 'sin error';
  exception when others then
    v_estado := sqlstate;
  end;
  execute 'reset role';

  if v_estado = '23503' and pg_temp.estado_plato(v_plato) = v_ahora then
    informe := informe || E'\nok     un fallo a mitad (23503) deshace el guardado entero: el plato sigue igual';
  else
    informe := informe || format(E'\nFALLO  fallo a mitad · codigo %s · plato igual: %s',
                                 v_estado, pg_temp.estado_plato(v_plato) = v_ahora);
  end if;

  -- ---------------------------------------------------------------------------
  -- 4 · Sin precio no se guarda
  -- ---------------------------------------------------------------------------
  execute 'set local role authenticated';
  begin
    perform public.guarda_plato(jsonb_set(v_ficha, '{precios}', '[]'::jsonb));
    v_msg := 'sin error';
  exception when others then
    v_msg := sqlerrm;
  end;
  execute 'reset role';
  informe := informe || case when v_msg = 'sin_precio'
    then E'\nok     sin precio devuelve sin_precio'
    else format(E'\nFALLO  sin precio devolvio: %s', v_msg) end;

  -- ---------------------------------------------------------------------------
  -- 5 · Una cuenta que no es admin no guarda
  -- ---------------------------------------------------------------------------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_otro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  begin
    perform public.guarda_plato(v_ficha);
    v_msg := 'sin error';
  exception when others then
    v_msg := sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'reset role';
  informe := informe || case when v_msg = 'sin_permiso'
    then E'\nok     una cuenta sin rol admin recibe sin_permiso'
    else format(E'\nFALLO  una cuenta sin rol admin recibio: %s', v_msg) end;

  -- ---------------------------------------------------------------------------
  -- 6 · guarda_alergenos marca y desmarca sin tocar nada mas
  -- ---------------------------------------------------------------------------
  execute 'set local role authenticated';
  perform public.guarda_alergenos(v_plato, v_antes->'alergenos', true);
  execute 'reset role';
  select alergenos_revisados into v_rev from public.platos where id = v_plato;
  if v_rev is not null and pg_temp.estado_plato(v_plato) = v_ahora then
    informe := informe || E'\nok     guarda_alergenos marca el plato como revisado y no toca nada mas';
  else
    informe := informe || format(E'\nFALLO  guarda_alergenos (marcar) · revisado %s', v_rev);
  end if;

  execute 'set local role authenticated';
  perform public.guarda_alergenos(v_plato, v_antes->'alergenos', false);
  execute 'reset role';
  select alergenos_revisados into v_rev from public.platos where id = v_plato;
  informe := informe || case when v_rev is null
    then E'\nok     guarda_alergenos desmarca'
    else format(E'\nFALLO  guarda_alergenos (desmarcar) · revisado %s', v_rev) end;

  -- ---------------------------------------------------------------------------
  -- 7 · guarda_grupo con sus mismas opciones las deja igual
  -- ---------------------------------------------------------------------------
  select g.id into v_grupo
    from public.grupos_opcion g
   where exists (select 1 from public.opciones o where o.grupo_id = g.id)
   order by g.orden, g.slug
   limit 1;

  select jsonb_build_object(
           'id', g.id, 'slug', g.slug, 'nombre', g.nombre, 'tipo', g.tipo, 'orden', g.orden,
           'opciones', coalesce((select jsonb_agg(jsonb_build_object('slug', o.slug, 'nombre', o.nombre,
                                                                     'incremento', o.incremento) order by o.orden)
                                   from public.opciones o where o.grupo_id = g.id), '[]'::jsonb))
    into v_grupo_j
    from public.grupos_opcion g
   where g.id = v_grupo;

  execute 'set local role authenticated';
  perform public.guarda_grupo(v_grupo_j);
  execute 'reset role';

  select coalesce(jsonb_agg(jsonb_build_object('slug', o.slug, 'nombre', o.nombre,
                                               'incremento', o.incremento) order by o.orden), '[]'::jsonb)
    into v_ahora
    from public.opciones o
   where o.grupo_id = v_grupo;

  informe := informe || case when v_ahora = v_grupo_j->'opciones'
    then format(E'\nok     guarda_grupo reescribe las %s opciones de %s sin cambiar ninguna',
                jsonb_array_length(v_ahora), v_grupo_j->>'slug')
    else format(E'\nFALLO  guarda_grupo · antes %s · despues %s', v_grupo_j->'opciones', v_ahora) end;

  -- ---------------------------------------------------------------------------
  -- El final: la excepcion deshace TODO lo de arriba y ensena el informe
  -- ---------------------------------------------------------------------------
  raise exception E'PRUEBA 0005 · se deshace todo al terminar%', informe;
end;
$$;
