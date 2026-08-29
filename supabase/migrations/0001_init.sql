-- ============================================================
-- MENU DIGITAL — Esquema inicial para Supabase
-- Pegar completo en: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLAS
-- ------------------------------------------------------------

-- Negocios (ej: SQ1)
create table negocios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text unique not null,        -- usado en la URL del QR, ej: /menu/sq1
  created_at timestamptz default now()
);

-- Menús por negocio (un negocio puede tener varios: almuerzo, cena, bebidas, etc.)
create table menus (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  orden int default 0,
  created_at timestamptz default now()
);

-- Categorías dentro de un menú (ej: "Entradas", "Verdugo · Entradas & Bebidas")
-- Esto reemplaza los "grupos" que hoy están hardcodeados en el array DATA
create table categorias (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references menus(id) on delete cascade,
  nombre text not null,
  orden int default 0
);

-- Productos/platos
create table productos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references categorias(id) on delete cascade,
  nombre text not null,
  descripcion text,
  imagen_url text,
  disponible boolean not null default true,
  orden int default 0,
  updated_at timestamptz default now()
);

-- Ofertas (galería inicial que ve el usuario al escanear el QR)
create table ofertas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid references negocios(id) on delete cascade,
  imagen_url text not null,
  activa boolean default true,
  orden int default 0,
  created_at timestamptz default now()
);

-- Relación: qué usuario puede editar qué negocio
-- (usa auth.users de Supabase Auth, no se crea tabla de usuarios propia)
create table negocio_editores (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  negocio_id uuid not null references negocios(id) on delete cascade,
  primary key (usuario_id, negocio_id)
);

-- ------------------------------------------------------------
-- 2. TRIGGER: actualizar updated_at automáticamente en productos
-- ------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_productos_updated_at
before update on productos
for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------

alter table negocios enable row level security;
alter table menus enable row level security;
alter table categorias enable row level security;
alter table productos enable row level security;
alter table ofertas enable row level security;
alter table negocio_editores enable row level security;

-- --- Lectura pública (cualquiera puede ver el menú sin login) ---

create policy "lectura_publica_negocios" on negocios
  for select using (true);

create policy "lectura_publica_menus" on menus
  for select using (true);

create policy "lectura_publica_categorias" on categorias
  for select using (true);

create policy "lectura_publica_productos" on productos
  for select using (true);

create policy "lectura_publica_ofertas" on ofertas
  for select using (true);

-- --- Escritura: solo usuarios autenticados y autorizados para ese negocio ---

-- Productos: el usuario debe estar en negocio_editores del negocio dueño de la categoría/menú
create policy "edicion_productos_autorizada" on productos
  for update using (
    exists (
      select 1
      from categorias c
      join menus m on m.id = c.menu_id
      join negocio_editores ne on ne.negocio_id = m.negocio_id
      where c.id = productos.categoria_id
        and ne.usuario_id = auth.uid()
    )
  );

create policy "insercion_productos_autorizada" on productos
  for insert with check (
    exists (
      select 1
      from categorias c
      join menus m on m.id = c.menu_id
      join negocio_editores ne on ne.negocio_id = m.negocio_id
      where c.id = productos.categoria_id
        and ne.usuario_id = auth.uid()
    )
  );

create policy "borrado_productos_autorizado" on productos
  for delete using (
    exists (
      select 1
      from categorias c
      join menus m on m.id = c.menu_id
      join negocio_editores ne on ne.negocio_id = m.negocio_id
      where c.id = productos.categoria_id
        and ne.usuario_id = auth.uid()
    )
  );

-- Ofertas: el usuario debe estar en negocio_editores del negocio dueño de la oferta
create policy "edicion_ofertas_autorizada" on ofertas
  for all using (
    exists (
      select 1 from negocio_editores ne
      where ne.negocio_id = ofertas.negocio_id
        and ne.usuario_id = auth.uid()
    )
  );

-- negocio_editores: cada usuario solo puede ver sus propias asignaciones
create policy "ver_propias_asignaciones" on negocio_editores
  for select using (usuario_id = auth.uid());

-- ------------------------------------------------------------
-- 4. STORAGE: bucket público para imágenes
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('menu-imagenes', 'menu-imagenes', true)
on conflict (id) do nothing;

-- Lectura pública de imágenes
create policy "lectura_publica_imagenes" on storage.objects
  for select using (bucket_id = 'menu-imagenes');

-- Solo usuarios autenticados pueden subir/editar imágenes
create policy "subida_autenticada_imagenes" on storage.objects
  for insert with check (bucket_id = 'menu-imagenes' and auth.role() = 'authenticated');

create policy "actualizacion_autenticada_imagenes" on storage.objects
  for update using (bucket_id = 'menu-imagenes' and auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 5. DATOS DE EJEMPLO (opcional)
-- ------------------------------------------------------------

insert into negocios (nombre, slug) values ('SQ1', 'sq1');

insert into menus (negocio_id, nombre)
select id, 'Menú principal' from negocios where slug = 'sq1';

insert into categorias (menu_id, nombre, orden)
select m.id, 'Verdugo · Entradas & Bebidas', 1
from menus m
join negocios n on n.id = m.negocio_id
where n.slug = 'sq1';
