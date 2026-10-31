// Expresiones lineales simbólicas (sobre incógnitas con nombre LaTeX) y sistemas de ecuaciones.
import { cramer, gauss } from '../linalg';
import { texNum } from '../units';

export interface SLin {
  t: Map<string, number>;
  c: number;
}
export const sl = (c = 0): SLin => ({ t: new Map(), c });
export const sv = (name: string, k = 1): SLin => ({ t: new Map([[name, k]]), c: 0 });
export function sadd(...ls: SLin[]): SLin {
  const r = sl();
  for (const l of ls) {
    for (const [n, v] of l.t) r.t.set(n, (r.t.get(n) ?? 0) + v);
    r.c += l.c;
  }
  return r;
}
export function sscale(l: SLin, k: number): SLin {
  const r = sl(l.c * k);
  for (const [n, v] of l.t) r.t.set(n, v * k);
  return r;
}
export const ssub = (a: SLin, b: SLin) => sadd(a, sscale(b, -1));
export function sclean(l: SLin, eps = 1e-12): SLin {
  const r = sl(Math.abs(l.c) < eps ? 0 : l.c);
  for (const [n, v] of l.t) if (Math.abs(v) > eps) r.t.set(n, v);
  return r;
}
export function sevaluate(l: SLin, vals: Map<string, number>): number {
  let s = l.c;
  for (const [n, v] of l.t) s += v * (vals.get(n) ?? 0);
  return s;
}

/** Coeficiente en LaTeX delante de una variable: 1 → "", −1 → "-" */
function coefTex(v: number, first: boolean): string {
  const sign = v < 0 ? '-' : first ? '' : '+';
  const a = Math.abs(v);
  const num = Math.abs(a - 1) < 1e-12 ? '' : texNum(a, 5);
  return `${first ? sign : ` ${sign} `}${num}`;
}

/** Forma "a x + b y = c" (pasando la constante al lado derecho) */
export function texEq(l: SLin, order?: string[]): string {
  const c = sclean(l);
  const names = order ? order.filter((n) => c.t.has(n)).concat([...c.t.keys()].filter((n) => !order.includes(n))) : [...c.t.keys()];
  let s = '';
  names.forEach((n, i) => {
    s += `${coefTex(c.t.get(n)!, i === 0)}${n}`;
  });
  if (!s) s = '0';
  return `${s} = ${texNum(-c.c, 5)}`;
}
/** Expresión sin igualdad */
export function texExpr(l: SLin, order?: string[]): string {
  const c = sclean(l);
  const names = order ? order.filter((n) => c.t.has(n)).concat([...c.t.keys()].filter((n) => !order.includes(n))) : [...c.t.keys()];
  let s = '';
  names.forEach((n, i) => (s += `${coefTex(c.t.get(n)!, i === 0)}${n}`));
  if (Math.abs(c.c) > 1e-12 || !s) s += s ? ` ${c.c < 0 ? '-' : '+'} ${texNum(Math.abs(c.c), 5)}` : texNum(c.c, 5);
  return s;
}

/** Multiplica la ecuación por el menor entero que deja coeficientes enteros (como en el cuaderno). */
export function integerize(l: SLin): { lin: SLin; factor: number } {
  const vals = [...l.t.values(), l.c].filter((v) => Math.abs(v) > 1e-12);
  for (const f of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 25, 30, 40, 50, 60, 100, 120, 200, 300, 400, 500, 600, 1000, 1200, 2000, 3000, 6000, 10000]) {
    if (vals.every((v) => Math.abs(v * f - Math.round(v * f)) < 1e-9 * Math.max(1, Math.abs(v * f)))) return { lin: sscale(l, f), factor: f };
  }
  return { lin: l, factor: 1 };
}

export interface SysEq {
  /** número de ecuación (①, ②…) */
  n: number;
  /** tipo: LVK, LCK, restricción, control */
  kind: string;
  /** descripción breve (p. ej. "Malla 1", "Nodo V₂") */
  title: string;
  /** forma original término a término (LaTeX) */
  raw: string;
  /** forma simplificada: lin = 0 */
  lin: SLin;
}

export interface SolvedSystem {
  unknowns: string[];
  A: number[][];
  b: number[];
  values: Map<string, number> | null;
  singular: boolean;
  /** detalle del método elegido para mostrar */
  detailTex: string[];
}

