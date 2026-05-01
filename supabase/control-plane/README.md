# Migraciones — Control Plane VerdFrut

Schema del proyecto Supabase del control plane (super admin VerdFrut).
Este proyecto **no contiene PII** de ningún cliente — solo:

1. **Registro de tenants** (clientes con su slug, status, plan, timezone — credenciales NO viven aquí, viven en `/etc/verdfrut/tenants.json` en el VPS).
2. **KPIs agregados** sincronizados nocturnamente desde cada proyecto cliente.
3. **Usuarios super admin VerdFrut**.

## Aplicar
```bash
SUPABASE_PROJECT_ID=$CP_PROJECT_ID supabase db push --db-url "$CP_DB_URL"
```
