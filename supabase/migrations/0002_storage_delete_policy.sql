-- ============================================================
-- MIGRACIÓN 0002: Política DELETE en Storage para imágenes
-- Aplicar en: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Permitir a usuarios autenticados eliminar imágenes del bucket
-- (necesario para reemplazar imágenes de productos desde el backoffice)
create policy "borrado_autenticado_imagenes" on storage.objects
  for delete using (bucket_id = 'menu-imagenes' and auth.role() = 'authenticated');
