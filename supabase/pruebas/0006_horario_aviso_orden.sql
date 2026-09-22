-- =============================================================================
--  Prueba de 0006_horario_aviso_orden.sql contra produccion, SIN DEJAR RASTRO
--
--  El mismo metodo que la prueba de 0005: un bloque do que TERMINA LANZANDO
--  UNA EXCEPCION a proposito. La excepcion deshace todo y su mensaje es el
--  informe. Sale como ERROR y eso es lo esperado: el texto empieza por
--  PRUEBA 0006 y cada linea dice ok o FALLO. Si sale un error que no empieza
--  por PRUEBA 0006, la prueba se ha caido antes de terminar y ese es el dato.
--
--  Se hace pasar por el panel igual que la de 0005: rol authenticated y
--  request.jwt.claims con el uuid de la cuenta admin.
--
--  LOS CASOS SE FABRICAN ANTES DE MEDIRLOS. Un horario que ya fuera valido no
--  demuestra que la validacion rechace nada.
-- =============================================================================

do $$
declare
  v_admin   uuid;
  v_otro    uuid := gen_random_uuid();
  v_bueno   jsonb := '{
    "lunes":     [["13:00","16:00"],["19:30","23:30"]],
    "martes":    [["13:00","23:30"]],
    "miercoles": [],
    "jueves":    [["19:30","24:00"],["13:00","16:00"]],
    "viernes":   [["13:00","16:30"],["19:30","23:30"]],
    "sabado":    [["13:00","16:30"],["19:30","23:30"]],
    "domingo":   [["13:00","16:30"],["19:30","23:30"]]
  }'::jsonb;
  v_malo    jsonb;
  v_msg     text;
  v_det     text;
  v_res     jsonb;
  v_grupo   uuid;
  v_gj      jsonb;
  v_ob      boolean;
  v_cat     uuid;
  v_ids     uuid[];
  v_ahora   uuid[];
  v_n       int;
  informe   text := '';
  caso      record;
