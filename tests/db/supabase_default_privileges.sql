-- Supabase platform default privileges for objects that postgres creates in
-- schema public: EXECUTE on new functions and ALL on new tables/sequences
-- for anon, authenticated and service_role. (Corroborated by the production
-- ACL of log_admin_action, which carries exactly those three grants.)
--
-- Loaded AFTER the base fixtures and BEFORE the repository migrations, so
-- every function or table a migration creates starts with the same
-- permissive grants it would get in production, and the tests prove each
-- migration revokes what it must (see tests/db/suites/permissions_*.sql).
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
