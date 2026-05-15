'use client';

// Floating Chat — Stream AI-1 / Phase 1 (2026-05-15 noche).
//
// Botón flotante en cada pantalla del (app) layout. Click → drawer lateral
// con mini-chat. El user puede crear/modificar/optimizar/consultar sin
// salir de la pantalla. El chat sabe en qué pantalla está y opera sobre
// la entidad de la URL.
//
// Scope Phase 1:
//   - Sesión ephimeral (en memoria, no persiste al cerrar drawer ni navegar).
//   - Reusa endpoint /api/orchestrator/chat con campo nuevo `pageContext`.
//   - Confirmaciones soportadas (publish/cancel/reassign requieren approve).
//   - SIN: upload, history multi-sesión, realtime sync UI←→chat.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageContext, shouldHideFloatingChat, type PageContext } from './use-page-context';
import { Markdown } from './markdown';
import { usePathname } from 'next/navigation';

type Role = 'user' | 'assistant' | 'tool';

interface ChatTurn {
  id: string;
  role: Role;
  text?: string;
  thinking?: string;
  toolName?: string;
  toolPending?: boolean;
  toolResult?: { ok: boolean; data?: unknown; error?: string; summary?: string };
}

interface PendingConfirmation {
  tool_use_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  summary: string;
}

export function FloatingChat() {
  const pathname = usePathname() ?? '/';
  const ctx = usePageContext();

  // No mostrar en /orchestrator (ya tiene chat completo) ni en /login.
  if (shouldHideFloatingChat(pathname)) return null;

  return <FloatingChatInner ctx={ctx} />;
}

function FloatingChatInner({ ctx }: { ctx: PageContext }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll al fondo cuando se agregan turns.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  // Reset session cuando cambia la pantalla (cada pantalla = nueva conversación).
  useEffect(() => {
    setTurns([]);
    setSessionId(null);
    setPending(null);
  }, [ctx.path]);

  const send = useCallback(
    async (text: string, confirmation?: { tool_use_id: string; approved: boolean }) => {
      if (!text && !confirmation) return;
      if (text) {
        setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
      }
      setInput('');
      setStreaming(true);
      setPending(null);

      try {
        const res = await fetch('/api/orchestrator/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: text || undefined,
            confirmation,
            pageContext: { path: ctx.path, entities: ctx.entities },
          }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '');
          setTurns((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${errText || res.status}` },
          ]);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentAssistantId: string | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const m = line.match(/^data: (.+)$/);
            if (!m) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(m[1]!);
            } catch {
              continue;
            }

            if (evt.type === 'session' && typeof evt.sessionId === 'string') {
              setSessionId(evt.sessionId);
            } else if (evt.type === 'message_start') {
              currentAssistantId = crypto.randomUUID();
            } else if (evt.type === 'text_delta' && currentAssistantId) {
              const delta = String(evt.delta ?? '');
              const targetId = currentAssistantId;
              setTurns((prev) => {
                const exists = prev.some((t) => t.id === targetId);
                if (exists) {
                  return prev.map((t) =>
                    t.id === targetId ? { ...t, text: (t.text ?? '') + delta } : t,
                  );
                }
                return [...prev, { id: targetId, role: 'assistant', text: delta }];
              });
            } else if (evt.type === 'tool_use_start') {
              const toolId = `tool-${String(evt.tool_use_id)}`;
              setTurns((prev) => [
                ...prev,
                {
                  id: toolId,
                  role: 'tool',
                  toolName: String(evt.tool_name),
                  toolPending: true,
                },
              ]);
            } else if (evt.type === 'tool_use_result') {
              const toolId = `tool-${String(evt.tool_use_id)}`;
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === toolId
                    ? {
                        ...t,
                        toolResult: evt.result as ChatTurn['toolResult'],
                        toolPending: false,
                      }
                    : t,
                ),
              );
            } else if (evt.type === 'confirmation_required') {
              setPending({
                tool_use_id: String(evt.tool_use_id),
                tool_name: String(evt.tool_name),
                args: evt.args as Record<string, unknown>,
                summary: String(evt.summary),
              });
            }
            // message_end, loop_done, role events — ignorados en floating Phase 1
          }
        }
      } catch (err) {
        setTurns((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `Error: ${err instanceof Error ? err.message : 'desconocido'}`,
          },
        ]);
      } finally {
        setStreaming(false);
      }
    },
    [sessionId, ctx.path, ctx.entities],
  );

  const handleConfirm = useCallback(
    (approved: boolean) => {
      if (!pending) return;
      void send('', { tool_use_id: pending.tool_use_id, approved });
    },
    [pending, send],
  );

  // ─── Render ───

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-700"
        title={`Asistente AI · ${ctx.screenLabel}`}
        aria-label="Abrir asistente AI"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[420px] flex-col rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Asistente AI</div>
          <div className="text-xs text-zinc-500">📍 {ctx.screenLabel}</div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-zinc-500 hover:text-zinc-300"
          aria-label="Cerrar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {turns.length === 0 && (
          <div className="rounded-lg bg-zinc-900 p-3 text-xs text-zinc-400">
            👋 Hola. Estás en <span className="text-zinc-200">{ctx.screenLabel}</span>.
            {Object.keys(ctx.entities).length > 0 && (
              <div className="mt-1 text-zinc-500">
                Sé qué entidad estás viendo. Puedes decir "agrega tienda X", "muéstrame opciones",
                etc. y opero directo sobre eso.
              </div>
            )}
            {Object.keys(ctx.entities).length === 0 && (
              <div className="mt-1 text-zinc-500">
                Puedes pedir cualquier acción (crear tiro, listar choferes, etc.).
              </div>
            )}
          </div>
        )}

        {turns.map((t) => (
          <TurnBubble key={t.id} turn={t} />
        ))}

        {streaming && !pending && (
          <div className="text-xs text-zinc-500">…procesando</div>
        )}

        {pending && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3">
            <div className="text-xs font-semibold text-amber-300">
              ⚠️ Confirmar acción destructiva
            </div>
            <div className="mt-1 text-xs text-amber-100">{pending.summary}</div>
            <div className="mt-1 font-mono text-[10px] text-amber-200/70">
              Tool: {pending.tool_name}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => handleConfirm(true)}
                className="flex-1 rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
              >
                Aprobar
              </button>
              <button
                onClick={() => handleConfirm(false)}
                className="flex-1 rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Rechazar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || streaming || pending) return;
            void send(input.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming || pending != null}
            placeholder={pending ? 'Confirma arriba…' : 'Pide algo…'}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || pending != null || !input.trim()}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-700"
          >
            ↵
          </button>
        </form>
      </div>
    </div>
  );
}

function TurnBubble({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">
          {turn.text}
        </div>
      </div>
    );
  }

  if (turn.role === 'assistant') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
          {turn.text ? <Markdown text={turn.text} /> : null}
        </div>
      </div>
    );
  }

  // tool
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-mono text-zinc-400">
          {turn.toolPending ? '⏳' : turn.toolResult?.ok ? '✅' : '❌'}
          <span>{turn.toolName}</span>
        </div>
        {turn.toolResult?.summary && (
          <div className="mt-1 text-zinc-300">{turn.toolResult.summary}</div>
        )}
        {turn.toolResult?.error && (
          <div className="mt-1 text-red-400">{turn.toolResult.error}</div>
        )}
      </div>
    </div>
  );
}
