'use client';

// Client component del chat con el orquestador.
// Maneja state local de mensajes, stream SSE, modal de confirmación, y
// upload de adjuntos (xlsx/csv/imagen) — 2.8.

import { useEffect, useRef, useState } from 'react';
import { Card, Button, Textarea, Badge } from '@tripdrive/ui';

type Role = 'user' | 'assistant' | 'tool';

interface ChatTurn {
  id: string;
  role: Role;
  // text para user/assistant texto plano; tool guarda nombre + result preview
  text?: string;
  thinking?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: { ok: boolean; data?: unknown; error?: string; summary?: string };
  toolPending?: boolean;
}

interface ConfirmationRequest {
  tool_use_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  summary: string;
}

interface UploadedAttachment {
  attachment_id: string;
  filename: string;
  kind: string;
  size_bytes: number;
  parsed_ok: boolean;
  parse_error: string | null;
}

export function OrchestratorChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<ConfirmationRequest | null>(null);
  const [usage, setUsage] = useState<{ tokensIn: number; tokensOut: number } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  async function uploadFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        if (sessionId) fd.append('session_id', sessionId);
        const res = await fetch('/api/orchestrator/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: 'desconocido' }));
          setUploadError(`Upload "${file.name}" falló: ${errBody.error}`);
          continue;
        }
        const att = (await res.json()) as UploadedAttachment;
        setPendingAttachments((prev) => [...prev, att]);
      }
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  function removeAttachment(attachmentId: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.attachment_id !== attachmentId));
  }

  async function send(message?: string, confirmation?: { tool_use_id: string; approved: boolean }) {
    if (streaming) return;
    let text = (message ?? input).trim();
    if (!text && !confirmation && pendingAttachments.length === 0) return;

    // Si hay attachments pendientes, los inyectamos al mensaje del usuario para
    // que el modelo conozca los attachment_ids y pueda usar parse_xlsx_attachment.
    if (pendingAttachments.length > 0 && !confirmation) {
      const refs = pendingAttachments
        .map((a) => `- ${a.filename} (${a.kind}) → attachment_id: ${a.attachment_id}`)
        .join('\n');
      text = text
        ? `${text}\n\n[Archivos adjuntos disponibles para usar con parse_xlsx_attachment]\n${refs}`
        : `Procesa estos archivos:\n${refs}`;
    }

    if (text && !confirmation) {
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user',
          text,
        },
      ]);
    }
    setInput('');
    setPendingAttachments([]);
    setStreaming(true);
    setPendingConfirmation(null);

    try {
      const res = await fetch('/api/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text || undefined,
          confirmation,
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        setTurns((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `Error del servidor (${res.status}): ${body || 'sin detalle'}`,
          },
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
            setTurns((prev) => [
              ...prev,
              { id: currentAssistantId!, role: 'assistant', text: '', thinking: '' },
            ]);
          } else if (evt.type === 'thinking_delta' && currentAssistantId) {
            const delta = String(evt.delta ?? '');
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentAssistantId
                  ? { ...t, thinking: (t.thinking ?? '') + delta }
                  : t,
              ),
            );
          } else if (evt.type === 'text_delta' && currentAssistantId) {
            const delta = String(evt.delta ?? '');
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentAssistantId ? { ...t, text: (t.text ?? '') + delta } : t,
              ),
            );
          } else if (evt.type === 'tool_use_start') {
            const toolId = `tool-${String(evt.tool_use_id)}`;
            setTurns((prev) => [
              ...prev,
              {
                id: toolId,
                role: 'tool',
                toolName: String(evt.tool_name),
                toolArgs: evt.args as Record<string, unknown>,
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
            setPendingConfirmation({
              tool_use_id: String(evt.tool_use_id),
              tool_name: String(evt.tool_name),
              args: evt.args as Record<string, unknown>,
              summary: String(evt.summary),
            });
          } else if (evt.type === 'message_end') {
            const u = evt.usage as { input_tokens: number; output_tokens: number };
            setUsage((prev) => ({
              tokensIn: (prev?.tokensIn ?? 0) + u.input_tokens,
              tokensOut: (prev?.tokensOut ?? 0) + u.output_tokens,
            }));
          } else if (evt.type === 'error') {
            setTurns((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: `⚠️ ${String(evt.message)}`,
              },
            ]);
          }
        }
      }
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `⚠️ Conexión fallida: ${err instanceof Error ? err.message : 'desconocido'}`,
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function handleConfirm(approved: boolean) {
    if (!pendingConfirmation) return;
    const conf = pendingConfirmation;
    setPendingConfirmation(null);
    void send(undefined, { tool_use_id: conf.tool_use_id, approved });
  }

  return (
    <div
      ref={dropRef}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className="relative flex h-[calc(100vh-200px)] flex-col gap-3"
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--vf-green-500,#16a34a)] bg-[var(--vf-green-100,#dcfce7)]/60">
          <p className="text-sm font-medium text-[var(--vf-green-700,#15803d)]">
            Suelta el archivo (xlsx, csv) para adjuntarlo
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {turns.length === 0 && (
          <Card>
            <p className="text-sm text-[var(--color-text-muted)]">
              Empieza con algo como: <em>“Muéstrame los tiros de hoy”</em>,{' '}
              <em>“Busca la tienda TOL-1422”</em>,{' '}
              <em>“Geocodifica Av Constituyentes 1234 Toluca”</em>,
              o arrastra un XLSX y pídele <em>“Crea las tiendas de este sheet”</em>.
            </p>
          </Card>
        )}

        <div className="space-y-3">
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      {pendingConfirmation && (
        <ConfirmationCard
          confirmation={pendingConfirmation}
          onConfirm={handleConfirm}
        />
      )}

      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingAttachments.map((a) => (
            <span
              key={a.attachment_id}
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1 text-xs"
            >
              <Badge tone={a.parsed_ok ? 'success' : 'warning'}>{a.kind}</Badge>
              <span className="font-medium">{a.filename}</span>
              <span className="text-[var(--color-text-muted)]">
                ({Math.round(a.size_bytes / 1024)} KB)
              </span>
              {!a.parsed_ok && (
                <span className="text-[var(--vf-warn,#d97706)]" title={a.parse_error ?? ''}>
                  no parseado
                </span>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(a.attachment_id)}
                className="ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="quitar"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-[var(--vf-crit,#dc2626)]" role="alert">
          {uploadError}
        </p>
      )}

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx,.csv,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming || uploading}
          title="Adjuntar XLSX o CSV"
        >
          {uploading ? '⏳' : '📎'}
        </Button>
        <Textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Pregunta, pide una acción, o arrastra un sheet (Enter para enviar)"
          disabled={streaming || pendingConfirmation !== null}
        />
        <Button
          onClick={() => void send()}
          disabled={
            streaming ||
            pendingConfirmation !== null ||
            (!input.trim() && pendingAttachments.length === 0)
          }
        >
          {streaming ? 'Pensando…' : 'Enviar'}
        </Button>
      </div>

      {usage && (
        <p className="text-right text-[10px] text-[var(--color-text-muted)]">
          Esta sesión: {usage.tokensIn.toLocaleString()} in · {usage.tokensOut.toLocaleString()} out
        </p>
      )}
    </div>
  );
}

