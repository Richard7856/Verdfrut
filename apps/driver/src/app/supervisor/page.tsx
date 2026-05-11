// Vista de supervisor de zona (zone_manager).
// STUB de scaffold — el mapa con choferes en vivo y chats activos llega en Fase 3.

import { requireDriverProfile } from '@/lib/auth';
import { Card } from '@tripdrive/ui';
import { logoutAction } from '@/app/(auth)/login/actions';

export const metadata = { title: 'Supervisión' };

export default async function SupervisorPage() {
  const profile = await requireDriverProfile();

  return (
    <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">TripDrive · Supervisión</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{profile.fullName}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-sm text-[var(--color-text-muted)] underline-offset-2 hover:underline"
          >
            Salir
          </button>
        </form>
      </header>

      <section className="p-4">
        <Card className="border-[var(--color-border)]">
          <h2 className="text-base font-medium">Modo supervisor</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Aquí verás el mapa de tu zona con tus choferes en tiempo real. Pendiente de
            implementar en Fase 3 (GPS realtime + chats).
          </p>
        </Card>
      </section>
    </main>
  );
}
