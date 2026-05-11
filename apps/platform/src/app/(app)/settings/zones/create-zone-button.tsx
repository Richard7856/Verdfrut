'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input, Modal, toast } from '@tripdrive/ui';
import { createZoneAction } from './actions';

export function CreateZoneButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Nueva zona
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Nueva zona"
        description="Define el código y nombre de la zona operativa."
      >
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await createZoneAction(formData);
              if (res.ok) {
                toast.success('Zona creada');
                setOpen(false);
              } else {
                setError(res.error ?? 'Error al crear');
              }
            });
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Código" htmlFor="code" required hint="Mayúsculas, ej: CDMX">
            <Input
              id="code"
              name="code"
              required
              maxLength={16}
              autoFocus
              disabled={pending}
            />
          </Field>
          <Field label="Nombre" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              required
              maxLength={80}
              disabled={pending}
              hasError={!!error}
            />
          </Field>
          {error && (
            <p className="text-sm text-[var(--color-danger-fg)]">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={pending}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
