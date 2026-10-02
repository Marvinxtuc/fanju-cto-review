CREATE FUNCTION v11_formal_audit_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.action LIKE '%v11-formal%' OR OLD.action IN (
 'policy.v11-runtime-assembled','supply.v11-platform-approved','supply.v11-restaurant-proposed',
 'refund.v11-known-obligation','funding.v11-closed-query-converged','funding.v11-refund-query-confirmed') THEN
  IF TG_OP='DELETE' OR to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
   RAISE EXCEPTION 'Formal business authority audit history is append only';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v11_formal_audit_history_guard BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION v11_formal_audit_history_guard();
