-- DTR Automation Schema for Supabase PostgreSQL
-- Run this file first in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists employees (
  id bigserial primary key,
  first_name text not null,
  second_name text,
  last_name text not null,
  extension text,
  employee_password_hash text,
  name text not null,
  category text not null check (category in ('regular', 'jo')),
  created_at timestamptz not null default now()
);

create unique index if not exists employees_name_category_uq on employees (name, category);

create table if not exists schedule_settings (
  id bigserial primary key,
  date date not null unique,
  schedule_type text not null default 'A' check (schedule_type in ('A', 'B')),
  late_threshold time not null default '08:00',
  created_at timestamptz not null default now()
);

alter table if exists schedule_settings
  add column if not exists schedule_type text not null default 'A';

create table if not exists attendance (
  id bigserial primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  date date not null,
  time_in text,
  time_out text,
  late_minutes integer not null default 0,
  undertime_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  leave_type text check (leave_type in ('SL', 'VL', 'OB') or leave_type is null),
  schedule_type text not null default 'A' check (schedule_type in ('A', 'B')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists attendance_date_idx on attendance (date);
create index if not exists attendance_employee_idx on attendance (employee_id);

create table if not exists notifications (
  id bigserial primary key,
  message text not null,
  audience text not null default 'all',
  created_at timestamptz not null default now()
);

create table if not exists backup_logs (
  id bigserial primary key,
  filename text not null unique,
  source text not null,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function delete_employee_with_attendance(target_employee_id bigint)
returns void
language plpgsql
as $$
begin
  delete from attendance where employee_id = target_employee_id;
  delete from employees where id = target_employee_id;
end;
$$;

drop trigger if exists attendance_set_updated_at on attendance;
create trigger attendance_set_updated_at
before update on attendance
for each row
execute function set_updated_at();

-- Table to store allowed auth emails for frontend/backend OTP gating
create table if not exists auth_allowed_emails (
  id bigserial primary key,
  email text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into auth_allowed_emails (email) values
('tesda.mpltp.tapat@gmail.com'),
('mssabatin@tesda.gov.ph')
on conflict do nothing;

-- Optional: enable row-level security and allow public select of enabled rows.
-- If you want frontends to query this table directly (anon role), keep the policy.
-- Otherwise, fetch via backend using the service role key.
alter table if exists auth_allowed_emails enable row level security;
drop policy if exists "allow_public_select_enabled" on auth_allowed_emails;
create policy "allow_public_select_enabled" on auth_allowed_emails
  for select using (enabled);

-- Table to store OTP tokens for email-based OTP login
create table if not exists otp_tokens (
  id bigserial primary key,
  email text not null,
  otp_code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used boolean not null default false
);

create index if not exists otp_tokens_email_idx on otp_tokens (email);
create index if not exists otp_tokens_expires_at_idx on otp_tokens (expires_at);

-- Restore Supabase role access after wiping and recreating the public schema.
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
