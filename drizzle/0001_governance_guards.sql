-- Immutable audit trail.
--
-- Enforced in the database rather than the application: even a compromised API
-- process, a psql session, or a future developer writing a "quick cleanup"
-- script cannot rewrite history. Only INSERT is permitted.
CREATE OR REPLACE FUNCTION audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
-- Keep updated_at honest without relying on every code path remembering it.
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS banks_touch_updated_at ON banks;
--> statement-breakpoint
CREATE TRIGGER banks_touch_updated_at
  BEFORE UPDATE ON banks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS customers_touch_updated_at ON customers;
--> statement-breakpoint
CREATE TRIGGER customers_touch_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
--> statement-breakpoint
CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS roles_touch_updated_at ON roles;
--> statement-breakpoint
CREATE TRIGGER roles_touch_updated_at
  BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS teams_touch_updated_at ON teams;
--> statement-breakpoint
CREATE TRIGGER teams_touch_updated_at
  BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
-- The protected system role can never be deleted or have its stable key
-- rewritten, regardless of what the API layer allows.
CREATE OR REPLACE FUNCTION protect_system_roles()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'System role "%" cannot be deleted', OLD.key
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'The key of system role "%" cannot be changed', OLD.key
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.is_system AND NEW.is_active = false THEN
    RAISE EXCEPTION 'System role "%" cannot be deactivated', OLD.key
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS roles_protect_system ON roles;
--> statement-breakpoint
CREATE TRIGGER roles_protect_system
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION protect_system_roles();
