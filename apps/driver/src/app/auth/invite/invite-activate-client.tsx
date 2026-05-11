'use client';

// Llama verifyOtp SOLO cuando el chofer toca "Activar mi cuenta".
// El token no se consume en page load, así los previews de WhatsApp/iMessage
// que fetchean la URL no lo queman antes de que el chofer llegue — issue #11.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@tripdrive/supabase/browser';
import { Button, Card } from '@tripdrive/ui';

type OtpType = 'invite' | 'recovery' | 'magiclink' | 'signup' | 'email_change';

interface Props {
  tokenHash: string;
  type: OtpType | '';
}

const COPY: Record<string, { title: string; subtitle: string; cta: string }> = {
  invite: {
    title: '¡Bienvenido a TripDrive!',
    subtitle: 'Tu cuenta está lista. Toca el botón para activarla y establecer tu contraseña.',
    cta: 'Activar mi cuenta',
  },
  recovery: {
    title: 'Restablecer contraseña',
    subtitle: 'Toca el botón para continuar y establecer tu nueva contraseña.',
    cta: 'Continuar',
  },
};

const DEFAULT_COPY = {
  title: 'Activar acceso',
  subtitle: 'Toca el botón para continuar.',
  cta: 'Continuar',
};

export function InviteActivateClient({ tokenHash, type }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const copy = COPY[type] ?? DEFAULT_COPY;
  const isValid = Boolean(tokenHash && type);

  function handleActivate() {
    if (!isValid) return;
    setError(null);

    startTransition(async () => {
      const supabase = createBrowserClient();
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as OtpType,
      });

      if (verifyErr) {
        setError(verifyErr.message);
        return;
      }

      // Para invite y recovery siempre pasamos por set-password.
      // set-password/actions.ts baja el flag must_reset_password y redirige al home.
      router.replace('/auth/set-password');
    });
  }

  if (!isValid) {
    return (
      <Card className="border-[var(--color-border)]">
        <div className="text-center">
          <p className="text-2xl font-semibold text-[var(--color-text)]">Link inválido</p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Este link está incompleto o expirado. Pide al encargado que genere uno nuevo desde el panel.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--color-border)]">
      <div className="mb-6 text-center">
        <p className="text-2xl font-semibold text-[var(--color-text)]">{copy.title}</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{copy.subtitle}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          <p className="font-medium">El link expiró o ya fue usado.</p>
          <p className="mt-1 opacity-80">{error}</p>
          <p className="mt-2">Pide al encargado un nuevo link desde el panel web.</p>
        </div>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="w-full"
        isLoading={pending}
        onClick={handleActivate}
      >
        {copy.cta}
      </Button>
    </Card>
  );
}
