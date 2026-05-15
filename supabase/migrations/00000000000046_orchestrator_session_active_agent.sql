-- ADR-101 / Sprint R3: estado de "agente activo" en la sesión.
--
-- El handoff conversacional necesita persistir entre turnos: cuando el
-- orchestrator entrega control al router agent, los próximos turnos deben
-- llamar al router hasta que éste devuelva el control. Como Next.js server
-- es stateless, el "qué agente está activo" vive en la sesión.
--
-- Default 'orchestrator' garantiza que sesiones EXISTENTES siguen
-- comportándose idénticas — el chat actual nunca cambia de rol salvo
-- que el orchestrator invoque `enter_router_mode`.
--
-- TEXT (no enum) porque planeamos agregar más roles dinámicamente (geo
-- como agente conversacional standalone, p.ej.). Un check constraint
-- restringe valores conocidos.

BEGIN;

ALTER TABLE orchestrator_sessions
  ADD COLUMN IF NOT EXISTS active_agent_role TEXT NOT NULL DEFAULT 'orchestrator';

-- Restricción de valores válidos. Hot-swappable: cuando R4 agregue otro
-- rol, hacer `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...`
-- en migración separada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orchestrator_sessions_active_agent_role_check'
  ) THEN
    ALTER TABLE orchestrator_sessions
      ADD CONSTRAINT orchestrator_sessions_active_agent_role_check
      CHECK (active_agent_role IN ('orchestrator', 'router', 'geo'));
  END IF;
END$$;

COMMENT ON COLUMN orchestrator_sessions.active_agent_role IS
  'ADR-101 / R3. Cuál agente maneja el próximo turno. Default ' ||
  '"orchestrator". El orchestrator delega al router via tool ' ||
  '`enter_router_mode`; el router devuelve control via `exit_router_mode`.';

COMMIT;
