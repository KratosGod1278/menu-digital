-- ============================================================
-- MENU DIGITAL — Ofertas por menú/negocio
-- Pegar completo en: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Nuevo modelo de ofertas:
--   - Las ofertas GENERALES (DJ, actividades semanales) tienen negocio_id = NULL
--     y se muestran en la galería inicial (al escanear el QR).
--   - Las ofertas POR MENÚ/NEGOCIO (ej: Asadero → comida) tienen negocio_id
--     asignado y se muestran dentro de la galería de ese negocio.
-- ------------------------------------------------------------

-- 1. Columna opcional "titulo" para etiquetar la oferta (ej: "Semana 8-14")
alter table ofertas add column if not exists titulo text;

-- 2. RLS: ofertas GENERALES (negocio_id IS NULL) editables por cualquier
--    usuario autenticado que tenga al menos un negocio asignado.
--    (La política existente "edicion_ofertas_autorizada" solo cubre ofertas
--     con negocio_id apuntando a un negocio del usuario, por lo que las
--     generales quedaban sin dueño y no se podían editar.)
create policy "edicion_ofertas_generales_autorizada" on ofertas
  for all using (
    ofertas.negocio_id is null
    and exists (
      select 1 from negocio_editores ne
      where ne.usuario_id = auth.uid()
    )
  )
  with check (
    ofertas.negocio_id is null
    and exists (
      select 1 from negocio_editores ne
      where ne.usuario_id = auth.uid()
    )
  );
