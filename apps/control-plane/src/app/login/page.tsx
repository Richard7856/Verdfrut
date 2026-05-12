// Login del Control Plane — shared password con cookie HMAC.

import Image from 'next/image';
import { Card } from '@tripdrive/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Login · TripDrive Control Plane' };

interface SearchParams {
  next?: string;
  error?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--vf-bg)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <Image
            src="/tripdrive-logo-light.png"
            alt="TripDrive"
            width={200}
            height={72}
            className="td-logo-light h-14 w-auto"
            priority
          />
          <Image
            src="/tripdrive-logo-dark.png"
            alt="TripDrive"
            width={200}
            height={72}
            className="td-logo-dark h-14 w-auto"
            priority
          />
          <p className="mt-2 text-xs uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
            Control Plane
          </p>
        </div>
        <Card className="border-[var(--color-border)]">
          <LoginForm next={sp.next} initialError={sp.error} />
        </Card>
      </div>
    </main>
  );
}