function TurnView({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'tool') {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <Badge tone={turn.toolPending ? 'warning' : turn.toolResult?.ok ? 'success' : 'danger'}>
            {turn.toolName}
          </Badge>
          {turn.toolPending && (
            <span className="text-xs text-[var(--color-text-muted)]">ejecutando…</span>
          )}
          {turn.toolResult?.summary && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {turn.toolResult.summary}
            </span>
          )}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--color-text-muted)] hover:underline">
            Ver argumentos y respuesta
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Args
              </p>
              <pre className="overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--color-surface-2,#f5f5f5)] p-2 font-mono text-[11px]">
                {JSON.stringify(turn.toolArgs, null, 2)}
              </pre>
            </div>
            {turn.toolResult && (
              <div>
                <p className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Resultado
                </p>
                <pre className="overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--color-surface-2,#f5f5f5)] p-2 font-mono text-[11px]">
                  {JSON.stringify(turn.toolResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      </Card>
    );
  }

  const isUser = turn.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : ''}>
      <div
        className="max-w-[85%] rounded-[var(--radius-md)] p-3"
        style={{
          background: isUser
            ? 'var(--vf-green-100, #dcfce7)'
            : 'var(--color-surface-1, #ffffff)',
          border: '1px solid var(--color-border)',
        }}
      >
        {turn.thinking && (
          <details className="mb-2">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Pensamiento del agente
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-xs italic text-[var(--color-text-muted)]">
              {turn.thinking}
            </p>
          </details>
        )}
        <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">
          {turn.text ?? (turn.role === 'assistant' ? '…' : '')}
        </p>
      </div>
    </div>
  );
}

function ConfirmationCard({
  confirmation,
  onConfirm,
}: {
  confirmation: ConfirmationRequest;
  onConfirm: (approved: boolean) => void;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Badge tone="warning">Confirmación requerida</Badge>
        <div className="flex-1">
          <p className="text-sm font-medium text-[var(--color-text)]">
            El agente quiere ejecutar: <code>{confirmation.tool_name}</code>
          </p>
          <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--color-surface-2,#f5f5f5)] p-2 font-mono text-[11px]">
            {confirmation.summary}
          </pre>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onConfirm(false)}>
          Rechazar
        </Button>
        <Button onClick={() => onConfirm(true)}>Aprobar y ejecutar</Button>
      </div>
    </Card>
  );
}
