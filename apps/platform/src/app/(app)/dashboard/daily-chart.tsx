'use client';

// Gráfico dual-axis: entregas (barras) + facturación (línea) por día.
// Recharts es client-only — usa SVG renderizado en runtime.

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@verdfrut/ui';
import type { DailySeriesPoint } from '@/lib/queries/dashboard';

interface Props {
  data: DailySeriesPoint[];
}

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);
const fmtInt = (v: number) => new Intl.NumberFormat('es-MX').format(v);

function formatDay(iso: string): string {
  // YYYY-MM-DD → "DD MMM"
  const parts = iso.split('-');
  const m = parts[1] ?? '01';
  const d = parts[2] ?? '01';
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? ''}`;
}

export function DailyChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <Card className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Actividad diaria</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Sin datos en el rango seleccionado.</p>
      </Card>
    );
  }

  const chartData = data.map((p) => ({
    day: formatDay(p.day),
    deliveries: p.deliveries,
    billed: p.billed,
  }));

  return (
    <Card className="mb-8">
      <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
        Entregas y facturación por día
      </h2>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              stroke="var(--color-border)"
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              stroke="var(--color-border)"
              tickFormatter={fmtInt}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              stroke="var(--color-border)"
              tickFormatter={(v) =>
                new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
              }
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, name) => {
                const n = typeof value === 'number' ? value : Number(value ?? 0);
                if (name === 'Facturado') return fmtCurrency(n);
                return fmtInt(n);
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              yAxisId="left"
              dataKey="deliveries"
              name="Entregas"
              fill="var(--vf-green-500,#16a34a)"
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="billed"
              name="Facturado"
              stroke="var(--color-accent,#3b82f6)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
