// Preview de "Multi-cliente" — UI shell sin BD aún.
//
// Esta data es ESTÁTICA, hardcoded, para mostrar la visión del feature en
// la presentación del 2026-05-12 sin tocar el modelo de datos actual.
// Cuando se construya Phase 1 real (tabla `customers` + FK en stores/dispatches),
// este archivo se reemplaza por queries reales.
//
// Reglas mientras esto sea preview:
//   1. NO referenciar desde queries server-side de operación real (stores,
//      dispatches, routes). El módulo es solo para `/customers/*`.
//   2. Banner visible "En desarrollo · datos de muestra" en cada página que
//      consuma esta data, para que el admin sepa qué es real y qué es mockup.
//   3. NETO real: count de stores y KPIs vienen de BD (no inventados).
//   4. OXXO preview: 100% mockup, marcado isPreview=true.

export interface CustomerPreview {
  id: string;
  code: string;
  name: string;
  /** Iniciales para el avatar (2 letras). */
  initials: string;
  /** Color del avatar (Tailwind class o hex). */
  accentHex: string;
  /** Si es preview (mockup) o cliente real con operación. */
  isPreview: boolean;
  status: 'active' | 'onboarding' | 'inactive';
  contactName?: string;
  contactEmail?: string;
  contractStart?: string;
  /** Datos resumen — para NETO se sobrescriben con valores reales en server side. */
  mockMetrics?: {
    storeCount: number;
    dispatchesThisMonth: number;
    deliveriesThisMonth: number;
    onTimeRate: number; // 0-100
    avgKmPerRoute: number;
  };
}

export const CUSTOMERS_PREVIEW: CustomerPreview[] = [
  {
    id: 'neto-real',
    code: 'NETO',
    name: 'NETO Tiendas',
    initials: 'NT',
    accentHex: '#16a34a',
    isPreview: false, // operación real — métricas se sobrescriben desde BD
    status: 'active',
    contactName: 'Por confirmar',
    contactEmail: 'compras@neto.example',
    contractStart: '2026-04-01',
    mockMetrics: {
      storeCount: 0, // se sobreescribe server-side
      dispatchesThisMonth: 0,
      deliveriesThisMonth: 0,
      onTimeRate: 0,
      avgKmPerRoute: 0,
    },
  },
  {
    id: 'oxxo-preview',
    code: 'OXXO',
    name: 'OXXO Distribución',
    initials: 'OX',
    accentHex: '#dc2626',
    isPreview: true,
    status: 'onboarding',
    contactName: 'Demo · cliente potencial',
    contactEmail: 'pendiente@oxxo.example',
    mockMetrics: {
      storeCount: 142,
      dispatchesThisMonth: 38,
      deliveriesThisMonth: 4720,
      onTimeRate: 91.4,
      avgKmPerRoute: 86.5,
    },
  },
  {
    id: 'bimbo-preview',
    code: 'BIMBO',
    name: 'Bimbo Distribución (ejemplo)',
    initials: 'BB',
    accentHex: '#2563eb',
    isPreview: true,
    status: 'inactive',
    contactName: 'Lead frío',
    mockMetrics: {
      storeCount: 230,
      dispatchesThisMonth: 0,
      deliveriesThisMonth: 0,
      onTimeRate: 0,
      avgKmPerRoute: 0,
    },
  },
];

export function getCustomerPreview(id: string): CustomerPreview | null {
  return CUSTOMERS_PREVIEW.find((c) => c.id === id) ?? null;
}
