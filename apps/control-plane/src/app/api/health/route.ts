// Healthcheck público del Control Plane (no requiere cookie).
// Sirve para que un monitor externo (UptimeRobot, n8n) verifique que la app está viva.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: 'verdfrut-control-plane',
    ts: new Date().toISOString(),
  });
}
