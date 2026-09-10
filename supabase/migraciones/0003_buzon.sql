-- =============================================================================
--  El buzon del PDF  ·  esquema 0003
--  Proyecto Supabase: ymlswznlfmmjrxxisgva
--  Se aplica DESPUES de 0001_carta.sql. Idempotente: se puede repegar.
--
--  POR QUE UN BUZON Y NO UN ALMACEN
--    assets/pdf/menu.pdf pesa 2.279.927 bytes y el client_payload de un
--    repository_dispatch tiene un tope de unos 64 KB, asi que el PDF no puede
--    viajar por el mismo cable que el aviso de publicar. Sube al buzon desde el
--    panel, y el flujo de GitHub lo baja con la service_role, lo commitea y
--    VACIA EL BUZON. Un buzon que se queda el correo hace que cada publicacion
--    se baje 2,2 MB para nada y que nunca se sepa si hay algo esperando.
--
--  EL PDF QUE SE SIRVE EN LA WEB NO ESTA AQUI.
--    Esta en el repositorio, en assets/pdf/menu.pdf, servido por GitHub Pages
--    detras de Cloudflare. Esto es solo el sitio donde se deja mientras espera.
--
--  POR QUE VA EN SU PROPIO ARCHIVO Y NO DENTRO DE 0001
--    Porque el bloque de abajo es el unico de todo el esquema que puede fallar
--    por permisos: en algunos proyectos el rol del editor de SQL no es dueno de
--    storage.objects. Un create policy que aborte a media hoja dejaria el
--    esquema de la carta a medias en un proyecto nuevo.
-- =============================================================================

-- Privado (public = false): sin bucket publico y sin politica para anon, nadie
-- sin sesion de administrador puede ni listar ni descargar.
--
-- EL TOPE DE TAMANO ES LO QUE DE VERDAD PARA UN PDF DE 40 MB: storage-api
-- responde 413 antes de escribir un byte. La comprobacion del panel es para que
-- el mensaje salga en espanol y al instante, no para proteger nada.
-- Doce megas y no mas porque el PDF acaba en git PARA SIEMPRE: cada version se
-- queda en la historia del repositorio y ese espacio no se recupera.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('buzon', 'buzon', false, 12582912, array['application/pdf'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- La politica reutiliza es_admin(), el mismo molde que el bloque de RLS de
-- 0001, seccion 8. es_admin() es security definer y conserva su EXECUTE para
-- authenticated a proposito, asi que aqui resuelve igual que en las otras trece.
--
-- RLS ya viene activada en storage.objects de fabrica: no se toca.
--
-- Va dentro de un do con captura de insufficient_privilege para que, si el rol
-- del editor no puede tocar storage.objects, este archivo AVISE y termine bien
-- en vez de abortar.
do $$
begin
  drop policy if exists buzon_admin on storage.objects;
  create policy buzon_admin on storage.objects
    for all to authenticated
    using      (bucket_id = 'buzon' and public.es_admin())
    with check (bucket_id = 'buzon' and public.es_admin());
  raise notice 'politica buzon_admin lista';
exception when insufficient_privilege then
  raise notice 'SIN PERMISO para tocar storage.objects desde SQL. Crea la politica a mano: Storage > Policies > New policy on objects, para el rol authenticated, todas las operaciones, con la condicion   bucket_id = ''buzon'' and public.es_admin()';
end $$;
