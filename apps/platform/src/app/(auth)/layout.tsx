// Layout para rutas de autenticación (login). Sin sidebar, centered.
// El middleware deja /login pasar sin sesión.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-muted)] px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
