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
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">VerdFrut</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">App de chofer</p>
      </div>
      <LoginForm next={next} initialError={error} />
    </Card>
  );
}
