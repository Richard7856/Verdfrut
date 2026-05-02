// Healthcheck para Traefik / Docker / monitoreo externo.
// Responde 200 sin tocar DB para no acoplar el liveness al estado de Supabase.

export const dynamic = 'force-static';

export function GET() {
  return Response.json({ status: 'ok', service: 'driver' });
}
