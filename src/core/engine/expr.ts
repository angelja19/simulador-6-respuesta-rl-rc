// Funciones del tiempo por tramos escritas por el usuario (math.js): evaluar, derivar, integrar y hallar raíces.
import { compile, derivative, parse, simplify, rationalize, MathNode, EvalFunction } from 'mathjs';

export interface Piece {
  /** inicio del tramo (puede ser -Infinity) */
  from: number;
  /** fin del tramo (puede ser Infinity) */
  to: number;
  expr: string;
}

export interface CompiledPiece extends Piece {
  node: MathNode;
  f: EvalFunction;
  dnode: MathNode;
  df: EvalFunction;
  /** coeficientes si es polinomio en t (c0 + c1 t + …) */
  poly: number[] | null;
}

export interface PiecewiseResult {
  ok: boolean;
  error?: string;
  pieces: CompiledPiece[];
}

/** Normaliza la escritura del usuario: coma decimal, multiplicación implícita "6.5t", e^ */
export function normalizeExpr(s: string): string {
  let x = s.trim();
  x = x.replace(/(\d),(\d)/g, '$1.$2');
  x = x.replace(/·|×/g, '*');
  x = x.replace(/−/g, '-');
  x = x.replace(/\be\^/g, 'exp(1)^');
  return x;
}

export function compilePieces(pieces: Piece[]): PiecewiseResult {
  const out: CompiledPiece[] = [];
  for (const p of pieces) {
    if (!p.expr.trim()) return { ok: false, error: 'Hay un tramo con la expresión vacía.', pieces: [] };
    if (!(p.to > p.from)) return { ok: false, error: `El tramo [${p.from}, ${p.to}] no es válido: el fin debe ser mayor que el inicio.`, pieces: [] };
    try {
      const node = parse(normalizeExpr(p.expr));
      const vars = new Set<string>();
      node.traverse((n: any) => {
        if (n.isSymbolNode && !['pi', 'e', 'exp', 'sin', 'cos', 'tan', 'sqrt', 'log', 'abs', 'ln'].includes(n.name)) vars.add(n.name);
      });
      vars.delete('t');
      if (vars.size) return { ok: false, error: `La expresión «${p.expr}» usa variables desconocidas: ${[...vars].join(', ')}. Solo se permite t.`, pieces: [] };
      const f = node.compile();
      f.evaluate({ t: (isFinite(p.from) ? p.from : 0) + 0.1 });
      const dnode = simplify(derivative(node, 't'));
      let poly: number[] | null = null;
      try {
        const r = rationalize(node, {}, true) as any;
        if (r.coefficients && r.denominator == null) poly = r.coefficients.map(Number);
        else if (r.coefficients && String(r.denominator) === '1') poly = r.coefficients.map(Number);
      } catch {
        poly = null;
      }
      if (poly && poly.some((c) => !isFinite(c))) poly = null;
      out.push({ ...p, node, f, dnode, df: dnode.compile(), poly });
    } catch (e: any) {
      return { ok: false, error: `No se entiende la expresión «${p.expr}»: ${traducir(String(e?.message ?? ''))}. Ejemplos: 6.5*t^2 + 3.5 · 10*exp(-2*t) · 5*sin(100*pi*t)`, pieces: [] };
    }
  }
  // tramos sin superposición
  const sorted = [...out].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].from < sorted[i - 1].to - 1e-12) return { ok: false, error: 'Los tramos se superponen: revise los intervalos.', pieces: [] };
  return { ok: true, pieces: sorted };
}

export function pieceAt(pw: CompiledPiece[], t: number): CompiledPiece | null {
  for (const p of pw) if (t >= p.from && t < p.to) return p;
  const last = pw[pw.length - 1];
  if (last && t === last.to) return last;
  return null;
}
export function evalPW(pw: CompiledPiece[], t: number): number {
  const p = pieceAt(pw, t);
  if (!p) return 0;
  const v = Number(p.f.evaluate({ t }));
  return isFinite(v) ? v : NaN;
}
export function evalDeriv(pw: CompiledPiece[], t: number): number {
  const p = pieceAt(pw, t);
  if (!p) return 0;
  return Number(p.df.evaluate({ t }));
}

