// /empezar/exito — pantalla post-pago de Stripe. Recibe ?session_id=cs_xxx
// y verifica el pago directo con Stripe, luego muestra un form para que el
// admin establezca su contraseña sin tener que esperar el email magic link.
//
// Robustez: hay 2 caminos que llegan acá:
//   - Path normal: webhook ya procesó el pago + provisionó customer/user.
//     Lo único pendiente es setear password.
//   - Path race: el browser regresa de Stripe ANTES de que el webhook corra
//     (puede tardar hasta ~10s en producción). Este server-side dispara
//     provisionNewCustomerFromSignup él mismo. Es idempotente con el webhook
//     — el que llegue primero gana, el otro se queda con el handle existente.
//
// En ambos casos al user le sale el form de password sin importar quién
// hizo la provisión.

import { redirect } from 'next/navigation';
import { requireStripe } from '@/lib/stripe/client';
import { provisionNewCustomerFromSignup } from '@/lib/stripe/provision';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import { ActivateForm } from './activate-form';

export const metadata = { title: '¡Bienvenido! · Activa tu cuenta' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ session_id?: string; success?: string }>;
}

export default async function EmpezarExitoPage({ searchParams }: Props) {
  const { session_id } = await searchParams;

  if (!session_id) {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-6 text-sm dark:bg-amber-950/30">
          <h1 className="text-base font-semibold">Falta el ID de la sesión de pago</h1>
          <p className="mt-2 text-xs">
            Si acabas de pagar, intenta abrir el enlace que te enviamos por correo. Si no,
            <a href="/empezar" className="ml-1 underline">empieza de nuevo aquí</a>.
          </p>
        </div>
      </main>
    );
  }

  // 1. Verificar el pago directamente con Stripe (defensa: no confiamos en
  //    el sólo hecho de que el user llegó con ?session_id; podría falsificarlo).
  let stripe;
  try {
    stripe = requireStripe();
  } catch (err) {
    logger.error('empezar.exito.stripe_not_configured', { err: err instanceof Error ? err.message : String(err) });
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-red-500/40 bg-red-50 p-6 text-sm dark:bg-red-950/30">
          <h1 className="text-base font-semibold">Error de configuración</h1>
          <p className="mt-2 text-xs">
            El sistema de pago no responde. Contáctanos a soporte@tripdrive.xyz con tu confirmación.
          </p>
        </div>
      </main>
    );
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch (err) {
    logger.warn('empezar.exito.session_invalid', { session_id, err: err instanceof Error ? err.message : String(err) });
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-red-500/40 bg-red-50 p-6 text-sm dark:bg-red-950/30">
          <h1 className="text-base font-semibold">Sesión de pago no encontrada</h1>
          <p className="mt-2 text-xs">El ID de sesión no es válido o expiró. Si pagaste, contáctanos a soporte@tripdrive.xyz.</p>
        </div>
      </main>
    );
  }

  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-6 text-sm dark:bg-amber-950/30">
          <h1 className="text-base font-semibold">Pago pendiente</h1>
          <p className="mt-2 text-xs">
            Tu pago aún no aparece como confirmado en Stripe. Espera un par de minutos y refresca
            esta página. Si persiste, contáctanos.
          </p>
        </div>
      </main>
    );
  }

  // 2. Extraer metadata del signup (los puso el endpoint /api/billing/signup).
  const companyName = session.metadata?.tripdrive_signup_company as string | undefined;
  const adminName = session.metadata?.tripdrive_signup_admin_name as string | undefined;
  const adminEmail = session.metadata?.tripdrive_signup_admin_email as string | undefined;
  const plan = (session.metadata?.tripdrive_signup_plan as string | undefined) ?? 'pro';
  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

  if (!companyName || !adminName || !adminEmail || !stripeCustomerId || !subscriptionId) {
    logger.error('empezar.exito.metadata_missing', { session_id });
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-red-500/40 bg-red-50 p-6 text-sm dark:bg-red-950/30">
          <h1 className="text-base font-semibold">Datos de signup incompletos</h1>
          <p className="mt-2 text-xs">No pudimos leer los datos de tu registro. Contáctanos.</p>
        </div>
      </main>
    );
  }

  // 3. Asegurar provisión. Idempotente: si el webhook ya corrió, esto
  //    detecta el user existente y retorna su userId. Si NO, hacemos la
  //    provisión aquí. sendInviteEmail=false porque el user está vivo
  //    en este browser y va a setear password en el form siguiente —
  //    no necesita magic link de Supabase.
  const provision = await provisionNewCustomerFromSignup({
    companyName,
    adminName,
    adminEmail,
    plan,
    stripeCustomerId,
    stripeSubscriptionId: subscriptionId,
    sendInviteEmail: false,
  });

  if (!provision.ok || !provision.userId) {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="rounded-lg border border-red-500/40 bg-red-50 p-6 text-sm dark:bg-red-950/30">
          <h1 className="text-base font-semibold">No pudimos activar tu cuenta</h1>
          <p className="mt-2 text-xs">{provision.error ?? 'Error desconocido'}</p>
          <p className="mt-2 text-xs">Contáctanos a soporte@tripdrive.xyz con tu confirmación de pago.</p>
        </div>
      </main>
    );
  }

  // 4. Si el user_profile ya NO tiene must_reset_password (porque el user
  //    ya volvió antes y seteó), lo mandamos directo a login.
  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('must_reset_password')
    .eq('id', provision.userId)
    .maybeSingle();
  if (profile && profile.must_reset_password === false) {
    redirect('/login?activated=1');
  }

  // 5. Mostrar form para que establezca password. La página queda agnóstica
  //    del backend de auth — el form post a /api/billing/activate-account.
  const tierLabel = plan === 'operacion' ? 'Operación' : plan === 'enterprise' ? 'Enterprise' : 'Pro';

  return (
    <main className="mx-auto max-w-md p-6 pt-12">
      <div className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-50 p-4 dark:bg-emerald-950/30">
        <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
          ✓ Pago confirmado — TripDrive {tierLabel}
        </h2>
        <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-100/80">
          Empresa: <strong>{companyName}</strong> · Admin: <strong>{adminEmail}</strong>
        </p>
      </div>

      <h1 className="text-2xl font-semibold">Crea tu contraseña</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Último paso para entrar al platform. La contraseña debe tener al menos 10 caracteres.
      </p>

      <div className="mt-6">
        <ActivateForm sessionId={session_id} email={adminEmail} />
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        ¿Prefieres entrar por enlace de correo? También te enviamos uno como respaldo —
        revisa tu bandeja en unos segundos.
      </p>
    </main>
  );
}
