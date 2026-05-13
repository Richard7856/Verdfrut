'use client';

// Form compartido para crear y editar customer — Fase A2.3.
// El slug es read-only en modo 'edit' (cambiar slug rompería subdominios
// existentes — issue #232 si se necesita rename con redirect).

import { useState, useTransition } from 'react';
import { Field, Input, Textarea, Select, Button } from '@tripdrive/ui';
import type { Customer, CustomerStatus, CustomerTier } from '@/lib/queries/customers';

type Mode = 'create' | 'edit';

interface CustomerFormProps {
  mode: Mode;
  initial?: Customer;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string; field?: string }>;
}

const STATUS_OPTIONS: Array<{ value: CustomerStatus; label: string }> = [
  { value: 'demo', label: 'Demo (sin facturación)' },
  { value: 'active', label: 'Activo (operando)' },
  { value: 'paused', label: 'Pausado (contrato congelado)' },
  { value: 'churned', label: 'Churned (cancelado)' },
];

const TIER_OPTIONS: Array<{ value: CustomerTier; label: string }> = [
  { value: 'starter', label: 'Starter (1-10 choferes)' },
  { value: 'pro', label: 'Pro (11-50 choferes)' },
  { value: 'enterprise', label: 'Enterprise (50+, BD aislada)' },
];

export function CustomerForm({ mode, initial, action }: CustomerFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok && result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--color-danger-border,#fecaca)] bg-[var(--color-danger-bg,#fef2f2)] p-3 text-sm text-[var(--color-danger,#991b1b)]"
        >
          {error}
        </div>
      )}

      <Section title="Identidad">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Slug (subdominio)"
            htmlFor="slug"
            required
            hint={
              mode === 'create'
                ? 'lowercase, alfanumérico + guiones, 2-40 chars. Será el subdomain (slug.tripdrive.xyz). No se puede cambiar después.'
                : 'Inmutable post-creación.'
            }
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={initial?.slug ?? ''}
              required={mode === 'create'}
              readOnly={mode === 'edit'}
              pattern="[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?"
              placeholder="oxxo"
              autoComplete="off"
            />
          </Field>

          <Field label="Nombre comercial" htmlFor="name" required>
            <Input id="name" name="name" defaultValue={initial?.name ?? ''} required />
          </Field>

          <Field label="Razón social (CFDI)" htmlFor="legalName">
            <Input id="legalName" name="legalName" defaultValue={initial?.legalName ?? ''} />
          </Field>

          <Field label="RFC" htmlFor="rfc">
            <Input
              id="rfc"
              name="rfc"
              defaultValue={initial?.rfc ?? ''}
              maxLength={13}
              placeholder="ABC123456ABC"
              style={{ textTransform: 'uppercase' }}
            />
          </Field>
        </div>
      </Section>

      <Section title="Comercial">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Estado" htmlFor="status" required>
            <Select id="status" name="status" defaultValue={initial?.status ?? 'demo'}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tier" htmlFor="tier" required>
            <Select id="tier" name="tier" defaultValue={initial?.tier ?? 'starter'}>
              {TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="MRR contratado (MXN)" htmlFor="monthlyFeeMxn">
            <Input
              id="monthlyFeeMxn"
              name="monthlyFeeMxn"
              type="number"
              min={0}
              step={500}
              defaultValue={initial?.monthlyFeeMxn ?? ''}
              placeholder="3500"
            />
          </Field>

          <Field
            label="Fee por chofer (MXN/mes)"
            htmlFor="perDriverFeeMxn"
            hint="Sólo se aplica a choferes sobre el incluido del tier"
          >
            <Input
              id="perDriverFeeMxn"
              name="perDriverFeeMxn"
              type="number"
              min={0}
              step={50}
              defaultValue={initial?.perDriverFeeMxn ?? ''}
              placeholder="400"
            />
          </Field>

          <Field label="Contrato desde" htmlFor="contractStartedAt">
            <Input
              id="contractStartedAt"
              name="contractStartedAt"
              type="date"
              defaultValue={initial?.contractStartedAt ?? ''}
            />
          </Field>

          <Field label="Contrato termina" htmlFor="contractEndsAt">
            <Input
              id="contractEndsAt"
              name="contractEndsAt"
              type="date"
              defaultValue={initial?.contractEndsAt ?? ''}
            />
          </Field>
        </div>
      </Section>

      <Section title="Branding & operación">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Timezone" htmlFor="timezone" hint="IANA tz format">
            <Input
              id="timezone"
              name="timezone"
              defaultValue={initial?.timezone ?? 'America/Mexico_City'}
              placeholder="America/Mexico_City"
            />
          </Field>

          <Field label="Color primario (hex)" htmlFor="brandColorPrimary">
            <Input
              id="brandColorPrimary"
              name="brandColorPrimary"
              type="text"
              pattern="#[0-9a-fA-F]{6}"
              defaultValue={initial?.brandColorPrimary ?? '#34c97c'}
              placeholder="#34c97c"
            />
          </Field>

          <Field label="Logo URL" htmlFor="brandLogoUrl" className="md:col-span-2">
            <Input
              id="brandLogoUrl"
              name="brandLogoUrl"
              type="url"
              defaultValue={initial?.brandLogoUrl ?? ''}
              placeholder="https://..."
            />
          </Field>
        </div>
      </Section>

      <Section title="Notas internas">
        <Field
          label="Notas"
          htmlFor="notes"
          hint="Visible sólo en Control Plane. No se muestra a usuarios del customer."
        >
          <Textarea id="notes" name="notes" rows={4} defaultValue={initial?.notes ?? ''} />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] pt-4">
        <Button type="submit" disabled={pending}>
          {pending
            ? 'Guardando…'
            : mode === 'create'
              ? 'Crear customer'
              : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
