-- ============================================================
-- MENU DIGITAL — Aplicar TODO (puedes pegar todo a la vez)
-- 1) Precios en productos
-- 2) Ocultar menús (activo)
-- 3) Política RLS para toggle
-- 4) Dejar ACTIVOS solo ASADERO y REVOLTIAO (ocultar Bolelos, Malcriao, Voodoo)
-- ============================================================

-- 1) PRECIOS
alter table productos
  add column if not exists precio numeric(10,2);

-- 2) MENÚS ACTIVO
alter table menus
  add column if not exists activo boolean not null default true;

-- 3) POLÍTICA RLS (para que el backoffice pueda alternar activo)
drop policy if exists "edicion_menus_autorizada" on menus;
create policy "edicion_menus_autorizada" on menus
  for update using (
    exists (
      select 1 from negocio_editores ne
      where ne.negocio_id = menus.negocio_id
        and ne.usuario_id = auth.uid()
    )
  );

-- 4) ACTIVACIÓN POR NEGOCIO
-- Desactivar (ocultar) Bolelos, Malcriao y Voodoo
update menus set activo = false where negocio_id in (
  select id from negocios where slug in ('bolelos', 'malcreo', 'voodoo')
);

-- Activar (mostrar) Asadero y Revoltiao
update menus set activo = true where negocio_id in (
  select id from negocios where slug in ('asadero', 'revoltio')
);
