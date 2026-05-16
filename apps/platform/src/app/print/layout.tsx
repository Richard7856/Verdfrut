// Layout mínimo para vistas imprimibles (PDF via "Guardar como PDF" del navegador).
// NO renderiza sidebar/topbar/floating chat — solo el contenido print-friendly y
// un botón flotante "Imprimir" que dispara window.print() y al volver del diálogo
// queda en el modo normal. Toda página dentro de /print/* hereda este layout.

import { requireRole } from '@/lib/auth';
import { PrintToolbar } from './print-toolbar';

export const metadata = { title: 'Layout para imprimir' };

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  // Auth gate — los datos sensibles de tiros/rutas requieren rol operativo.
  // Si en el futuro queremos compartir con almacenistas via link público, mover
  // a un share-token model como /share/dispatch/[token].
  await requireRole('admin', 'dispatcher', 'zone_manager');
  return (
    <div className="print-shell">
      <PrintToolbar />
      <main className="print-page">{children}</main>
    </div>
  );
}
