// Login del Control Plane — shared password con cookie HMAC.

import { Card } from '@verdfrut/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Login · VerdFrut Control Plane' };

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
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-[var(--vf-green-600,#15803d)]">
            verd<em className="not-italic">frut</em>
          </h1>
          <p className="mt-1 text-xs uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
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
