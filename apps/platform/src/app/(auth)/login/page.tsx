// Página de login. UI minimalista — re-skin completo cuando llegue identidad visual.

import { Card } from '@verdfrut/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Iniciar sesión' };

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { next, error } = await searchParams;

  return (
    <Card className="border-[var(--color-border)]">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-[var(--color-text)]">TripDrive</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Inicia sesión en tu panel
        </p>
      </div>
      <LoginForm next={next} initialError={error} />
    </Card>
  );
}
