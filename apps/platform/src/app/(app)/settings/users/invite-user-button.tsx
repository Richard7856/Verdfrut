'use client';

import { useRef, useState, useTransition } from 'react';
import { Button, Field, Input, Modal, Select, toast } from '@tripdrive/ui';
import type { UserRole, Zone } from '@tripdrive/types';
import { inviteUserAction } from './actions';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Administrador (acceso total)' },
  { value: 'dispatcher', label: 'Logística (crea y publica rutas)' },
  { value: 'zone_manager', label: 'Encargado de zona (supervisa choferes)' },
  { value: 'driver', label: 'Chofer (ejecuta rutas)' },
];

// ADR-111: contexto de billing para el overage warning.
export interface SeatsContext {
  tier: 'starter' | 'pro' | 'enterprise';
  adminSeats: number;
  driverSeats: number;
  minAdmins: number;
  minDrivers: number;
  extraAdminCostMxn: number;
  extraDriverCostMxn: number;
  hasActiveSubscription: boolean;
}

const TIER_LABELS: Record<SeatsContext['tier'], string> = {
  starter: 'Operación',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const fmtMxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

/**
 * Calcula si invitar a un usuario en `role` excederá el mínimo incluido del
 * tier. Devuelve los datos para renderizar el warning, o null si no hay cobro
 * extra (rol no facturable, dentro del mínimo, sin subscription activa).
 */
function computeOverage(
  ctx: SeatsContext | null,
  role: UserRole,
): { kind: 'admin' | 'driver'; futureCount: number; min: number; costMxn: number } | null {
  if (!ctx || !ctx.hasActiveSubscription) return null;
  if (role === 'zone_manager') return null;
  if (role === 'driver') {
    const future = ctx.driverSeats + 1;
    if (future <= ctx.minDrivers) return null;
    return {
      kind: 'driver',
      futureCount: future,
      min: ctx.minDrivers,
      costMxn: ctx.extraDriverCostMxn,
    };
  }
  // admin / dispatcher → mismo bucket de seats.
  const future = ctx.adminSeats + 1;
  if (future <= ctx.minAdmins) return null;
  return {
    kind: 'admin',
    futureCount: future,
    min: ctx.minAdmins,
    costMxn: ctx.extraAdminCostMxn,
  };
}

export function InviteUserButton({
  zones,
  seatsContext = null,
}: {
  zones: Zone[];
  seatsContext?: SeatsContext | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>('dispatcher');
  // Después del success, en vez de cerrar, mostramos el invite link copiable
  // (caso C: chofer sin email funcional, admin lo manda por WhatsApp).
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const activeZones = zones.filter((z) => z.isActive);
  const requiresZone = role === 'zone_manager' || role === 'driver';
  const showLicense = role === 'driver';

  function reset() {
    setError(null);
    setInviteLink(null);
    setRole('dispatcher');
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('Link copiado');
    } catch {
      // Fallback: seleccionar el texto del input.
      linkInputRef.current?.select();
      toast.info('Copia manualmente con Ctrl+C / Cmd+C');
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Invitar usuario
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (pending) return;
          setOpen(false);
          // Pequeño delay para que el reset no parpadee mientras cierra.
          setTimeout(reset, 200);
        }}
        title={inviteLink ? 'Invitación enviada' : 'Invitar usuario'}
        description={
          inviteLink
            ? 'El email salió. Si el usuario no lo recibe (spam, sin email funcional), copia este link y mándaselo por WhatsApp.'
            : 'Recibirá un email con un link para crear su contraseña.'
        }
        size="lg"
      >
        {inviteLink ? (
          <div className="flex flex-col gap-4">
            <Field label="Link de invitación (válido por 24 h)" htmlFor="invite-link">
              <div className="flex gap-2">
                <Input
                  ref={linkInputRef}
                  id="invite-link"
                  readOnly
                  value={inviteLink}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="primary" onClick={copyLink}>
                  Copiar
                </Button>
              </div>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setTimeout(reset, 200);
                }}
              >
                Cerrar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  reset();
                }}
              >
                Invitar a otro
              </Button>
            </div>
          </div>
        ) : (
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await inviteUserAction(formData);
              if (res.ok) {
                toast.success('Invitación enviada');
                if (res.inviteLink) {
                  setInviteLink(res.inviteLink);
                } else {
                  // Sin link — solo cerramos.
                  setOpen(false);
                  setTimeout(reset, 200);
                }
              } else {
                setError(res.error ?? 'Error al invitar');
              }
            });
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Field label="Email" htmlFor="email" required>
            <Input id="email" name="email" type="email" required maxLength={120} autoFocus disabled={pending} />
          </Field>
          <Field label="Nombre completo" htmlFor="full_name" required>
            <Input id="full_name" name="full_name" required maxLength={120} disabled={pending} />
          </Field>

          <Field label="Rol" htmlFor="role" required>
            <Select
              id="role"
              name="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={pending}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={requiresZone ? 'Zona' : 'Zona (opcional)'}
            htmlFor="zone_id"
            required={requiresZone}
          >
            <Select id="zone_id" name="zone_id" required={requiresZone} disabled={pending}>
              <option value="">{requiresZone ? 'Selecciona zona…' : 'Sin zona específica'}</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Teléfono (opcional)" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" maxLength={24} disabled={pending} />
          </Field>

          {showLicense && (
            <Field label="Número de licencia" htmlFor="license_number">
              <Input id="license_number" name="license_number" maxLength={60} disabled={pending} />
            </Field>
          )}

          {error && (
            <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
              {error}
            </div>
          )}

          {/* ADR-111: overage warning si esta invitación excederá el mínimo
              incluido del tier. NO bloquea — el admin decide; solo le da
              visibilidad del cobro extra antes de mandar el invite. */}
          {(() => {
            const ov = computeOverage(seatsContext, role);
            if (!ov) return null;
            const seatLabel = ov.kind === 'driver' ? 'chofer' : 'usuario administrativo';
            const ordinal = `#${ov.futureCount}`;
            return (
              <div
                className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-warning-border,#f59e0b)] bg-[var(--color-warning-bg,#fef3c7)] px-3 py-2 text-sm"
                style={{ color: 'var(--color-warning-fg, #92400e)' }}
                role="status"
              >
                <p className="font-medium">
                  ⚠️ Este será tu {seatLabel} {ordinal} (incluidos: {ov.min}).
                </p>
                <p className="mt-1 text-[12.5px]">
                  Costo extra: <strong>{fmtMxn.format(ov.costMxn)} / mes</strong> en tu
                  plan {TIER_LABELS[seatsContext!.tier]}. Stripe aplica proration
                  proporcional a los días que queden del ciclo actual.
                </p>
              </div>
            );
          })()}

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={pending}>
              Enviar invitación
            </Button>
          </div>
        </form>
        )}
      </Modal>
    </>
  );
}
