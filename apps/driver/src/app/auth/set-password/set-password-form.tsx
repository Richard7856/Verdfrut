'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input } from '@verdfrut/ui';
import { setPasswordAction } from './actions';

const MIN_LENGTH = 8;

export function SetPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        const pwd = String(formData.get('password') ?? '');
        const confirm = String(formData.get('confirm') ?? '');
        if (pwd.length < MIN_LENGTH) {
          setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`);
          return;
        }
        if (pwd !== confirm) {
          setError('Las contraseñas no coinciden');
          return;
        }
        startTransition(async () => {
          const result = await setPasswordAction(formData);
          if (result?.error) setError(result.error);
        });
      }}
      className="flex flex-col gap-4"
    >
      <Field label="Nueva contraseña" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={MIN_LENGTH}
          disabled={pending}
        />
      </Field>

      <Field label="Confirma contraseña" htmlFor="confirm" required>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          disabled={pending}
        />
      </Field>

      <p className="text-xs text-[var(--color-text-muted)]">
        Mínimo {MIN_LENGTH} caracteres. Una vez establecida, podrás iniciar sesión normal.
      </p>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" isLoading={pending}>
        Establecer contraseña
      </Button>
    </form>
  );
}
