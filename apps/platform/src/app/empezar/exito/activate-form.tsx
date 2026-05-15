'use client';

// Form para establecer la contraseña tras el pago. Llama
// POST /api/billing/activate-account con { session_id, password }; el server
// re-verifica el pago con Stripe (defensa), setea la password en Supabase Auth,
// y marca must_reset_password=false. Luego hacemos login programático con
// signInWithPassword desde el cliente y redirigimos a /routes.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@tripdrive/supabase/browser';

interface Props {
  sessionId: string;
  email: string;
}

export function ActivateForm({ sessionId, email }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 10) {
      setError('La contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setPending(true);

    // 1. Setear password vía endpoint (server tiene el service_role).
    try {
      const res = await fetch('/api/billing/activate-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'No pudimos activar tu cuenta.');
        setPending(false);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red');
      setPending(false);
      return;
    }

    // 2. Login programático con email + password recién creada. Esto
    //    establece la sesión cookie de Supabase en el browser; al redirigir
    //    a /routes el middleware reconoce al user.
    try {
      const supabase = createBrowserClient();
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) {
        // No fatal: la cuenta ya quedó activada, podemos mandar a /login
        // para que el user entre manualmente.
        setError(`Cuenta lista, pero el login automático falló (${signErr.message}). Entra manualmente:`);
        setTimeout(() => router.push(`/login?email=${encodeURIComponent(email)}`), 1500);
        setPending(false);
        return;
      }
    } catch (err) {
      setError(`Cuenta lista. Entra manualmente: ${err instanceof Error ? err.message : ''}`);
      setTimeout(() => router.push(`/login?email=${encodeURIComponent(email)}`), 1500);
      setPending(false);
      return;
    }

    // 3. Entrar al platform. /routes es la home del admin.
    router.push('/routes?welcome=1');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email-display" className="mb-1 block text-xs font-medium">
          Email (administrador)
        </label>
        <input
          id="email-display"
          type="email"
          value={email}
          readOnly
          disabled
          className="w-full cursor-not-allowed rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium">
          Contraseña nueva
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={10}
          required
          disabled={pending}
          autoComplete="new-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="Al menos 10 caracteres"
        />
      </div>

      <div>
        <label htmlFor="confirm" className="mb-1 block text-xs font-medium">
          Confirma la contraseña
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={10}
          required
          disabled={pending}
          autoComplete="new-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? 'Activando…' : 'Crear cuenta y entrar →'}
      </button>
    </form>
  );
}
