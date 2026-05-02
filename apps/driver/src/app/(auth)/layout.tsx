// Layout del grupo (auth) — login fullscreen centrado, sin sidebar.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--vf-bg)] p-4 safe-top safe-bottom">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
