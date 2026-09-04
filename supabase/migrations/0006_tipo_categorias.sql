-- ============================================================
-- MENU DIGITAL — Categorías con tipo (comida / trago)
-- 1) Tipo en categorías (para que el frontend separe comida de tragos)
-- 2) Tipo en negocios (para saber qué muestra cada negocio)
-- 3) Datos: Asadero -> comida, Revoltiao -> tragos
-- ============================================================

-- 1) TIPO EN CATEGORÍAS
alter table categorias
  add column if not exists tipo text;

-- 2) TIPO EN NEGOCIOS (comida | trago | mixto | null)
alter table negocios
  add column if not exists tipo text;

-- 3) TIPIFICAR NEGOCIOS EXISTENTES
update negocios set tipo = 'comida' where slug in ('asadero');
update negocios set tipo = 'trago'  where slug in ('revoltiao', 'revoltio');

-- 4) Tipificar categorías existentes por heurística de nombre
update categorias set tipo = 'trago' where
  lower(nombre) like '%trago%' or lower(nombre) like '%bebida%'
  or lower(nombre) like '%licor%' or lower(nombre) like '%bar%'
  or lower(nombre) like '%coctel%' or lower(nombre) like '%cocktail%'
  or lower(nombre) like '%cerveza%' or lower(nombre) like '%whiskey%'
  or lower(nombre) like '%ron%'
  and tipo is null;
