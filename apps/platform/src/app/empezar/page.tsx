// /empezar — landing público (NO requiere auth) para auto-onboarding desde
// el sitio público (tripdrive.xyz). El visitante llena empresa + admin email,
// pasa a Stripe Checkout, y al pagar se le crea el customer + se le envía
// magic link para entrar al platform.
//
// Decisión: hacemos la creación del customer Y del user_profile en el
// webhook (no aquí) para evitar orphan rows si el visitante abandona el
// checkout. Los datos del formulario viajan como metadata en la Stripe
// session y se materializan al confirmarse el pago.

import { redirect } from 'next/navigation';
import { SignupForm } from './signup-form';
import { getStripe, getPriceIdsForTier, planNameToTier } from '@/lib/stripe/client';

export const metadata = {
  title: 'Empezar Pro — TripDrive',
  description: 'Activa TripDrive Pro para tu operación logística en 2 minutos.',
};
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ plan?: string; success?: string }>;
}

export default async function EmpezarPage({ searchParams }: Props) {
  const { plan, success } = await searchParams;

  // Aceptamos los 3 tiers: operacion, pro, enterprise. Cualquier otro valor
  // defaultea a pro (el más popular).
  const selectedPlan: 'operacion' | 'pro' | 'enterprise' =
    plan === 'operacion' || plan === 'enterprise' ? plan : 'pro';

  // Si Stripe no está configurado para este tier, mostramos warning amable.
  const tier = planNameToTier(selectedPlan);
  const stripeReady = getStripe() !== null && getPriceIdsForTier(tier) !== null;
  if (!stripeReady) {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-6 text-sm dark:bg-amber-950/30">
          <h1 className="text-base font-semibold">Onboarding no disponible</h1>
          <p className="mt-2 text-xs">
            El sistema de cobranza aún no está activado. Contáctanos a{' '}
            <a href="mailto:soporte@tripdrive.xyz" className="underline">
              soporte@tripdrive.xyz
            </a>{' '}
            para empezar.
          </p>
        </div>
      </main>
    );
  }

  // Después del checkout exitoso, Stripe nos manda acá con ?success=1.
  // Mostramos confirmación + instrucción de revisar email para magic link.
  if (success === '1') {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-50 p-6 dark:bg-emerald-950/30">
          <h1 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
            ¡Pago confirmado!
          </h1>
          <p className="mt-3 text-sm text-emerald-900/80 dark:text-emerald-100/80">
            Te enviamos un correo con un enlace para activar tu cuenta. Revisa
            tu bandeja de entrada (y la carpeta de spam por si acaso).
          </p>
          <p className="mt-3 text-xs text-emerald-900/60 dark:text-emerald-100/60">
            Si no llega en 5 min, escríbenos a{' '}
            <a href="mailto:soporte@tripdrive.xyz" className="underline">
              soporte@tripdrive.xyz
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-12">
      <div className="mb-6">
        <a href="https://tripdrive.xyz" className="text-xs text-muted-foreground hover:underline">
          ← Volver a tripdrive.xyz
        </a>
      </div>
      <h1 className="text-2xl font-semibold">
        Empezar TripDrive{' '}
        {selectedPlan === 'pro'
          ? 'Pro'
          : selectedPlan === 'enterprise'
            ? 'Enterprise'
            : 'Operación'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Llena estos datos y pasamos a la pasarela de pago. Al confirmar tu suscripción
        te llega un correo para activar tu cuenta de administrador.
      </p>
      <div className="mt-6">
        <SignupForm plan={selectedPlan} />
      </div>
      <p className="mt-6 text-[11px] text-muted-foreground">
        Al continuar aceptas nuestros{' '}
        <a href="https://tripdrive.xyz/terminos.html" className="underline">
          Términos
        </a>{' '}
        y{' '}
        <a href="https://tripdrive.xyz/privacidad.html" className="underline">
          Aviso de privacidad
        </a>
        . Cancela cuando quieras desde tu portal de Stripe.
      </p>
      {redirect.length === 0 /* mute unused import */ && null}
    </main>
  );
}
