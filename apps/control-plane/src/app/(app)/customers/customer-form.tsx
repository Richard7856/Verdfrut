'use client';

// Form compartido para crear y editar customer — Fase A2.3 + ADR-095.
// El slug es read-only en modo 'edit' (cambiar slug rompería subdominios
// existentes — issue #232 si se necesita rename con redirect).
//
// ADR-095: agregamos sección "Features" con toggles 3-estado (default/on/off)
// para overrides por customer. Default = hereda del tier.

import { useState, useTransition } from 'react';
import { Field, Input, Textarea, Select, Button } from '@tripdrive/ui';
import {
  PLAN_FEATURES,
  PLAN_LABELS,
  PLAN_PRICING_MXN,
  TOGGLEABLE_FEATURE_KEYS,
  type FeatureKey,
  type PlanFeatures,
} from '@tripdrive/plans';
import type { Customer, CustomerStatus, CustomerTier } from '@/lib/queries/customers';

type Mode = 'create' | 'edit';

interface CustomerFormProps {
  mode: Mode;
  initial?: Customer;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string; field?: string }>;
}

const STATUS_OPTIONS: Array<{ value: CustomerStatus; label: string }> = [
  { value: 'demo', label: 'Demo (sin facturación)' },
  { value: 'active', label: 'Activo (paga + features habilitadas)' },
  { value: 'paused', label: 'Pausado (contrato congelado · sin features)' },
  { value: 'churned', label: 'Churned (cancelado · sin features)' },
];

const TIER_OPTIONS: Array<{ value: CustomerTier; label: string }> = [
  {
    value: 'starter',
    label: `${PLAN_LABELS.starter} · $${PLAN_PRICING_MXN.starter.perAdmin.toLocaleString('es-MX')}/admin + $${PLAN_PRICING_MXN.starter.perDriver}/chofer · sin AI`,
  },
  {
    value: 'pro',
    label: `${PLAN_LABELS.pro} · $${PLAN_PRICING_MXN.pro.perAdmin.toLocaleString('es-MX')}/admin + $${PLAN_PRICING_MXN.pro.perDriver}/chofer · AI ilimitado`,
  },
  {
    value: 'enterprise',
    label: `${PLAN_LABELS.enterprise} · desde $${PLAN_PRICING_MXN.enterprise.perAdmin.toLocaleString('es-MX')}/admin + $${PLAN_PRICING_MXN.enterprise.perDriver}/chofer · dominio propio`,
  },
];

const FEATURE_LABELS: Record<FeatureKey, string> = {
  ai: 'Asistente AI (orquestador con 19 herramientas)',
  maxAiSessionsPerMonth: 'Sesiones AI por mes (numeric)',
  maxAiWritesPerMonth: 'Acciones AI write por mes (numeric)',
  maxAccounts: 'Cuentas operativas (numeric)',
  maxStoresPerAccount: 'Tiendas por cuenta (numeric)',
  customDomain: 'Dominio propio del cliente (app.empresa.com)',
  customBranding: 'Branding personalizado (logo, colores)',
  xlsxImport: 'Import XLSX/CSV vía chat',
  dragEditMap: 'Mapa interactivo · drag-to-edit',
  pushNotifications: 'Push notifications · web + Android',
  liveReOpt: 'Re-optimización en vivo de rutas',
};

export function CustomerForm({ mode, initial, action }: CustomerFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // tier live: cuando admin cambia el tier, los "defaults" de la sección
  // Features actualizan al vuelo para que se vea qué va a heredar.
  const [selectedTier, setSelectedTier] = useState<CustomerTier>(
    initial?.tier ?? 'starter',
  );

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
            <Select
              id="tier"
              name="tier"
              defaultValue={initial?.tier ?? 'starter'}
              onChange={(e) => setSelectedTier(e.target.value as CustomerTier)}
            >
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

      <Section title="Features (overrides)">
        <p className="mb-4 text-xs text-[var(--color-text-muted)]">
          Cada feature se hereda del tier <strong>{PLAN_LABELS[selectedTier]}</strong> a menos que la sobrescribas aquí.
          Usa <em>default</em> para mantener el comportamiento del plan, <em>on</em>/<em>off</em> para overrides puntuales (ej. regalar AI a un Operación en piloto).
        </p>
        <div className="space-y-3">
          {TOGGLEABLE_FEATURE_KEYS.map((key) => {
            const inheritedDefault = PLAN_FEATURES[selectedTier][key] as boolean;
            const override = initial?.featureOverrides?.[key] as boolean | undefined;
            const currentValue: 'default' | 'true' | 'false' =
              override === true ? 'true' : override === false ? 'false' : 'default';
            return (
              <FeatureOverrideRow
                key={String(key)}
                featureKey={key}
                label={FEATURE_LABELS[key]}
                inherited={inheritedDefault}
                initialValue={currentValue}
              />
            );
          })}
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

/**
 * Renderiza un toggle 3-estado para una feature.
 *
 * Genera 3 radios con el mismo `name="override_<key>"` y values
 * `''` (default), `'true'` y `'false'`. La action lee la value y
 * decide si escribe al jsonb o lo omite.
 */
function FeatureOverrideRow({
  featureKey,
  label,
  inherited,
  initialValue,
}: {
  featureKey: FeatureKey;
  label: string;
  inherited: boolean;
  initialValue: 'default' | 'true' | 'false';
}) {
  const name = `override_${String(featureKey)}`;
  const inheritedLabel = inherited ? 'on' : 'off';
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex-1">
        <div className="text-sm font-medium text-[var(--color-text)]">{label}</div>
        <div className="text-xs text-[var(--color-text-muted)]">
          Default del tier: <strong>{inheritedLabel}</strong>
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <RadioOption name={name} value="" label="default" defaultChecked={initialValue === 'default'} />
        <RadioOption name={name} value="true" label="on" defaultChecked={initialValue === 'true'} />
        <RadioOption name={name} value="false" label="off" defaultChecked={initialValue === 'false'} />
      </div>
    </div>
  );
}

function RadioOption({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  const id = `${name}-${value || 'default'}`;
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1.5">
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="h-4 w-4 cursor-pointer accent-[var(--color-accent,#34c97c)]"
      />
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
    </label>
  );
}