begin
  select id into v_admin from public.perfiles where rol = 'admin' order by creado limit 1;
  if v_admin is null then
    raise exception 'PRUEBA 0006 · no hay ninguna cuenta con rol admin en perfiles';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------------
  -- 1 · Un horario valido se guarda, ordenado, y 24:00 vale como medianoche
  -- ---------------------------------------------------------------------------
  v_res := public.guarda_horario(v_bueno);
  if v_res->'jueves' = '[["13:00","16:00"],["19:30","24:00"]]'::jsonb
     and v_res->'miercoles' = '[]'::jsonb
     and v_res->'martes' = '[["13:00","23:30"]]'::jsonb then
    informe := informe || E'\nok     un horario valido se guarda, con los turnos ordenados y el cierre a las 24:00';
  else
    informe := informe || format(E'\nFALLO  horario valido · devolvio %s', v_res);
  end if;

  -- ---------------------------------------------------------------------------
  -- 2 · Los cinco horarios imposibles se rechazan y no tocan nada
  -- ---------------------------------------------------------------------------
  for caso in
    select * from (values
      ('se solapan',        jsonb_set(v_bueno, '{lunes}', '[["13:00","16:00"],["15:30","23:30"]]')),
      ('cierra antes',      jsonb_set(v_bueno, '{lunes}', '[["16:00","13:00"]]')),
      ('25:00',             jsonb_set(v_bueno, '{lunes}', '[["13:00","25:00"]]')),
      ('cuatro turnos',     jsonb_set(v_bueno, '{lunes}', '[["09:00","10:00"],["11:00","12:00"],["13:00","14:00"],["15:00","16:00"]]')),
      ('falta el domingo',  v_bueno - 'domingo')
    ) as t(nombre, h)
  loop
    begin
      perform public.guarda_horario(caso.h);
      v_msg := 'sin error';
    exception when others then
      get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    end;
    informe := informe || case when v_msg = 'horario_invalido'
      then format(E'\nok     %s → horario_invalido (%s)', caso.nombre, v_det)
      else format(E'\nFALLO  %s → %s', caso.nombre, v_msg) end;
  end loop;

  if public.sitio_json()->'horario' = v_res then
    informe := informe || E'\nok     los rechazos no han cambiado el horario guardado';
  else
    informe := informe || E'\nFALLO  un rechazo ha dejado el horario cambiado';
  end if;

  -- ---------------------------------------------------------------------------
  -- 3 · Una cuenta que no es admin no guarda horario ni ordena
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_otro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  begin
    perform public.guarda_horario(v_bueno);
    v_msg := 'sin error';
  exception when others then v_msg := sqlerrm; end;
  begin
    perform public.ordena('platos', array[gen_random_uuid()]);
    v_det := 'sin error';
  exception when others then v_det := sqlerrm; end;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  informe := informe || case when v_msg = 'sin_permiso' and v_det = 'sin_permiso'
    then E'\nok     una cuenta sin rol admin recibe sin_permiso en guarda_horario y en ordena'
    else format(E'\nFALLO  sin rol admin · guarda_horario %s · ordena %s', v_msg, v_det) end;

  -- ---------------------------------------------------------------------------
  -- 4 · guarda_grupo guarda «obligatorio», y lo conserva si no viene
  -- ---------------------------------------------------------------------------
  select g.id into v_grupo from public.grupos_opcion g order by g.orden, g.slug limit 1;
  select jsonb_build_object(
           'id', g.id, 'slug', g.slug, 'nombre', g.nombre, 'tipo', g.tipo, 'orden', g.orden,
           'opciones', coalesce((select jsonb_agg(jsonb_build_object('slug', o.slug, 'nombre', o.nombre,
                                                                     'incremento', o.incremento) order by o.orden)
                                   from public.opciones o where o.grupo_id = g.id), '[]'::jsonb))
    into v_gj
    from public.grupos_opcion g where g.id = v_grupo;

  perform public.guarda_grupo(v_gj || '{"obligatorio": true}'::jsonb);
  execute 'reset role';
  select obligatorio into v_ob from public.grupos_opcion where id = v_grupo;
  execute 'set local role authenticated';
  informe := informe || case when v_ob
    then format(E'\nok     guarda_grupo marca %s como obligatorio', v_gj->>'slug')
    else E'\nFALLO  guarda_grupo no ha guardado obligatorio = true' end;

  -- Sin la clave (un panel viejo en la cache de alguien): no se apaga.
  perform public.guarda_grupo(v_gj);
  execute 'reset role';
  select obligatorio into v_ob from public.grupos_opcion where id = v_grupo;
  execute 'set local role authenticated';
  informe := informe || case when v_ob
    then E'\nok     sin la clave «obligatorio», guarda_grupo conserva el valor'
    else E'\nFALLO  sin la clave «obligatorio», guarda_grupo lo ha apagado' end;

  -- ---------------------------------------------------------------------------
  -- 5 · ordena reordena de verdad y rechaza una tabla fuera de la lista
  -- ---------------------------------------------------------------------------
  -- La categoria con mas platos, para que el orden al reves sea distinto.
  select categoria_id into v_cat from public.platos
   group by categoria_id order by count(*) desc limit 1;
  select array_agg(id order by orden desc, slug desc) into v_ids
    from public.platos where categoria_id = v_cat;

  v_n := public.ordena('platos', v_ids);
  execute 'reset role';
  select array_agg(id order by orden) into v_ahora from public.platos where categoria_id = v_cat;
  execute 'set local role authenticated';
  informe := informe || case when v_ahora = v_ids
    then format(E'\nok     ordena pone al reves los %s platos de una seccion (%s filas tocadas)', cardinality(v_ids), v_n)
    else format(E'\nFALLO  ordena · esperado %s · quedo %s', v_ids, v_ahora) end;

  begin
    perform public.ordena('perfiles', array[v_admin]);
    v_msg := 'sin error';
  exception when others then v_msg := sqlerrm; end;
  informe := informe || case when v_msg = 'tabla_no_valida'
    then E'\nok     ordena rechaza una tabla fuera de la lista (perfiles → tabla_no_valida)'
    else format(E'\nFALLO  ordena sobre perfiles devolvio: %s', v_msg) end;

  -- ---------------------------------------------------------------------------
  -- 6 · El aviso se escribe con la RLS puesta y sitio_json lo devuelve
  -- ---------------------------------------------------------------------------
  update public.aviso set activo = true, texto = '{"es":"Prueba"}', hasta = date '2030-01-31' where id;
  v_res := public.sitio_json()->'aviso';
  informe := informe || case when v_res = '{"activo": true, "texto": {"es": "Prueba"}, "hasta": "2030-01-31"}'::jsonb
    then E'\nok     el aviso se guarda desde el panel y sitio_json lo devuelve con la fecha en texto'
    else format(E'\nFALLO  aviso · sitio_json devolvio %s', v_res) end;

  execute 'reset role';

  -- ---------------------------------------------------------------------------
  -- El final: la excepcion deshace TODO lo de arriba y ensena el informe
  -- ---------------------------------------------------------------------------
  raise exception E'PRUEBA 0006 · se deshace todo al terminar%', informe;
end $$;