/** Integral definida numérica (Simpson compuesto) de f entre a y b */
export function integrate(f: (t: number) => number, a: number, b: number, n = 2000): number {
  if (b === a) return 0;
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

/** Integral de una función por tramos respetando los saltos */
export function integratePW(f: (t: number) => number, pw: CompiledPiece[], a: number, b: number): number {
  const cuts = [a, ...pw.flatMap((p) => [p.from, p.to]).filter((x) => x > a && x < b), b].sort((x, y) => x - y);
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    const eps = (hi - lo) * 1e-12;
    s += integrate(f, lo + eps, hi - eps, 2000);
  }
  return s;
}

/** Raíces de f en [a,b] por barrido + bisección */
export function roots(f: (t: number) => number, a: number, b: number, n = 4000): number[] {
  const out: number[] = [];
  let x0 = a;
  let f0 = f(a);
  if (Math.abs(f0) < 1e-12) out.push(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + ((b - a) * i) / n;
    const f1 = f(x1);
    if (Math.abs(f1) < 1e-12) {
      if (!out.length || Math.abs(out[out.length - 1] - x1) > (b - a) / n) out.push(x1);
    } else if (f0 * f1 < 0) {
      let lo = x0;
      let hi = x1;
      for (let k = 0; k < 80; k++) {
        const m = (lo + hi) / 2;
        if (f(lo) * f(m) <= 0) hi = m;
        else lo = m;
      }
      out.push((lo + hi) / 2);
    }
    x0 = x1;
    f0 = f1;
  }
  return out;
}

/** LaTeX de una expresión */
export function toTex(node: MathNode): string {
  try {
    return node.toTex({ parenthesis: 'auto', implicit: 'hide' }).replace(/\\cdot/g, '\\,');
  } catch {
    return node.toString();
  }
}

/** Polinomio integrado: ∫ Σ c_k t^k dt = Σ c_k t^{k+1}/(k+1) */
export function polyIntegralTex(c: number[], C0 = 0, vName = 't'): string {
  const terms: string[] = [];
  c.forEach((ck, k) => {
    if (Math.abs(ck) < 1e-15) return;
    const coef = ck / (k + 1);
    terms.push(`${fmtCoef(coef, terms.length === 0)}${k + 1 === 1 ? vName : `${vName}^{${k + 1}}`}`);
  });
  if (Math.abs(C0) > 1e-15 || !terms.length) terms.push(`${terms.length ? (C0 < 0 ? '- ' : '+ ') : ''}${fmt(Math.abs(C0))}`);
  return terms.join(' ');
}
function fmt(x: number) {
  return Number(x.toPrecision(6)).toString().replace('.', '{,}');
}
function fmtCoef(x: number, first: boolean) {
  const sign = x < 0 ? '-' : first ? '' : '+';
  const a = Math.abs(x);
  return `${first ? sign : ` ${sign} `}${Math.abs(a - 1) < 1e-12 ? '' : fmt(a)}`;
}
export function polyEval(c: number[], t: number) {
  return c.reduce((s, ck, k) => s + ck * t ** k, 0);
}
export function polyIntEval(c: number[], t: number) {
  return c.reduce((s, ck, k) => s + (ck * t ** (k + 1)) / (k + 1), 0);
}
export { compile };

/** Traduce los mensajes más comunes de math.js */
export function traducir(m: string): string {
  const pos = /char (\d+)/.exec(m);
  const at = pos ? ` (posición ${pos[1]})` : '';
  if (/Parenthesis \) expected/.test(m)) return `falta cerrar un paréntesis${at}`;
  if (/Unexpected end of expression/.test(m)) return 'la expresión está incompleta';
  if (/Value expected/.test(m)) return `falta un número o variable${at}`;
  if (/Unexpected operator/.test(m)) return `operador fuera de lugar${at}`;
  if (/Undefined symbol|Undefined function/.test(m)) return `símbolo o función desconocida: ${m.split(' ').pop()}`;
  if (/Unexpected type of argument/.test(m)) return 'tipo de argumento inválido';
  if (/Syntax error/.test(m)) return `error de sintaxis${at}`;
  return m ? `error de sintaxis (${m})` : 'error de sintaxis';
}
