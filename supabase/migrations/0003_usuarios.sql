-- ============================================================
-- 0003 — Tabla de usuarios (perfil + roles)
-- ============================================================

-- Perfil de usuario: se vincula a auth.users via id
create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'editor',   -- 'admin' o 'editor'
  created_at timestamptz default now()
);

alter table usuarios enable row level security;

-- Cada usuario puede ver su propio perfil
create policy "ver_mi_perfil" on usuarios
  for select using (id = auth.uid());

-- Solo admins pueden ver todos los usuarios
create policy "admin_ve_todos_los_usuarios" on usuarios
  for select using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );

-- Solo admins pueden insertar usuarios
create policy "admin_crea_usuarios" on usuarios
  for insert with check (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );

-- Solo admins pueden actualizar usuarios
create policy "admin_edita_usuarios" on usuarios
  for update using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );

-- Solo admins pueden eliminar usuarios
create policy "admin_elimina_usuarios" on usuarios
  for delete using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );

-- Auto-insertar email al crear usuario en auth.users
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.usuarios (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
