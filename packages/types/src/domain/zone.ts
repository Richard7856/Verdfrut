// Zona geográfica dentro de un cliente (CDMX, Monterrey, etc.).
// Las RLS policies filtran por zone_id según el zone_id del usuario autenticado.

export interface Zone {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}
