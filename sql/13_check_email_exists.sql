-- 13_check_email_exists.sql: RPC function to check if an email or phone is already registered in AquaRun
-- Run this in your Supabase SQL Editor so the signup page can verify availability in real-time.

create or replace function public.check_email_exists(email_to_check text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if email_to_check is null or trim(email_to_check) = '' then
    return false;
  end if;
  return exists (
    select 1 from auth.users
    where lower(trim(email)) = lower(trim(email_to_check))
  );
end;
$$;

grant execute on function public.check_email_exists(text) to anon, authenticated;

-- Optional: Real-time mobile number check
create or replace function public.check_phone_exists(phone_to_check text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  clean_phone text;
begin
  if phone_to_check is null or trim(phone_to_check) = '' then
    return false;
  end if;
  -- Extract digits
  clean_phone := regexp_replace(phone_to_check, '[^\d]', '', 'g');
  if clean_phone like '639%' then
    clean_phone := '0' || substring(clean_phone from 3);
  end if;

  return exists (
    select 1 from public.profiles
    where phone = clean_phone
  ) or exists (
    select 1 from auth.users
    where phone = clean_phone or phone = '+63' || substring(clean_phone from 2)
  );
end;
$$;

grant execute on function public.check_phone_exists(text) to anon, authenticated;
