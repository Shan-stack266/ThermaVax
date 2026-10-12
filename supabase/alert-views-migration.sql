-- Tracks which active alerts each authenticated user has already viewed.
create table if not exists public.alert_views (
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create index if not exists idx_alert_views_user
  on public.alert_views(user_id, viewed_at desc);

alter table public.alert_views enable row level security;

grant select, insert, update on public.alert_views to authenticated;
grant all on public.alert_views to service_role;

drop policy if exists alert_views_select on public.alert_views;
create policy alert_views_select on public.alert_views for select to authenticated
using ((select private.is_active_user()) and user_id = (select auth.uid()));

drop policy if exists alert_views_insert on public.alert_views;
create policy alert_views_insert on public.alert_views for insert to authenticated
with check ((select private.is_active_user()) and user_id = (select auth.uid()));

drop policy if exists alert_views_update on public.alert_views;
create policy alert_views_update on public.alert_views for update to authenticated
using ((select private.is_active_user()) and user_id = (select auth.uid()))
with check ((select private.is_active_user()) and user_id = (select auth.uid()));
