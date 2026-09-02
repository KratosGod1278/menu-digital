-- ============================================================
-- MENU DIGITAL — Migración 0004: precios + ocultar menús (mantenimiento)
-- Pegar completo en: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- 1) PRECIOS en productos
-- precio numeric(10,2) = precio en dólares (o la moneda que uses).
-- NULL = producto sin precio (no se muestra el precio).
alter table productos
  add column if not exists precio numeric(10,2);

-- 2) Ocultar menús en mantenimiento
-- activo = true  -> menú visible para el cliente
-- activo = false -> menú en mantenimiento (oculto para el cliente)
alter table menus
  add column if not exists activo boolean not null default true;

-- Por defecto todos los menús/productos existentes quedan activos.
-- Para ocultar un menú en mantenimiento:
--   update menus set activo = false where id = '<id-del-menu>';

-- 3) Política RLS: un editor autorizado puede cambiar 'activo' de sus menús
-- (sin esto, Supabase bloquearía el toggle en el backoffice)
create policy "edicion_menus_autorizada" on menus
  for update using (
    exists (
      select 1 from negocio_editores ne
      where ne.negocio_id = menus.negocio_id
        and ne.usuario_id = auth.uid()
    )
  );
