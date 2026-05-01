// Wrapper de Anthropic Claude Vision para extracción estructurada de tickets/recibos.
// Solo se usa server-side (route handlers) — NUNCA exponer ANTHROPIC_API_KEY al cliente.

export * from './extract-ticket';
