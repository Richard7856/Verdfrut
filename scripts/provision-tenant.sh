#!/usr/bin/env bash
# Provisiona un nuevo tenant (cliente) — proyecto Supabase, schema, registro.
#
# USO:
#   ./scripts/provision-tenant.sh <slug> "<nombre>" <timezone>
# EJEMPLO:
#   ./scripts/provision-tenant.sh neto "Tiendas Neto" America/Mexico_City
#
# REQUIERE:
#   - SUPABASE_MANAGEMENT_API_TOKEN exportada (https://supabase.com/dashboard/account/tokens)
#   - SUPABASE_ORG_ID exportada (id de la org de VerdFrut)
#   - supabase CLI instalada (https://supabase.com/docs/guides/cli)
#   - jq instalada
#
# QUÉ HACE (los pasos manuales hasta automatizar todo):
#   1. Crea proyecto Supabase via Management API
#   2. Espera a que el proyecto esté listo
#   3. Aplica migraciones de supabase/migrations/
#   4. Configura Storage buckets
#   5. Crea usuario admin inicial
#   6. Agrega entrada al registro de tenants (/etc/verdfrut/tenants.json)

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <slug> \"<name>\" <timezone>"
  echo "Example: $0 neto \"Tiendas Neto\" America/Mexico_City"
  exit 1
fi

SLUG="$1"
NAME="$2"
TZ="$3"

: "${SUPABASE_MANAGEMENT_API_TOKEN:?SUPABASE_MANAGEMENT_API_TOKEN no está definida}"
: "${SUPABASE_ORG_ID:?SUPABASE_ORG_ID no está definida}"

REGISTRY_PATH="${TENANT_REGISTRY_PATH:-/etc/verdfrut/tenants.json}"
REGION="${SUPABASE_REGION:-sa-east-1}"
DB_PASSWORD="$(openssl rand -hex 24)"

echo "==> Creando proyecto Supabase para tenant '$SLUG'..."
PROJECT_RESPONSE=$(curl -sf -X POST "https://api.supabase.com/v1/projects" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg name "verdfrut-$SLUG" \
    --arg org "$SUPABASE_ORG_ID" \
    --arg region "$REGION" \
    --arg pw "$DB_PASSWORD" \
    '{name: $name, organization_id: $org, region: $region, db_pass: $pw, plan: "free"}')")

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | jq -r .id)
echo "    project_id: $PROJECT_ID"

echo "==> Esperando a que el proyecto esté listo (puede tardar 1-3 min)..."
for i in {1..60}; do
  STATUS=$(curl -sf "https://api.supabase.com/v1/projects/$PROJECT_ID" \
    -H "Authorization: Bearer $SUPABASE_MANAGEMENT_API_TOKEN" | jq -r .status)
  if [[ "$STATUS" == "ACTIVE_HEALTHY" ]]; then
    echo "    proyecto listo"
    break
  fi
  echo "    status=$STATUS, esperando..."
  sleep 5
done

echo "==> Obteniendo credenciales..."
KEYS_RESPONSE=$(curl -sf "https://api.supabase.com/v1/projects/$PROJECT_ID/api-keys" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_API_TOKEN")
ANON_KEY=$(echo "$KEYS_RESPONSE" | jq -r '.[] | select(.name=="anon") | .api_key')
SERVICE_KEY=$(echo "$KEYS_RESPONSE" | jq -r '.[] | select(.name=="service_role") | .api_key')
SUPABASE_URL="https://$PROJECT_ID.supabase.co"

echo "==> Aplicando migraciones..."
DB_URL="postgresql://postgres:${DB_PASSWORD}@db.${PROJECT_ID}.supabase.co:5432/postgres"
for migration in supabase/migrations/*.sql; do
  echo "    -> $migration"
  PGPASSWORD="$DB_PASSWORD" psql "$DB_URL" -f "$migration" >/dev/null
done

echo "==> Actualizando tenant registry: $REGISTRY_PATH"
TMP_FILE=$(mktemp)
if [[ -f "$REGISTRY_PATH" ]]; then
  cp "$REGISTRY_PATH" "$TMP_FILE"
else
  echo '{"tenants":[]}' > "$TMP_FILE"
fi

jq --arg slug "$SLUG" \
   --arg url "$SUPABASE_URL" \
   --arg anon "$ANON_KEY" \
   --arg svc "$SERVICE_KEY" \
   --arg tz "$TZ" \
   '.tenants += [{slug: $slug, supabaseUrl: $url, supabaseAnonKey: $anon, supabaseServiceKey: $svc, status: "active", plan: "starter", timezone: $tz}]' \
   "$TMP_FILE" > "${TMP_FILE}.new"

# Necesita sudo si REGISTRY_PATH es /etc/verdfrut/
mv "${TMP_FILE}.new" "$REGISTRY_PATH"
chmod 600 "$REGISTRY_PATH"
rm -f "$TMP_FILE"

echo ""
echo "==============================="
echo "✓ Tenant '$SLUG' provisionado"
echo "==============================="
echo "Project ID:   $PROJECT_ID"
echo "URL:          $SUPABASE_URL"
echo "Subdomain:    https://$SLUG.verdfrut.com"
echo "DB password:  $DB_PASSWORD  (guarda esto en tu password manager)"
echo ""
echo "PRÓXIMOS PASOS:"
echo "  1. Crear el primer usuario admin desde Supabase Studio: $SUPABASE_URL"
echo "  2. Insertar zonas y datos iniciales (tiendas, camiones)"
echo "  3. Verificar acceso desde https://$SLUG.verdfrut.com"
