// Página para que el usuario establezca su contraseña.
// Se accede:
//   - Vía /auth/callback después del invite (sin sesión previa)
//   - Vía requireDriverProfile() cuando must_reset_password=true (sesión activa)
//
// Si llegan sin sesión, redirige a /login (es la única ruta protegida del flujo).

import { redirect } from 'next/navigation';
import { Card } from '@tripdrive/ui';
import { createServerClient } from '@tripdrive/supabase/server';
import { SetPasswordForm } from './set-password-form';

export const metadata = { title: 'Establecer contraseña' };

export default async function SetPasswordPage() {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect('/login?error=' + encodeURIComponent('Sesión expirada — pide un nuevo link'));
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--vf-bg)] p-4 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <Card className="border-[var(--color-border)]">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">Establece tu contraseña</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Para {data.user.email}. Esta será tu contraseña permanente.
            </p>
          </div>
          <SetPasswordForm />
        </Card>
      </div>
    </main>
  );
}
