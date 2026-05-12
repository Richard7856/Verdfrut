// Página de login. UI minimalista con el logo TripDrive (lockup completo).

import Image from 'next/image';
import { Card } from '@tripdrive/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Iniciar sesión' };

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { next, error } = await searchParams;

  return (
    <Card className="border-[var(--color-border)]">
      <div className="mb-6 flex flex-col items-center text-center">
        {/* Stack de 2 lockups: solo uno visible según [data-theme] del root.
            Reglas en tokens.css con la clase `.td-logo-light` / `.td-logo-dark`. */}
        <Image
          src="/tripdrive-logo-light.png"
          alt="TripDrive"
          width={180}
          height={64}
          className="td-logo-light h-12 w-auto"
          priority
        />
        <Image
          src="/tripdrive-logo-dark.png"
          alt="TripDrive"
          width={180}
          height={64}
          className="td-logo-dark h-12 w-auto"
          priority
        />
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Inicia sesión en tu panel
        </p>
      </div>
      <LoginForm next={next} initialError={error} />
    </Card>
  );
}
