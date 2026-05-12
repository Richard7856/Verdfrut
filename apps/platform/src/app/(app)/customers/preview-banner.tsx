// Banner visible en cada página de /customers/* mientras la feature está en
// shell-only (sin BD). Hace explícito al admin que esto es una vista previa.

export function PreviewBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius-md)] border px-4 py-3 text-sm"
      style={{
        background: 'var(--vf-info-bg)',
        borderColor: 'var(--vf-info-border)',
        color: 'var(--vf-text)',
      }}
      role="status"
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-none" aria-hidden>
          🚧
        </span>
        <div className="flex-1">
          <p className="font-semibold" style={{ color: 'var(--vf-info-fg)' }}>
            Multi-cliente · en desarrollo
          </p>
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--vf-text-mute)' }}>
            {children ??
              'Esta sección es una vista previa del feature multi-cliente. NETO opera con datos reales; los demás son demos para mostrar la visión. La integración completa entra después del piloto.'}
          </p>
        </div>
      </div>
    </div>
  );
}
