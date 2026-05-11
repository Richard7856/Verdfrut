'use client';

// ADR-046: botón + modal para habilitar/revocar el enlace público read-only
// del tiro. URL copiable a portapapeles.

import { useState, useTransition } from 'react';
import { Button, toast } from '@tripdrive/ui';
import {
  enableDispatchSharingAction,
  disableDispatchSharingAction,
} from '../actions';

interface Props {
  dispatchId: string;
  /** Token actual (null si no está compartido). */
  currentToken: string | null;
}

export function ShareDispatchButton({ dispatchId, currentToken }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(currentToken);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // El URL completo se arma client-side (necesitamos window.location.origin).
  const url = token
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/share/dispatch/${token}`
      : `/share/dispatch/${token}`
    : null;

  function handleEnable() {
    startTransition(async () => {
      const res = await enableDispatchSharingAction(dispatchId);
      if (res.ok && res.token) {
        setToken(res.token);
        toast.success('Enlace generado', 'Cualquiera con este link puede ver el tiro.');
      } else {
        toast.error('Error', res.error ?? 'No se pudo generar enlace');
      }
    });
  }

  function handleDisable() {
    if (!confirm('¿Revocar el enlace? Cualquiera con el link viejo dejará de tener acceso.')) {
      return;
    }
    startTransition(async () => {
      const res = await disableDispatchSharingAction(dispatchId);
      if (res.ok) {
        setToken(null);
        toast.success('Enlace revocado', 'El link ya no funciona.');
      } else {
        toast.error('Error', res.error ?? 'No se pudo revocar');
      }
    });
  }

  function handleRotate() {
    if (
      !confirm(
        '¿Generar un link nuevo? El link anterior dejará de funcionar al instante.',
      )
    ) {
      return;
    }
    handleEnable();
  }

  async function copyToClipboard() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('No se pudo copiar', 'Selecciona el texto y copia manualmente.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-bg-elev)] px-3 py-1.5 text-xs font-medium text-[var(--vf-text)] hover:bg-[var(--vf-bg-sub)]"
      >
        🔗 Compartir
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-bg-elev)] p-5">
            <h3 className="text-base font-semibold text-[var(--vf-text)]">
              Compartir vista del tiro
            </h3>
            <p className="mt-1 text-xs text-[var(--vf-text-mute)]">
              Genera un enlace público de solo lectura. Útil para compartir con tu equipo
              vía WhatsApp/email — pueden ver el mapa y las rutas pero no editar nada.
            </p>

            {!token ? (
              <div className="mt-4 space-y-3">
                <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-bg-sub)] p-3 text-xs text-[var(--vf-text-mute)]">
                  ⚠️ Cualquiera con el link podrá ver el tiro <strong>sin necesidad de
                  iniciar sesión</strong>. No incluyas información sensible.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleEnable}
                  disabled={pending}
                  className="w-full"
                >
                  {pending ? 'Generando…' : 'Generar enlace público'}
                </Button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-medium text-[var(--vf-text)]">
                  Enlace público
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={url ?? ''}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-bg-sub)] px-3 py-2 font-mono text-[11px] text-[var(--vf-text)]"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={copyToClipboard}
                  >
                    {copied ? '✓ Copiado' : 'Copiar'}
                  </Button>
                </div>
                <p className="text-[11px] text-[var(--vf-text-mute)]">
                  El enlace funcionará hasta que lo revoques explícitamente.
                </p>

                <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                  <button
                    type="button"
                    onClick={handleRotate}
                    disabled={pending}
                    className="text-xs text-[var(--vf-text-mute)] underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {pending ? '…' : 'Regenerar link'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDisable}
                    disabled={pending}
                    className="text-xs text-[var(--vf-crit)] underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {pending ? '…' : 'Revocar enlace'}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end border-t border-[var(--color-border)] pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-[var(--vf-text-mute)] hover:text-[var(--vf-text)]"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
