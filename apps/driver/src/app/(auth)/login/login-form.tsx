'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input } from '@verdfrut/ui';
import { loginAction } from './actions';

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await loginAction(formData);
          if (result?.error) setError(result.error);
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
