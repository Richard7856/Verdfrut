'use client';

// Botón para forzar reset de contraseña a un usuario.
// Caso de uso: chofer olvidó la contraseña, o admin sospecha credenciales comprometidas.
// El admin obtiene un recovery link copiable que puede mandar por WhatsApp si el email no llega.

import { useRef, useState, useTransition } from 'react';
import { Button, Input, Modal, toast } from '@tripdrive/ui';
import type { UserProfile } from '@tripdrive/types';
import { forcePasswordResetAction } from './actions';

export function ForceResetButton({ user }: { user: UserProfile }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  function trigger() {
    setError(null);
    setLink(null);
    setOpen(true);
    startTransition(async () => {
      const res = await forcePasswordResetAction(user.id);
      if (res.ok && res.resetLink) {
        setLink(res.resetLink);
      } else {
        setError(res.error ?? 'No se pudo generar el link');
      }
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      linkInputRef.current?.select();
      toast.info('Copia manualmente');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={trigger}
        className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline disabled:opacity-50"
        title={`Forzar reset de contraseña para ${user.fullName}`}
      >
        Reset
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Reset de contraseña"
        description={`${user.fullName} (${user.email}) deberá establecer una contraseña nueva al próximo login.`}
        size="md"
      >
        {pending && (
          <p className="text-sm text-[var(--color-text-muted)]">Generando link…</p>
        )}
        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
            {error}
          </div>
        )}
        {link && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Comparte este link con {user.fullName} (válido 24 h):
            </p>
            <div className="flex gap-2">
              <Input
                ref={linkInputRef}
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="primary" onClick={copyLink}>
                Copiar
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cerrar
          </Button>
        </div>
      </Modal>
    </>
  );
}
