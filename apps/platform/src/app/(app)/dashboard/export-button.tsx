'use client';

// Botón "Exportar XLSX" en el header del dashboard — Sprint 16.
//
// Recibe los filtros resueltos como props (server ya aplicó defaults — últimos 30d, etc.)
// para que el primer render no tenga que esperar searchParams del cliente.
// Permite override si el user cambia los filtros sin recargar.
//
// No usamos fetch + blob porque el endpoint es GET protegido por cookie de sesión —
// abrir la URL directamente respeta las cookies y permite manejar errores 4xx
// como una página de error en la nueva pestaña, sin código adicional.

import { useSearchParams } from 'next/navigation';
import { Button } from '@verdfrut/ui';

interface Props {
  defaultFrom: string;
  defaultTo: string;
  defaultZone?: string | null;
}

export function ExportButton({ defaultFrom, defaultTo, defaultZone }: Props) {
  const params = useSearchParams();
  const from = params.get('from') || defaultFrom;
  const to = params.get('to') || defaultTo;
  const zone = params.get('zone') || defaultZone || '';

  function handleExport() {
    const qs = new URLSearchParams();
    qs.set('from', from);
    qs.set('to', to);
    if (zone) qs.set('zone', zone);
    window.open(`/api/export/tickets?${qs.toString()}`, '_blank');
  }

  return (
    <Button
      type="button"
      variant="primary"
      onClick={handleExport}
      title="Descargar XLSX para ERP / Sheets"
    >
      ↓ Exportar XLSX
    </Button>
  );
}
