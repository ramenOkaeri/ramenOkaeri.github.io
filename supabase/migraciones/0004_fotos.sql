-- =============================================================================
--  El buzon de las fotos de plato  ·  esquema 0004
--  Proyecto Supabase: ymlswznlfmmjrxxisgva
--  Se aplica DESPUES de 0003_buzon.sql. Idempotente: se puede repegar.
--
--  POR QUE UN BUCKET NUEVO Y NO EL DE SIEMPRE
--    `buzon` tiene allowed_mime_types = {application/pdf}: storage-api rechaza
--    cualquier otra cosa antes de escribir un byte, y eso esta bien porque es
--    justo lo que protege al buzon del PDF de recibir basura. Ensancharlo para
--    que admita imagenes seria quitarle esa proteccion a los dos. Un bucket por
--    clase de correo.
--
--  POR QUE LA FOTO NO SE SIRVE DESDE AQUI
--    Porque la carta publica no le pide nada a nadie de fuera del dominio: sin
--    cookies, sin banner y sin depender de que Supabase este en pie. Igual que
--    el PDF, la foto solo PASA por aqui: el flujo de GitHub la baja con la
--    service_role, la commitea en assets/img/platos/ y vacia el buzon. Lo que
--    ve el visitante lo sirve GitHub Pages detras de Cloudflare.
--
--  EL TOPE DE TAMANO
--    El panel no sube la foto del movil tal cual: la recorta a un cuadrado de
--    192 px y la vuelve a comprimir en JPEG antes de subirla, asi que lo que
--    llega son unos 15 KB. Un mega es sesenta veces eso: sobra para cualquier
--    foto y corta en seco una subida que venga sin pasar por el recorte.
--    Y el motivo de fondo es el mismo que en el PDF: cada version se queda en la
--    historia de git PARA SIEMPRE y ese espacio no se recupera.
--
--  SOLO JPEG
--    El recorte del panel siempre saca JPEG. Aceptar image/* aqui seria abrir la
--    puerta a un SVG, que es un documento con script dentro, no una foto.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 1048576, array['image/jpeg'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Misma politica y mismo molde que buzon_admin en 0003: es_admin() es security
-- definer y conserva su EXECUTE para authenticated, asi que resuelve igual aqui.
-- RLS ya viene activada en storage.objects de fabrica: no se toca.
--
-- Va dentro de un do con captura de insufficient_privilege por lo mismo que
-- 0003: si el rol del editor de SQL no es dueno de storage.objects, este archivo
-- AVISA y termina bien en vez de abortar a media hoja.
do $$
begin
  drop policy if exists fotos_admin on storage.objects;
  create policy fotos_admin on storage.objects
    for all to authenticated
    using      (bucket_id = 'fotos' and public.es_admin())
    with check (bucket_id = 'fotos' and public.es_admin());
  raise notice 'politica fotos_admin lista';
exception when insufficient_privilege then
  raise notice 'SIN PERMISO para tocar storage.objects desde SQL. Crea la politica a mano: Storage > Policies > New policy on objects, para el rol authenticated, todas las operaciones, con la condicion   bucket_id = ''fotos'' and public.es_admin()';
end $$;
