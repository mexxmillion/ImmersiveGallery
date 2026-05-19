create table if not exists users (
  id text primary key,
  email text not null unique,
  name text,
  role text not null default 'viewer' check (role in ('viewer', 'commenter', 'curator', 'admin')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists albums (
  id text primary key,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished', 'archived')),
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  cover_url text,
  sort_order integer not null default 0,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists scenes (
  id text primary key,
  album_id text not null references albums(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished', 'archived')),
  date text,
  thumbnail_url text,
  asset_url text,
  asset_key text,
  splat_count integer,
  sort_order integer not null default 0,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists album_permissions (
  album_id text not null references albums(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  permission text not null default 'view' check (permission in ('view', 'comment', 'manage')),
  created_at text not null default (datetime('now')),
  primary key (album_id, user_id)
);

create table if not exists comments (
  id text primary key,
  scene_id text not null references scenes(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  body text not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists likes (
  scene_id text not null references scenes(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at text not null default (datetime('now')),
  primary key (scene_id, user_id)
);

create index if not exists idx_scenes_album on scenes(album_id, sort_order);
create index if not exists idx_permissions_user on album_permissions(user_id);
create index if not exists idx_comments_scene on comments(scene_id, created_at);
