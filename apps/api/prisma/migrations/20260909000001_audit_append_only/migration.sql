-- modex:audit-append-only-migration
-- Append-only audit (Phase 0 section 3.3).
--
-- Prisma's schema cannot express "no update, no delete", so the guarantee is
-- installed here. Two layers, because either alone is escapable:
--
--   1. A trigger that raises on UPDATE or DELETE. This holds even for the
--      table owner and even inside a superuser session.
--   2. Revoked UPDATE/DELETE grants on the application role, so an accidental
--      ORM call fails at permission-check time with a clear error rather than
--      reaching the trigger.
--
-- Dropping the trigger is itself a schema change, which means it shows up in
-- migration review.

CREATE OR REPLACE FUNCTION audit_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_events is append-only: % is not permitted (attempted on row %)',
    TG_OP,
    COALESCE(OLD.id::text, '(unknown)')
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- TRUNCATE bypasses row triggers entirely, so it needs its own statement trigger.
DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();

-- The runtime role gets INSERT and SELECT and nothing else. `modex_app` is
-- created by infra; the DO block keeps local development working where it is not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'modex_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM modex_app;
    GRANT INSERT, SELECT ON audit_events TO modex_app;
  END IF;
END
$$;
