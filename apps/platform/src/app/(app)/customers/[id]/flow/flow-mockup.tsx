// Mockup visual del flow del chofer — para que los socios vean qué hace
// la app sin instalarla. NO conectado a Supabase: HTML estilizado que
// representa cada una de las 7 pantallas canónicas del flow Entrega.

interface ScreenMock {
  id: string;
  num: number;
  title: string;
  subtitle: string;
  body: React.ReactNode;
  primaryCta: string;
  secondaryCta?: string;
}

const ENTREGA_SCREENS: ScreenMock[] = [
  {
    id: 'arrival_exhibit',
    num: 1,
    title: 'Llegaste a la tienda',
    subtitle: 'Foto del exhibidor',
    body: (
      <>
        <CameraFrame label="Foto exhibidor" />
        <Hint>El chofer debe estar a menos del radio configurado (300 m por default).</Hint>
      </>
    ),
    primaryCta: 'Tomar foto',
  },
  {
    id: 'incident_check',
    num: 2,
    title: '¿Hay alguna incidencia?',
    subtitle: 'Selección rápida',
    body: (
      <div className="space-y-2">
        <OptionRow label="Sin incidencias" check />
        <OptionRow label="Producto dañado" />
        <OptionRow label="Tienda no recibe" />
        <OptionRow label="Mercancía incompleta" />
      </div>
    ),
    primaryCta: 'Continuar',
    secondaryCta: 'Reportar al supervisor',
  },
  {
    id: 'product_arranged',
    num: 3,
    title: 'Acomoda y confirma',
    subtitle: 'Mercancía en exhibidor',
    body: (
      <>
        <Checklist items={['Producto en exhibidor', 'Acomodo según planograma', 'Rotación FIFO']} />
        <Hint>El chofer marca cada paso antes de continuar.</Hint>
      </>
    ),
    primaryCta: 'Confirmar acomodo',
  },
  {
    id: 'waste_check',
    num: 4,
    title: 'Validación de merma',
    subtitle: '¿Hay producto caducado?',
    body: (
      <div className="space-y-2">
        <OptionRow label="Sin merma" check />
        <OptionRow label="Hay merma — registrar" />
      </div>
    ),
    primaryCta: 'Continuar',
  },
  {
    id: 'receipt_check',
    num: 5,
    title: 'Subir ticket',
    subtitle: 'OCR con Claude Vision',
    body: (
      <>
        <CameraFrame label="Foto ticket" />
        <Hint>El sistema extrae automáticamente folio, fecha, total con AI.</Hint>
      </>
    ),
    primaryCta: 'Tomar foto del ticket',
    secondaryCta: 'No hay ticket — explicar',
  },
  {
    id: 'other_incident_check',
    num: 6,
    title: '¿Algo más?',
    subtitle: 'Cualquier otra incidencia',
    body: (
      <div className="space-y-2">
        <OptionRow label="Todo en orden" check />
        <OptionRow label="Reportar otra incidencia" />
      </div>
    ),
    primaryCta: 'Continuar',
  },
  {
    id: 'finish',
    num: 7,
    title: 'Entrega completada',
    subtitle: 'Resumen + push al supervisor',
    body: (
      <div className="space-y-2 text-center">
        <div
          className="mx-auto grid h-12 w-12 place-items-center rounded-full"
          style={{ background: 'var(--vf-green-500)', color: 'white' }}
        >
          ✓
        </div>
        <p style={{ color: 'var(--vf-text)' }}>Tienda completada</p>
        <p className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
          Push al supervisor + siguiente parada
        </p>
      </div>
    ),
    primaryCta: 'Siguiente tienda',
  },
];

export function FlowMockup() {
  return (
    <div className="-mx-2 overflow-x-auto pb-3">
      <div className="flex min-w-max gap-4 px-2">
        {ENTREGA_SCREENS.map((s, idx) => (
          <div key={s.id} className="flex items-center gap-2">
            <PhoneFrame screen={s} />
            {idx < ENTREGA_SCREENS.length - 1 && (
              <span
                className="self-center text-2xl"
                style={{ color: 'var(--vf-text-faint)' }}
                aria-hidden
              >
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PhoneFrame({ screen }: { screen: ScreenMock }) {
  return (
    <div
      className="flex w-[240px] flex-col rounded-[24px] border p-[10px] shadow-md"
      style={{
        background: 'color-mix(in oklch, var(--vf-bg) 50%, black 50%)',
        borderColor: 'color-mix(in oklch, var(--vf-bg) 70%, white 20%)',
      }}
    >
      <div
        className="flex h-[440px] flex-col rounded-[16px] p-3"
        style={{ background: 'var(--vf-surface-1)' }}
      >
        {/* Step badge */}
        <div className="mb-2 flex items-center justify-between">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background: 'var(--vf-green-500)',
              color: 'white',
            }}
          >
            {screen.num} / {ENTREGA_SCREENS.length}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--vf-text-faint)' }}>
            Tienda TOL-1422
          </span>
        </div>

        {/* Title */}
        <h4 className="text-[13px] font-semibold" style={{ color: 'var(--vf-text)' }}>
          {screen.title}
        </h4>
        <p className="mb-2 text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
          {screen.subtitle}
        </p>

        {/* Body */}
        <div className="flex-1 overflow-hidden">{screen.body}</div>

        {/* CTAs */}
        <div className="mt-2 space-y-1.5">
          <div
            className="rounded-md py-2 text-center text-[12px] font-semibold"
            style={{ background: 'var(--vf-green-500)', color: 'white' }}
          >
            {screen.primaryCta}
          </div>
          {screen.secondaryCta && (
            <div
              className="rounded-md border py-1.5 text-center text-[11px]"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--vf-text-mute)',
              }}
            >
              {screen.secondaryCta}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CameraFrame({ label }: { label: string }) {
  return (
    <div
      className="my-2 grid h-28 w-full place-items-center rounded-md border-2 border-dashed"
      style={{
        borderColor: 'var(--color-border)',
        background: 'color-mix(in oklch, var(--vf-bg) 90%, black 5%)',
      }}
    >
      <div className="text-center">
        <div className="mx-auto text-2xl">📷</div>
        <p className="text-[10px]" style={{ color: 'var(--vf-text-mute)' }}>
          {label}
        </p>
      </div>
    </div>
  );
}

function OptionRow({ label, check }: { label: string; check?: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded border px-2 py-1.5 text-[11px]"
      style={{
        borderColor: 'var(--color-border)',
        background: check ? 'color-mix(in oklch, var(--vf-bg) 80%, var(--vf-green-500) 20%)' : 'transparent',
        color: 'var(--vf-text)',
      }}
    >
      <span
        className="grid h-3 w-3 place-items-center rounded-full"
        style={{
          background: check ? 'var(--vf-green-500)' : 'transparent',
          border: check ? 'none' : '1px solid var(--color-border)',
          color: 'white',
          fontSize: '8px',
        }}
      >
        {check && '✓'}
      </span>
      <span>{label}</span>
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <div className="my-2 space-y-1.5">
      {items.map((it) => (
        <OptionRow key={it} label={it} check />
      ))}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-2 text-[10px] leading-snug"
      style={{ color: 'var(--vf-text-faint)' }}
    >
      ℹ️ {children}
    </p>
  );
}

