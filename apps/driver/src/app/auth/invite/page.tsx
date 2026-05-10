// Landing page de activación de cuenta — recibe ?t=<token_hash>&type=<tipo>.
//
// Por qué existe esta página en lugar de ir directo a /auth/callback:
// Los previews de WhatsApp/iMessage fetchean la URL antes de que el chofer la abra.
// /auth/callback es un Route Handler (GET) que ejecuta verifyOtp en el server y consume
// el token de un solo uso. Resultado: chofer abre el link y ya está gastado.
//
// Esta página es solo HTML + un botón. El token se consume SOLO cuando el chofer
// toca "Activar mi cuenta" (JS del cliente llama verifyOtp). El crawler no ejecuta
// JS, así el token sobrevive hasta el clic real — issue #11.

import type { Metadata } from 'next';
import { InviteActivateClient } from './invite-activate-client';

export const metadata: Metadata = { title: 'Activar cuenta' };

interface Props {
  searchParams: Promise<{ t?: string; type?: string }>;
}

export default async function InvitePage({ searchParams }: Props) {
  const params = await searchParams;
  const tokenHash = params.t ?? '';
  const type = params.type ?? '';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--vf-bg)] p-4 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-[var(--vf-green-600,#15803d)]">TripDrive</h1>
        </div>
        <InviteActivateClient tokenHash={tokenHash} type={type as 'invite' | 'recovery' | ''} />
      </div>
    </main>
  );
}
