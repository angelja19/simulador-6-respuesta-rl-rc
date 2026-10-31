// Álgebra lineal: eliminación gaussiana con pivoteo parcial, determinantes y Cramer.

export interface GaussResult {
  x: number[] | null;
  singular: boolean;
  /** índice de la columna (incógnita) donde se perdió el pivote */
  badColumn?: number;
  /** estimación de condición (max pivote / min pivote) */
  cond: number;
  /** registro de operaciones de fila (para mostrar el método de Gauss) */
  log: string[];
}

export function cloneM(A: number[][]): number[][] {
  return A.map((r) => r.slice());
}

/** Resuelve A x = b. No modifica A ni b. */
export function gauss(Ain: number[][], bin: number[], withLog = false, pivotOnlyIfZero = false): GaussResult {
  const n = bin.length;
  const A = cloneM(Ain);
  const b = bin.slice();
  const log: string[] = [];
  let scale = 0;
  for (const r of A) for (const v of r) scale = Math.max(scale, Math.abs(v));
  if (scale === 0) scale = 1;
  const tol = 1e-12 * scale;
  let maxPiv = 0;
  let minPiv = Infinity;
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(A[k][k]);
    if (!(pivotOnlyIfZero && best > tol * 1e3)) {
      for (let i = k + 1; i < n; i++) {
        if (Math.abs(A[i][k]) > best) {
          best = Math.abs(A[i][k]);
          p = i;
        }
      }
    }
    if (best <= tol) return { x: null, singular: true, badColumn: k, cond: Infinity, log };
    if (p !== k) {
      [A[k], A[p]] = [A[p], A[k]];
      [b[k], b[p]] = [b[p], b[k]];
      if (withLog) log.push(`F_{${k + 1}} \\leftrightarrow F_{${p + 1}}`);
    }
    maxPiv = Math.max(maxPiv, best);
    minPiv = Math.min(minPiv, best);
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
      if (withLog) log.push(`F_{${i + 1}} \\leftarrow F_{${i + 1}} - (${fmtTex(f)})\\,F_{${k + 1}}`);
    }
    if (withLog && k < n - 1) log.push(`\\left[\\begin{array}{${'c'.repeat(n)}|c}${A.map((r, i) => r.map((v) => fmtTex(Math.abs(v) < 1e-12 ? 0 : v)).join(' & ') + ' & ' + fmtTex(b[i])).join(' \\\\ ')}\\end{array}\\right]`);
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return { x, singular: false, cond: n ? maxPiv / minPiv : 1, log };
}

function fmtTex(v: number): string {
  const s = Number(v.toPrecision(5)).toString();
  return s.replace('.', '{,}');
}

export function det(Ain: number[][]): number {
  const n = Ain.length;
  if (n === 0) return 1;
  const A = cloneM(Ain);
  let d = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    if (A[p][k] === 0) return 0;
    if (p !== k) {
      [A[k], A[p]] = [A[p], A[k]];
      d = -d;
    }
    d *= A[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
    }
  }
  return d;
}

export interface CramerResult {
  D: number;
  Dk: number[];
  x: number[] | null;
}
export function cramer(A: number[][], b: number[]): CramerResult {
  const D = det(A);
  const Dk = b.map((_, k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))));
  return { D, Dk, x: Math.abs(D) < 1e-14 ? null : Dk.map((d) => d / D) };
}

export function matVec(A: number[][], x: number[]): number[] {
  return A.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));
}
