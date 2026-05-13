#!/usr/bin/env bash
# ADR-085 / Issue #221 — guardrail contra service_role bypass.
#
# Razón: con Stream A introducimos RLS escalada por customer_id. Cada uso
# nuevo de `createServiceRoleClient()` que no esté justificado en el allow-list
# es una potencial puerta abierta multi-tenant. Este script falla si aparece
# un call-site que NO está en `scripts/service-role-allowlist.txt`.
#
# Uso:
#   ./scripts/check-service-role.sh           # exit 1 si hay drift
#   ./scripts/check-service-role.sh --refresh # imprime el inventario actual
#
# CI: agregar `pnpm check:service-role` al pipeline pre-Stream A.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALLOWLIST="$ROOT/scripts/service-role-allowlist.txt"

cd "$ROOT"

# Inventario: archivos que importan createServiceRoleClient O lo invocan.
# Buscamos `createServiceRoleClient(` (con paréntesis) para evitar matches
# en comentarios o re-exports puros. Excluímos node_modules y build artifacts.
CURRENT=$(grep -rln "createServiceRoleClient(" \
  apps/platform/src \
  apps/driver/src \
  apps/control-plane/src \
  2>/dev/null \
  | LC_ALL=C sort)

if [[ "${1:-}" == "--refresh" ]]; then
  echo "# Archivos autorizados a usar createServiceRoleClient()."
  echo "# Cada línea es un path relativo al repo root. Ver SERVICE_ROLE_AUDIT.md"
  echo "# para la justificación de cada entrada."
  echo "#"
  echo "# Regenerar con: ./scripts/check-service-role.sh --refresh > scripts/service-role-allowlist.txt"
  echo
  echo "$CURRENT"
  exit 0
fi

if [[ ! -f "$ALLOWLIST" ]]; then
  echo "❌ Falta $ALLOWLIST"
  echo "   Genera el snapshot con: ./scripts/check-service-role.sh --refresh > $ALLOWLIST"
  exit 1
fi

# Allowlist sin comentarios ni líneas vacías.
EXPECTED=$(grep -v '^\s*#' "$ALLOWLIST" | grep -v '^\s*$' | LC_ALL=C sort)

# diff: extras = en CURRENT pero no en EXPECTED. removed = inverso.
EXTRA=$(comm -23 <(echo "$CURRENT") <(echo "$EXPECTED") || true)
REMOVED=$(comm -13 <(echo "$CURRENT") <(echo "$EXPECTED") || true)

FAIL=0

if [[ -n "$EXTRA" ]]; then
  echo "❌ Nuevos call-sites de createServiceRoleClient() NO autorizados:"
  echo "$EXTRA" | sed 's/^/   /'
  echo
  echo "   Si el uso es legítimo: agrégalo a SERVICE_ROLE_AUDIT.md con justificación"
  echo "   y regenera $ALLOWLIST con --refresh. Si NO es legítimo: refactoriza"
  echo "   a sesión normal o a RPC SECURITY DEFINER."
  FAIL=1
fi

if [[ -n "$REMOVED" ]]; then
  echo "⚠️  Archivos del allow-list que ya NO usan service_role (limpia el allowlist):"
  echo "$REMOVED" | sed 's/^/   /'
  # No fail — esto es bueno (menos bypasses), solo recordatorio.
fi

if [[ "$FAIL" -eq 0 && -z "$REMOVED" ]]; then
  COUNT=$(echo "$CURRENT" | grep -c . || true)
  echo "✅ Inventario service_role estable ($COUNT archivos autorizados)."
fi

exit "$FAIL"
