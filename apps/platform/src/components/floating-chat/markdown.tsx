// Mini-renderer de markdown para el floating chat.
//
// Subset soportado (el que produce Claude típicamente):
//   - **bold** y __bold__
//   - *italic* (single asterisk, sin nesting con bold)
//   - `code` inline
//   - ```code fences``` block
//   - # / ## / ### headers
//   - - / * bullet lists
//   - 1. 2. 3. numbered lists
//   - Tablas GFM (| col | col |\n|---|---|\n| val | val |)
//   - Párrafos
//
// No soporta: links, images, blockquotes, html, nested formatting.
// Si se necesita más adelante: swap a react-markdown + remark-gfm.

'use client';

import { Fragment, type ReactNode } from 'react';

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} />
      ))}
    </div>
  );
}

// ─── Tipos ───

type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'numbered_list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code_block'; code: string };

// ─── Parser de bloques ───

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Blank line → siguiente
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code fence
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code_block', code: codeLines.join('\n') });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2]! });
      i++;
      continue;
    }

    // Tabla: la siguiente línea debe ser el separator ---
    if (line.includes('|') && lines[i + 1] && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(splitTableRow(lines[i] ?? ''));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'bullet_list', items });
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'numbered_list', items });
      continue;
    }

    // Paragraph (consume hasta blank line o un block tag)
    const paragraphLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (
        next.trim() === '' ||
        next.trim().startsWith('```') ||
        /^(#{1,3})\s+/.test(next) ||
        /^\s*[-*]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        (next.includes('|') && lines[i + 1] && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1] ?? ''))
      ) {
        break;
      }
      paragraphLines.push(next);
      i++;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}

function splitTableRow(line: string): string[] {
  // Quitar leading/trailing | y split.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

// ─── Render de bloques ───

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3');
      const classes = {
        1: 'text-base font-bold text-zinc-100',
        2: 'text-sm font-bold text-zinc-100',
        3: 'text-sm font-semibold text-zinc-200',
      }[block.level];
      return <Tag className={classes}>{renderInline(block.text)}</Tag>;
    }
    case 'paragraph':
      return (
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">
          {block.lines.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(l)}
            </Fragment>
          ))}
        </p>
      );
    case 'bullet_list':
      return (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-100">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case 'numbered_list':
      return (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-zinc-100">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case 'code_block':
      return (
        <pre className="overflow-x-auto rounded bg-black/40 p-2 text-xs">
          <code className="font-mono text-zinc-200">{block.code}</code>
        </pre>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/80">
              <tr>
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className="border-b border-zinc-800 px-2 py-1.5 text-left font-semibold text-zinc-200"
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="even:bg-zinc-900/30">
                  {row.map((cell, j) => (
                    <td key={j} className="border-b border-zinc-800/50 px-2 py-1 text-zinc-300">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// ─── Renderer inline (bold/italic/code) ───

function renderInline(text: string): ReactNode {
  // Parser greedy left-to-right que reconoce: **bold**, __bold__, `code`, *italic*
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  // Patrón: **...** | __...__ | `...` | *...* | otro
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) {
      nodes.push(text.slice(cursor, m.index));
    }
    const token = m[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.8em] text-emerald-300"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    cursor = m.index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes.length === 0 ? text : nodes;
}
