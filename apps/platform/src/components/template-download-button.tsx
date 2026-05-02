'use client';

// Botón "Descargar plantilla CSV" para cada entidad bulk-importable.
// Apunta a /api/templates/[entity] que devuelve un CSV con headers y ejemplos.

import { Button } from '@verdfrut/ui';

type Entity = 'stores' | 'vehicles' | 'users' | 'depots';

const LABELS: Record<Entity, string> = {
  stores: 'Plantilla tiendas',
  vehicles: 'Plantilla camiones',
  users: 'Plantilla usuarios',
  depots: 'Plantilla CEDIS',
};

export function TemplateDownloadButton({ entity }: { entity: Entity }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="md"
      onClick={() => {
        // Forzar descarga vía window.location: el server responde con
        // Content-Disposition: attachment.
        window.location.href = `/api/templates/${entity}`;
      }}
    >
      ↓ {LABELS[entity]}
    </Button>
  );
}
