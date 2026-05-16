'use client';

// Toolbar superior de las vistas /print/* — solo visible en pantalla.
// El @media print en globals.css la oculta para que el PDF salga limpio.

export function PrintToolbar() {
  return (
    <div className="print-toolbar">
      <button
        type="button"
        onClick={() => window.print()}
        className="print-toolbar-btn"
      >
        🖨️ Imprimir / Guardar PDF
      </button>
      <p className="print-toolbar-hint">
        En el diálogo de impresión: elige <strong>Guardar como PDF</strong> para
        un archivo. Recomendado: tamaño Carta, márgenes mínimos, sin encabezados
        ni pies de página del navegador.
      </p>
    </div>
  );
}
