import 'server-only';

// Provisión de un customer nuevo tras checkout exitoso. Lo llaman 2 vías:
//   - Webhook checkout.session.completed (path normal)
//   - /empezar/exito page server-side (path defensivo si el webhook no ha
//     corrido todavía cuando el user regresa de Stripe)
//
// Diseño idempotente: si el email/stripe_customer_id ya existe, devuelve
// el customer_id existente sin duplicar nada. Ambos llamadores pueden
// disparar sin coordinación y solo uno "gana".

import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

export type ProvisionPlan = 'operacion' | 'pro' | 'enterprise' | 'starter';

export interface ProvisionInput {
  companyName: string;
  adminName: string;
  adminEmail: string;
  plan: ProvisionPlan | string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  /**
   * Si true, llama `inviteUserByEmail` para enviar magic link de Supabase
   * (path del webhook — el user debe poder entrar aunque no regrese al sitio).
   * Si false, solo crea el auth user con random password — la página de
   * activación seteará el password real al instante (UX sin email).
   */
  sendInviteEmail: boolean;
}

export interface ProvisionResult {
  ok: boolean;
  customerId?: string;
  userId?: string;
  error?: string;
  /** True si el provision encontró un customer existente y lo retornó (no creó nada). */
  idempotent?: boolean;
}

export async function provisionNewCustomerFromSignup(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const admin = createServiceRoleClient();
  const { companyName, adminName, adminEmail, plan, stripeCustomerId, stripeSubscriptionId } = input;

  // 1. Idempotencia: si ya existe user_profile con ese email, retornamos.
  //    Tanto el webhook como la página de activación pueden llegar acá; el
  //    primero gana y el segundo se queda con el handle del existente.
  const { data: existingProfile } = await admin
    .from('user_profiles')
    .select('id, customer_id')
    .eq('email', adminEmail)
    .maybeSingle();
  if (existingProfile?.customer_id) {
    return {
      ok: true,
      customerId: existingProfile.customer_id as string,
      userId: existingProfile.id as string,
      idempotent: true,
    };
  }

  // Customer también idempotente por stripe_customer_id.
  const { data: existingCustomer } = await admin
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  // Si el customer existe pero el user_profile no, hay drift — limpiamos y
  // proseguimos creando ambos. (Edge: alguien borró el profile a mano).
  let customerId: string | null = (existingCustomer?.id as string | undefined) ?? null;

  if (!customerId) {
    // 2. Generar slug único.
    const baseSlug = slugifyForCustomer(companyName);
    const slug = await findAvailableSlug(admin, baseSlug);

    // 3. Insert customer. Map plan comercial → enum BD.
    const tier: 'starter' | 'pro' | 'enterprise' =
      plan === 'operacion' || plan === 'starter'
        ? 'starter'
        : plan === 'enterprise'
          ? 'enterprise'
          : 'pro';
    const { data: newCustomer, error: cErr } = await admin
      .from('customers')
      .insert({
        slug,
        name: companyName,
        tier,
        status: 'active',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
      })
      .select('id')
      .single();
    if (cErr || !newCustomer) {
      logger.error('provision.customer_insert_failed', {
        admin_email: adminEmail,
        slug,
        err: cErr?.message,
      });
      return { ok: false, error: cErr?.message ?? 'No se pudo crear el customer' };
    }
    customerId = newCustomer.id as string;
  }

  // 4. Crear auth user. Dos rutas:
  //    - sendInviteEmail=true → inviteUserByEmail (manda magic link, password vacía).
  //      Path normal del webhook. El user puede entrar por el email O por el form
  //      de activación si todavía está en el browser.
  //    - sendInviteEmail=false → createUser con random password.
  //      Path donde el user va a establecer su contraseña inmediatamente en
  //      la página de activación. Evita ruido de email innecesario.
  let userId: string;
  if (input.sendInviteEmail) {
    const redirectTo = `${process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'https://app.tripdrive.xyz'}/login`;
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      adminEmail,
      {
        data: { full_name: adminName, signup_via: 'landing' },
        redirectTo,
      },
    );
    if (inviteErr || !invited.user) {
      logger.error('provision.invite_failed', {
        admin_email: adminEmail,
        customer_id: customerId,
        err: inviteErr?.message,
      });
      if (!existingCustomer) {
        await admin.from('customers').delete().eq('id', customerId);
      }
      return { ok: false, error: inviteErr?.message ?? 'No se pudo invitar al usuario' };
    }
    userId = invited.user.id;
  } else {
    // Random password segura — el user no la usa, va a establecer su propia
    // password vía /empezar/exito form.
    const randomPassword = `tmp_${crypto.randomUUID()}_${Date.now()}`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: randomPassword,
      email_confirm: true, // No requerimos verificación adicional — ya pagó.
      user_metadata: { full_name: adminName, signup_via: 'landing' },
    });
    if (createErr || !created.user) {
      logger.error('provision.create_user_failed', {
        admin_email: adminEmail,
        customer_id: customerId,
        err: createErr?.message,
      });
      if (!existingCustomer) {
        await admin.from('customers').delete().eq('id', customerId);
      }
      return { ok: false, error: createErr?.message ?? 'No se pudo crear el usuario' };
    }
    userId = created.user.id;
  }

  // 5. Insert user_profile linked al customer.
  const { error: pErr } = await admin.from('user_profiles').insert({
    id: userId,
    customer_id: customerId,
    email: adminEmail,
    full_name: adminName,
    role: 'admin',
    zone_id: null,
    phone: null,
    must_reset_password: true,
    is_active: true,
  });
  if (pErr) {
    logger.error('provision.profile_insert_failed', {
      admin_email: adminEmail,
      customer_id: customerId,
      err: pErr.message,
    });
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (!existingCustomer) {
      await admin.from('customers').delete().eq('id', customerId);
    }
    return { ok: false, error: pErr.message };
  }

  logger.info('provision.signup_provisioned', {
    customer_id: customerId,
    user_id: userId,
    admin_email: adminEmail,
    company: companyName,
    plan,
    invite_email_sent: input.sendInviteEmail,
  });

  return { ok: true, customerId, userId, idempotent: false };
}

/**
 * Convierte "Distribuidora Sol S.A. de C.V." → "distribuidora-sol".
 * Strip diacríticos + spaces → dashes + lowercase. Cap 40 chars.
 */
function slugifyForCustomer(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function findAvailableSlug(
  admin: ReturnType<typeof createServiceRoleClient>,
  base: string,
): Promise<string> {
  const slug = base || `customer-${Date.now()}`;
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix + 1}`;
    const { data } = await admin
      .from('customers')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
