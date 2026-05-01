#!/usr/bin/env bash
# Aplica todas las migraciones pendientes a TODOS los tenants activos.
# Lee /etc/verdfrut/tenants.json para conocer los proyectos.
#
# USO:
#   ./scripts/migrate-all-tenants.sh
#   ./scripts/migrate-all-tenants.sh --dry-run

set -euo pipefail

REGISTRY_PATH="${TENANT_REGISTRY_PATH:-/etc/verdfrut/tenants.json}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if [[ ! -f "$REGISTRY_PATH" ]]; then
  echo "ERROR: $REGISTRY_PATH no existe"
  exit 1
fi

TENANTS=$(jq -r '.tenants[] | select(.status=="active") | .slug' "$REGISTRY_PATH")

echo "==> Tenants activos:"
echo "$TENANTS" | sed 's/^/    /'
echo ""

for slug in $TENANTS; do
  URL=$(jq -r --arg s "$slug" '.tenants[] | select(.slug==$s) | .supabaseUrl' "$REGISTRY_PATH")
  PROJECT_ID=$(echo "$URL" | sed -E 's|https://([^.]+)\.supabase\.co|\1|')

  echo "==> Tenant: $slug ($PROJECT_ID)"
  for migration in supabase/migrations/*.sql; do
    if [[ "$DRY_RUN" == true ]]; then
      echo "    [dry-run] $migration"
    else
      echo "    -> $migration"
      # Asume que tienes el password en una env var por proyecto, ej: NETO_DB_PASSWORD
      VAR_NAME="$(echo "$slug" | tr '[:lower:]-' '[:upper:]_')_DB_PASSWORD"
      DB_PASS="${!VAR_NAME:-}"
      if [[ -z "$DB_PASS" ]]; then
        echo "    SKIP: $VAR_NAME no está definida"
        continue
      fi
      DB_URL="postgresql://postgres:${DB_PASS}@db.${PROJECT_ID}.supabase.co:5432/postgres"
      PGPASSWORD="$DB_PASS" psql "$DB_URL" -f "$migration" >/dev/null
    fi
  done
done

echo ""
echo "✓ Migraciones aplicadas a todos los tenants activos"
