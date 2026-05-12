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
        <Image
          src="/tripdrive-logo-light.png"
          alt="TripDrive"
          width={180}
          height={64}
          className="td-logo-light h-14 w-auto"
          priority
        />
        <Image
          src="/tripdrive-logo-dark.png"
          alt="TripDrive"
          width={180}
          height={64}
          className="td-logo-dark h-14 w-auto"
          priority
        />
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">App de chofer</p>
      </div>
      <LoginForm next={next} initialError={error} />
    </Card>
  );
}
