// Health check público — usado por Traefik / Docker healthcheck.
// NO requiere auth (está en PUBLIC_PATHS del middleware).

export async function GET() {
  return Response.json({
    status: 'ok',
    service: 'platform',
    tenant: process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'unknown',
  });
}
