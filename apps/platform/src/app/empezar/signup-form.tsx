'use client';

// Form de signup público — captura empresa + admin email + admin name, hace
// POST al endpoint /api/billing/signup, y redirige a la URL de Stripe Checkout.
// Validación client-side básica (email + longitudes) para feedback inmediato;
// la validación de verdad va en el server.

import { useState } from 'react';

interface Props {
  plan: 'pro' | 'operacion' | 'enterprise';
}

export function SignupForm({ plan }: Props) {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (companyName.trim().length < 2) {
      setError('Nombre de empresa muy corto');
      return;
    }
    if (adminName.trim().length < 2) {
      setError('Nombre del administrador muy corto');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      setError('Email inválido');
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/billing/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
          plan,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(data?.error ?? 'No se pudo iniciar el checkout');
        setPending(false);
        return;
      }
      // Full-page redirect a Stripe.
      window.location.href = data.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red');
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="company" className="mb-1 block text-xs font-medium">
          Nombre de la empresa
        </label>
        <input
          id="company"
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          maxLength={80}
          required
          disabled={pending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="Ej. Distribuidora Sol S.A. de C.V."
        />
      </div>

      <div>
        <label htmlFor="admin-name" className="mb-1 block text-xs font-medium">
          Tu nombre (administrador)
        </label>
        <input
          id="admin-name"
          type="text"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          maxLength={80}
          required
          disabled={pending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="Ej. María González"
        />
      </div>

      <div>
        <label htmlFor="admin-email" className="mb-1 block text-xs font-medium">
          Email del administrador
        </label>
        <input
          id="admin-email"
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          maxLength={120}
          required
          disabled={pending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="maria@distribuidora.mx"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Te enviaremos un enlace para entrar al platform después del pago.
        </p>
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
        {pending ? 'Redirigiendo a Stripe…' : 'Continuar a pago →'}
      </button>
    </form>
  );
}
