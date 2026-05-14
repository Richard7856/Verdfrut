// Enrichment AI de specs de vehículos. Wrapper sobre @tripdrive/ai.

import 'server-only';
import { requireRole } from '@/lib/auth';
import { enrichVehicleSpecs } from '@tripdrive/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await requireRole('admin', 'dispatcher');

  let body: { description?: string };
  try {
    body = (await req.json()) as { description?: string };
  } catch {
    return Response.json({ error: 'json inválido' }, { status: 400 });
  }

  try {
    const result = await enrichVehicleSpecs(body.description ?? '');
    return Response.json({
      ok: true,
      data: result.data,
      tokens: { input: result.tokens_in, output: result.tokens_out },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI request failed';
    const status = msg.includes('no configurada') ? 503 : 400;
    return Response.json({ error: msg }, { status });
  }
}