export type SolveMethod = 'gauss' | 'cramer' | 'sustitucion';

export function solveSystem(eqsIn: SLin[], unknowns: string[], method: SolveMethod = 'gauss'): SolvedSystem {
  // se usan las mismas ecuaciones (con coeficientes enteros) que se muestran en el desarrollo
  const eqs = eqsIn.map((e) => integerize(sclean(e)).lin);
  const A = eqs.map((e) => unknowns.map((u) => e.t.get(u) ?? 0));
  const b = eqs.map((e) => -e.c);
  const g0 = gauss(A, b, false);
  const g = method === 'gauss' ? gauss(A, b, true, true) : g0;
  if (!g.singular && g0.x) g.x = g0.x;
  const detail: string[] = [];
  if (g.singular || !g.x) return { unknowns, A, b, values: null, singular: true, detailTex: detail };
  const values = new Map(unknowns.map((u, i) => [u, g.x![i]]));
  const mat = (M: number[][]) => `\\begin{bmatrix}${M.map((r) => r.map((v) => texNum(v, 5)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
  const vec = (v: (string | number)[]) => `\\begin{bmatrix}${v.map((x) => (typeof x === 'number' ? texNum(x, 5) : x)).join(' \\\\ ')}\\end{bmatrix}`;
  detail.push(`${mat(A)}\\,${vec(unknowns)} = ${vec(b)}`);
  if (method === 'cramer' && unknowns.length <= 5) {
    const c = cramer(A, b);
    detail.push(`\\Delta = \\det A = ${texNum(c.D, 6)}`);
    unknowns.forEach((u, k) => {
      const Ak = A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
      detail.push(`\\Delta_{${k + 1}} = \\det${mat(Ak)} = ${texNum(c.Dk[k], 6)} \\;\\Rightarrow\\; ${u} = \\dfrac{\\Delta_{${k + 1}}}{\\Delta} = \\dfrac{${texNum(c.Dk[k], 6)}}{${texNum(c.D, 6)}} = ${texNum(c.Dk[k] / c.D, 5)}`);
    });
  } else if (method === 'gauss') {
    for (const op of g.log.slice(0, 30)) detail.push(op);
    unknowns.forEach((u) => detail.push(`${u} = ${texNum(values.get(u)!, 6)}`));
  } else {
    // sustitución: despejar sucesivamente
    detail.push(...substitutionSteps(eqs, unknowns, values));
  }
  return { unknowns, A, b, values, singular: false, detailTex: detail };
}

function substitutionSteps(eqs: SLin[], unknowns: string[], values: Map<string, number>): string[] {
  const out: string[] = [];
  let work = eqs.map((e) => sclean(e));
  const order: string[] = [];
  const exprs = new Map<string, SLin>();
  const remaining = new Set(unknowns);
  while (remaining.size && work.length) {
    // ecuación con menos incógnitas
    work.sort((a, b) => a.t.size - b.t.size);
    const e = work.shift()!;
    const vars = [...e.t.keys()].filter((v) => remaining.has(v));
    if (!vars.length) continue;
    const x = vars[0];
    const k = e.t.get(x)!;
    // x = -(resto)/k
    const rest = sl(e.c);
    for (const [n, v] of e.t) if (n !== x) rest.t.set(n, v);
    const ex = sscale(rest, -1 / k);
    out.push(`\\text{De } ${texEq(e)}:\\quad ${x} = ${texExpr(ex)}`);
    exprs.set(x, ex);
    order.push(x);
    remaining.delete(x);
    work = work.map((w) => {
      const kx = w.t.get(x) ?? 0;
      if (!kx) return w;
      const r = sl(w.c);
      for (const [n, v] of w.t) if (n !== x) r.t.set(n, v);
      return sclean(sadd(r, sscale(ex, kx)));
    });
    for (const w of work) if (w.t.size) out.push(`\\Rightarrow\\; ${texEq(w)}`);
  }
  out.push('\\text{Sustituyendo hacia atrás:}');
  for (const x of order.reverse()) out.push(`${x} = ${texNum(values.get(x)!, 6)}`);
  return out;
}

export const circled = (n: number) => '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'[n - 1] ?? `(${n})`;
export const texCircled = (n: number) => `\\text{${circled(n)}}`;

export function texSystem(lines: string[]): string {
  return `\\begin{cases} ${lines.join(' \\\\ ')} \\end{cases}`;
}
