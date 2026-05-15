'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input } from '@tripdrive/ui';
import { loginAction } from './actions';

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          try {
            const result = await loginAction(formData);
            if (result?.error) {
              setError(result.error);
            } else if (result && !result.error) {
              // Server action retornó sin error pero NO hizo redirect (raro):
              // probable que la cookie de sesión no se haya persistido.
              setError(
                'Tu sesión no pudo establecerse. Verifica que tu navegador acepte cookies e intenta de nuevo.',
              );
            }
            // Si result === undefined: el action hizo redirect (éxito).
            // El browser ya navegó; no tocamos el estado.
          } catch (err) {
            // Cualquier excepción inesperada — el form NUNCA debe quedarse en
            // silencio. El user siempre ve un mensaje.
            console.error('[loginAction client]', err);
            setError(
              'Algo salió mal al iniciar sesión. Revisa tu conexión e intenta de nuevo.',
            );
          }
        });
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="next" value={next ?? ''} />

      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          disabled={pending}
        />
      </Field>

      <Field label="Contraseña" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </Field>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" isLoading={pending}>
        Iniciar sesión
      </Button>
    </form>
  );
}
