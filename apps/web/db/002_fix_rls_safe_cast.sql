-- Fix RLS policies so that queries that only set `app.user_email`
-- (e.g. during registration login-lookup) do not fail due to
-- casting a NULL `app.user_id` into UUID.

BEGIN;

-- users isolation: only apply when app.user_id is set
DROP POLICY IF EXISTS users_isolation ON public.users;
CREATE POLICY users_isolation
ON public.users
FOR ALL
USING (
  CASE
    WHEN current_setting('app.user_id', true) IS NULL THEN FALSE
    ELSE id = current_setting('app.user_id', true)::uuid
  END
)
WITH CHECK (
  CASE
    WHEN current_setting('app.user_id', true) IS NULL THEN FALSE
    ELSE id = current_setting('app.user_id', true)::uuid
  END
);

-- profiles isolation: only apply when app.user_id is set
DROP POLICY IF EXISTS profiles_isolation ON public.profiles;
CREATE POLICY profiles_isolation
ON public.profiles
FOR ALL
USING (
  CASE
    WHEN current_setting('app.user_id', true) IS NULL THEN FALSE
    ELSE id = current_setting('app.user_id', true)::uuid
  END
)
WITH CHECK (
  CASE
    WHEN current_setting('app.user_id', true) IS NULL THEN FALSE
    ELSE id = current_setting('app.user_id', true)::uuid
  END
);

COMMIT;

