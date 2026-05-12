'use client';

// Selector inline para asignar/reasignar chofer a una ruta.
//
// Estados:
//  - DRAFT/OPTIMIZED/APPROVED → edición libre con assignDriverAction.
//  - PUBLISHED/IN_PROGRESS → reasignación con confirmación + reassignDriverPostPublishAction
//    (#35: chofer enfermo o no disponible último momento; audit + push al nuevo).
//  - COMPLETED/CANCELLED/INTERRUPTED → read-only.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, toast } from '@tripdrive/ui';
import type { Driver, Route, UserProfile } from '@tripdrive/types';
import { assignDriverAction, reassignDriverPostPublishAction } from '../actions';

interface DriverWithProfile {
  driver: Driver;
  profile: UserProfile;
}

interface Props {
  route: Route;
  /** Chofer actual (si lo hay) — Driver row + UserProfile para mostrar nombre. */
  currentDriver: DriverWithProfile | null;
  /** Lista de choferes disponibles en la zona de la ruta, activos. */
  availableDrivers: DriverWithProfile[];
}

export function DriverAssignment({ route, currentDriver, availableDrivers }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(currentDriver?.driver.id ?? '');

  const editable = ['DRAFT', 'OPTIMIZED', 'APPROVED'].includes(route.status);
  // #35 — En PUBLISHED/IN_PROGRESS permitimos reasignar (con confirm + audit + push).
  const reassignable = ['PUBLISHED', 'IN_PROGRESS'].includes(route.status);

  function save() {
    startTransition(async () => {
      const newDriverId = selectedId === '' ? null : selectedId;

      // Post-publish: exigir chofer (no permitir desasignar) y confirmar.
      if (reassignable) {
        if (!newDriverId) {
          toast.error(
            'Falta chofer',
            'En rutas publicadas/en curso debes elegir un chofer — para "sin chofer" hay que cancelar la ruta.',
          );
          return;
        }
        const newName =
          availableDrivers.find((d) => d.driver.id === newDriverId)?.profile.fullName ?? newDriverId;
        const ok = confirm(
          `Reasignar la ruta a ${newName}.\n\n` +
            `• Se notificará al nuevo chofer por push.\n` +
            `• Quedará registrado en el audit (route_versions).\n` +
            `• El chofer anterior seguirá viendo la ruta hasta que recargue.\n\n` +
            `¿Continuar?`,
        );
        if (!ok) return;

        const res = await reassignDriverPostPublishAction(route.id, newDriverId);
        if (res.ok) {
          toast.success('Chofer reasignado', `Push enviado a ${newName}`);
          setEditing(false);
          router.refresh();
        } else {
          toast.error('Error al reasignar', res.error);
        }
        return;
      }

      const res = await assignDriverAction(route.id, newDriverId);
      if (res.ok) {
        toast.success(newDriverId ? 'Chofer asignado' : 'Chofer removido');
        setEditing(false);
        router.refresh();
      } else {
        toast.error('Error al asignar', res.error);
      }
    });
  }

  function cancel() {
    setSelectedId(currentDriver?.driver.id ?? '');
    setEditing(false);
  }

  // Read-only: estados terminales (COMPLETED/CANCELLED/INTERRUPTED) — sin "Cambiar".
  if (!editable && !reassignable) {
    return (
      <div className="flex items-center justify-between text-sm">
        <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Chofer
        </dt>
        <dd
          className="font-mono text-[12.5px] tabular-nums"
          style={{ color: 'var(--color-text)' }}
        >
          {currentDriver?.profile.fullName ?? <em>sin asignar</em>}
        </dd>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Chofer
        </dt>
        <dd className="flex items-center gap-2 text-right">
          <span
            className="font-mono text-[12.5px] tabular-nums"
            style={{
              color: currentDriver
                ? 'var(--color-text)'
                : 'var(--color-text-muted)',
            }}
          >
            {currentDriver?.profile.fullName ?? <em>sin asignar</em>}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
          >
            {currentDriver ? 'Cambiar' : 'Asignar'}
          </button>
        </dd>
      </div>
    );
  }

  // Modo edición.
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Chofer
      </dt>
      <Select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={pending}
      >
        {/* En reasignación post-publish (#35) no permitimos desasignar — la ruta
            necesita chofer; para "sin chofer" la opción correcta es cancelar la ruta. */}
        {!reassignable && <option value="">— Sin asignar —</option>}
        {reassignable && !selectedId && <option value="">— Selecciona chofer —</option>}
        {availableDrivers.map((d) => (
          <option key={d.driver.id} value={d.driver.id}>
            {d.profile.fullName}
            {d.profile.phone ? ` · ${d.profile.phone}` : ''}
          </option>
        ))}
      </Select>
      {reassignable && (
        <p className="text-[11px]" style={{ color: 'var(--color-warning-fg)' }}>
          ⚠️ Reasignación post-publish: el chofer nuevo recibirá push y queda registrado en el audit.
        </p>
      )}
      {availableDrivers.length === 0 && (
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          Sin choferes activos en esta zona. Crea uno en /settings/users.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" onClick={save} isLoading={pending}>
          Guardar
        </Button>
      </div>
    </div>
  );
}
