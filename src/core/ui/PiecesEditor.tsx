import React from 'react';
import { Piece } from '../engine/expr';
import { parseSI } from '../engine/units';

export interface PieceIn {
  from: string;
  to: string;
  expr: string;
}

export function parseBound(s: string): number {
  const x = s.trim().replace('−', '-').toLowerCase();
  if (['-inf', '-∞', '-infinito'].includes(x)) return -Infinity;
  if (['inf', '∞', '+inf', '+∞', 'infinito'].includes(x)) return Infinity;
  const r = parseSI(x, 's');
  return r.ok ? r.value! : NaN;
}

export function toPieces(p: PieceIn[]): { pieces: Piece[]; error?: string } {
  const out: Piece[] = [];
  for (const q of p) {
    const from = parseBound(q.from);
    const to = parseBound(q.to);
    if (isNaN(from) || isNaN(to)) return { pieces: [], error: `Intervalo inválido «${q.from} ≤ t < ${q.to}». Use números en segundos (admite prefijos: 2m = 2 ms) o -inf / inf.` };
    out.push({ from, to, expr: q.expr });
  }
  return { pieces: out };
}

const QUICK: { label: string; expr: string }[] = [
  { label: 'constante', expr: '5' },
  { label: 'rampa', expr: '2*t' },
  { label: 'exponencial', expr: '10*exp(-t/0.5)' },
  { label: 'senoidal', expr: '5*sin(2*pi*50*t)' },
];

/** Editor de funciones del tiempo por tramos */
export function PiecesEditor({ pieces, onChange, varName, quick = true }: { pieces: PieceIn[]; onChange: (p: PieceIn[]) => void; varName: string; quick?: boolean }) {
  return (
    <div className="col">
      {pieces.map((p, k) => (
        <div key={k} className="row">
          <input value={p.from} onChange={(e) => onChange(pieces.map((q, j) => (j === k ? { ...q, from: e.target.value } : q)))} style={{ width: 64 }} aria-label={`desde ${k + 1}`} />
          <span>≤ t &lt;</span>
          <input value={p.to} onChange={(e) => onChange(pieces.map((q, j) => (j === k ? { ...q, to: e.target.value } : q)))} style={{ width: 64 }} aria-label={`hasta ${k + 1}`} />
          <span>
            : {varName}(t) =
          </span>
          <input value={p.expr} onChange={(e) => onChange(pieces.map((q, j) => (j === k ? { ...q, expr: e.target.value } : q)))} style={{ flex: 1, minWidth: 140 }} aria-label={`expresión ${k + 1}`} />
          {quick && (
            <select value="" onChange={(e) => e.target.value && onChange(pieces.map((q, j) => (j === k ? { ...q, expr: e.target.value } : q)))} aria-label="forma rápida">
              <option value="">forma…</option>
              {QUICK.map((qq) => (
                <option key={qq.label} value={qq.expr}>
                  {qq.label}
                </option>
              ))}
            </select>
          )}
          {pieces.length > 1 && (
            <button onClick={() => onChange(pieces.filter((_, j) => j !== k))} aria-label="quitar tramo">
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <button onClick={() => { const last = pieces[pieces.length - 1]; onChange([...pieces, { from: last?.to ?? '0', to: 'inf', expr: '0' }]); }}>+ tramo</button>
        <span className="hint">Use t en segundos. Ejemplos: 2*t · 10*exp(-2*t) · 5*sin(100*pi*t) · 4 - 2*(t-5). Use -inf / inf para t &lt; 0 o t &gt; 0.</span>
      </div>
    </div>
  );
}
