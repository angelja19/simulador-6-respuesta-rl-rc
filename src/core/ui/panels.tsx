import React, { ReactNode, useState } from 'react';
import { Analysis } from '../engine/analyze';
import { ElementResult } from '../engine/mna';
import { Issue } from '../engine/validate';
import { fmtEng } from '../engine/units';
import { Tex, TexText } from './basic';

// ---------------- errores ----------------
export function IssuesPanel({ issues, compact = false }: { issues: Issue[]; compact?: boolean }) {
  if (!issues.length)
    return (
      <div className="issue box-ok" role="status">
        <b className="tag">✓ Sin errores</b> — el circuito es válido y se resuelve en vivo.
      </div>
    );
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div role="alert" aria-live="polite">
      {sorted.map((i, k) => (
        <div key={k} className={`issue ${i.severity === 'error' ? 'box-err' : i.severity === 'warning' ? 'box-warn' : 'box-info'}`}>
          <b className="tag">{i.severity === 'error' ? '✖ Error' : i.severity === 'warning' ? '⚠ Advertencia' : 'ℹ Aviso'}</b> — {i.what}
          {!compact && (
            <dl>
              <dt>Por qué</dt>
              <dd>{i.why}</dd>
              <dt>Qué causaría</dt>
              <dd>{i.consequence}</dd>
              <dt>Cómo corregirlo</dt>
              <dd>{i.fix}</dd>
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- resultados ----------------
export function ResultsTable({ results, nodeNames, V }: { results: Map<string, ElementResult> | ElementResult[]; nodeNames?: string[]; V?: number[] }) {
  const rows = Array.isArray(results) ? results : [...results.values()];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data">
        <thead>
          <tr>
            <th>Elemento</th>
            <th>V [V]</th>
            <th>I [A]</th>
            <th>P [W]</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((r) => !r.id.startsWith('__'))
            .map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>{fmtEng(r.v, '', 5)}</td>
                <td>{fmtEng(r.i, '', 5)}</td>
                <td className={r.p > 1e-12 ? 'abs' : r.p < -1e-12 ? 'ent' : ''}>{fmtEng(r.p, '', 5)}</td>
                <td className={r.p > 1e-12 ? 'abs' : r.p < -1e-12 ? 'ent' : 'muted'}>{r.p > 1e-12 ? 'absorbe' : r.p < -1e-12 ? 'entrega' : '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {V && nodeNames && V.length > 1 && (
        <div className="small" style={{ marginTop: 6 }}>
          <b>Voltajes de nodo (respecto a la referencia):</b>{' '}
          {V.slice(1).map((v, i) => (
            <span key={i} className="badge" style={{ marginRight: 4 }}>
              V<sub>{nodeNames[i + 1]}</sub> = {fmtEng(v, 'V', 5)}
            </span>
          ))}
        </div>
      )}
      <div className="hint">Convención pasiva: la corriente entra por el terminal (+). P = V·I; P &gt; 0 absorbe, P &lt; 0 entrega.</div>
    </div>
  );
}

export function BalancePanel({ a }: { a: Analysis }) {
  if (!a.dc) return null;
  return (
    <div className="card">
      <h4>Balance de potencias</h4>
      <div className="row">
        <span>ΣP entregada = <b>{fmtEng(a.balance.delivered, 'W', 5)}</b></span>
        <span>ΣP absorbida = <b>{fmtEng(a.balance.absorbed, 'W', 5)}</b></span>
        <span className={`badge ${a.balance.ok ? 'ok' : 'err'}`}>{a.balance.ok ? '✓ verificado' : '✗ no cierra'}</span>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary className="small">LCK por nodo y LVK por malla (residuos)</summary>
        <table className="data" style={{ marginTop: 4 }}>
          <tbody>
            {a.kcl.map((k) => (
              <tr key={`n${k.node}`}>
                <td>LCK nodo {k.node === 0 ? 'ref' : a.net.nodeNames[k.node]}</td>
                <td style={{ whiteSpace: 'normal', textAlign: 'left' }} className="small">
                  {k.terms.map((t) => `${t.i >= 0 ? '+' : '−'}${fmtEng(Math.abs(t.i), 'A', 4)} (${t.label})`).join(' ')}
                </td>
                <td>Σ = {fmtEng(k.residual, 'A', 2)}</td>
              </tr>
            ))}
            {a.kvl.map((k) => (
              <tr key={`m${k.mesh}`}>
                <td>LVK malla {k.mesh}</td>
                <td style={{ whiteSpace: 'normal', textAlign: 'left' }} className="small">
                  {k.terms.map((t) => `${t.v >= 0 ? '+' : '−'}${fmtEng(Math.abs(t.v), 'V', 4)} (${t.label})`).join(' ')}
                </td>
                <td>Σ = {fmtEng(k.residual, 'V', 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">LCK: suma de corrientes que salen del nodo. LVK: suma de caídas recorriendo la malla en sentido horario. Ambas deben dar 0.</div>
      </details>
    </div>
  );
}

// ---------------- documento de 7 puntos ----------------
export type Block =
  | { t: 'p'; text: string }
  | { t: 'tex'; tex: string; n?: string }
  | { t: 'list'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'box'; tex: string }
  | { t: 'node'; node: ReactNode }
  | { t: 'h'; text: string };

export interface StepDoc {
  title: string;
  concept: string;
  identification: Block[];
  laws: Block[];
  development: Block[];
  results: Block[];
  verification: Block[];
  tip: string;
}

export const P = (text: string): Block => ({ t: 'p', text });
export const T = (tex: string, n?: string): Block => ({ t: 'tex', tex, n });
export const L = (items: string[]): Block => ({ t: 'list', items });
export const H = (text: string): Block => ({ t: 'h', text });
export const BOX = (tex: string): Block => ({ t: 'box', tex });

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i} style={{ margin: '4px 0' }}>
                <TexText text={b.text} />
              </p>
            );
          case 'h':
            return <h4 key={i}>{b.text}</h4>;
          case 'tex':
            return (
              <div key={i} className="eqn">
                {b.n && <span className="lbl">{b.n}</span>}
                <Tex tex={b.tex} block />
              </div>
            );
          case 'box':
            return (
              <div key={i} className="result-box">
                <Tex tex={`\\boxed{${b.tex}}`} block />
              </div>
            );
          case 'list':
            return (
              <ul key={i} style={{ margin: '4px 0', paddingLeft: 20 }}>
                {b.items.map((it, k) => (
                  <li key={k}>
                    <TexText text={it} />
                  </li>
                ))}
              </ul>
            );
          case 'table':
            return (
              <div key={i} style={{ overflowX: 'auto' }}>
                <table className="data">
                  <thead>
                    <tr>{b.head.map((h, k) => <th key={k}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, k) => (
                      <tr key={k}>{r.map((c, j) => <td key={j}><TexText text={c} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'node':
            return <React.Fragment key={i}>{b.node}</React.Fragment>;
        }
        return null;
      })}
    </>
  );
}

const SECTION_TITLES = ['Concepto clave', 'Identificación y datos', 'Leyes y fórmulas a aplicar', 'Desarrollo', 'Resultados finales', 'Verificación', 'Tip práctico'];

export function StepsView({ doc, extraTop }: { doc: StepDoc; extraTop?: ReactNode }) {
  const [step, setStep] = useState(7);
  const sections: ReactNode[] = [
    <p key="c">
      <TexText text={doc.concept} />
    </p>,
    <Blocks key="i" blocks={doc.identification} />,
    <Blocks key="l" blocks={doc.laws} />,
    <Blocks key="d" blocks={doc.development} />,
    <Blocks key="r" blocks={doc.results} />,
    <Blocks key="v" blocks={doc.verification} />,
    <p key="t">
      💡 <TexText text={doc.tip} />
    </p>,
  ];
  return (
    <div className="steps">
      <div className="row no-print" style={{ marginBottom: 6 }}>
        <b className="grow">{doc.title}</b>
        <button onClick={() => setStep(1)} title="Mostrar desde el primer paso">⏮</button>
        <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step <= 1}>◀ Paso</button>
        <span className="small">{step}/7</span>
        <button onClick={() => setStep((s) => Math.min(7, s + 1))} disabled={step >= 7}>Paso ▶</button>
        <button onClick={() => setStep(7)}>Ver todo</button>
        <button onClick={() => window.print()} title="Exportar el desarrollo a PDF (Imprimir → Guardar como PDF)">⤓ PDF</button>
      </div>
      {extraTop}
      {sections.slice(0, step).map((s, i) => (
        <section key={i}>
          <h3>
            <span className="n">{i + 1}</span>
            {SECTION_TITLES[i]}
          </h3>
          {s}
        </section>
      ))}
    </div>
  );
}

// ---------------- Mejor manera ----------------
export interface BetterDoc {
  method: string;
  why: string;
  savings: string;
  formulas: { tex: string; meaning: string }[];
  tricks: string[];
  mistakes: string[];
  compare: { long: string; short: string; result: string };
}

export function BetterView({ doc }: { doc: BetterDoc }) {
  return (
    <div>
      <div className="card box-info">
        <b>Método recomendado:</b> {doc.method}
      </div>
      <h4>¿Por qué?</h4>
      <p>
        <TexText text={doc.why} />
      </p>
      <h4>Ecuaciones que ahorra</h4>
      <p>
        <TexText text={doc.savings} />
      </p>
      <h4>Fórmulas clave</h4>
      {doc.formulas.map((f, i) => (
        <div key={i} className="card">
          <Tex tex={f.tex} block />
          <div className="small muted">
            <TexText text={f.meaning} />
          </div>
        </div>
      ))}
      <h4>Atajos y trucos de examen</h4>
      <ul>
        {doc.tricks.map((t, i) => (
          <li key={i}>
            <TexText text={t} />
          </li>
        ))}
      </ul>
      <h4>Errores típicos que debe evitar</h4>
      <ul>
        {doc.mistakes.map((t, i) => (
          <li key={i}>
            <TexText text={t} />
          </li>
        ))}
      </ul>
      <h4>Método largo vs. método rápido</h4>
      <div className="grid2">
        <div className="card">
          <b>Largo</b>
          <p className="small">
            <TexText text={doc.compare.long} />
          </p>
        </div>
        <div className="card box-ok">
          <b>Rápido</b>
          <p className="small">
            <TexText text={doc.compare.short} />
          </p>
        </div>
      </div>
      <p className="small">
        <b>Mismo resultado:</b> <TexText text={doc.compare.result} />
      </p>
    </div>
  );
}

export function NeedsFix({ issues }: { issues: Issue[] }) {
  const errs = issues.filter((i) => i.severity === 'error');
  return (
    <div className="card box-err">
      <b>El circuito todavía no se puede resolver.</b> Corrija en la ventanilla 1:
      <ul>
        {errs.map((e, i) => (
          <li key={i}>
            {e.what} <span className="muted">→ {e.fix}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
