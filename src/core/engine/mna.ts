// Análisis Nodal Modificado (MNA) en DC y con modelos compañeros.
import { gauss } from './linalg';
import { Netlist, NetElement } from './types';

/** Expresión lineal sobre las incógnitas: Σ coef·x[idx] + c */
export interface Lin {
  t: Map<number, number>;
  c: number;
}
const lin = (c = 0): Lin => ({ t: new Map(), c });
function addTerm(l: Lin, idx: number, coef: number) {
  if (idx < 0 || coef === 0) return;
  l.t.set(idx, (l.t.get(idx) ?? 0) + coef);
}
function addLin(dst: Lin, src: Lin, k = 1) {
  for (const [i, v] of src.t) addTerm(dst, i, v * k);
  dst.c += src.c * k;
}

export type StorageMode = 'dc' | 'ic' | 'companion';

export interface SolveOptions {
  /** cómo tratar L y C: dc (L corto, C abierto), ic (C = fuente de v, L = fuente de i), companion */
  storage?: StorageMode;
  /** valores impuestos en modo ic: vC o iL por id */
  icValues?: Map<string, number>;
  /** modelos compañeros: C → i = g·v + j ; L → v = r·i + e */
  companion?: Map<string, { g?: number; j?: number; r?: number; e?: number }>;
  /** estado de los interruptores (true = cerrado). Por defecto: estado para t → ∞ (después de t0) */
  switchClosed?: (e: NetElement) => boolean;
  /** valores sustituidos (para apagar fuentes, superposición, etc.) */
  valueOverride?: Map<string, number>;
  /** elementos adicionales (fuentes de prueba) */
  extra?: NetElement[];
  /** elementos a retirar del circuito */
  remove?: Set<string>;
}

export interface ElementResult {
  id: string;
  label: string;
  kind: NetElement['kind'];
  /** v = V(a) − V(b) */
  v: number;
  /** corriente que entra por a y sale por b (convención pasiva) */
  i: number;
  /** P = v·i (>0 absorbe, <0 entrega) */
  p: number;
}

export interface MNAResult {
  ok: boolean;
  /** voltajes de nodo (índice 0 = referencia = 0 V) */
  V: number[];
  el: Map<string, ElementResult>;
  /** traza: sistema A x = b con nombres de incógnitas */
  A: number[][];
  b: number[];
  unknowns: string[];
  error?: { kind: 'singular' | 'control' | 'empty'; message: string; column?: string };
  cond: number;
}

export function switchStateAfter(e: NetElement): boolean {
  return (e.swMode ?? 'close') === 'close';
}
export function switchStateBefore(e: NetElement): boolean {
  return !switchStateAfter(e);
}
export function switchClosedAt(t: number) {
  return (e: NetElement) => ((e.t0 ?? 0) <= t ? switchStateAfter(e) : switchStateBefore(e));
}

type Model = { type: 'branch' } | { type: 'cur'; f: () => Lin } | { type: 'open' };

export function solveMNA(net: Netlist, opt: SolveOptions = {}): MNAResult {
  const storage = opt.storage ?? 'dc';
  const els = net.elements.filter((e) => !opt.remove?.has(e.id)).concat(opt.extra ?? []);
  const N = net.nodeCount;
  const nv = Math.max(0, N - 1);
  const byId = new Map(els.map((e) => [e.id, e]));
  const val = (e: NetElement) => (opt.valueOverride?.has(e.id) ? opt.valueOverride.get(e.id)! : e.value);
  const swClosed = opt.switchClosed ?? switchStateAfter;
  const vIdx = (n: number) => (n === 0 ? -1 : n - 1);
  const unknowns: string[] = [];
  for (let n = 1; n < N; n++) unknowns.push(`V_{${net.nodeNames[n]}}`);

  // decidir modelo de cada elemento
  const model = new Map<string, Model>();
  const branchIdx = new Map<string, number>();
  const isBranch = (e: NetElement): boolean => {
    switch (e.kind) {
      case 'V':
      case 'VCVS':
      case 'CCVS':
      case 'AM':
        return true;
      case 'L':
        return storage !== 'ic';
      case 'C':
        return storage === 'ic';
      case 'SW':
        return swClosed(e);
      default:
        return false;
    }
  };
  for (const e of els) {
    if (isBranch(e)) {
      branchIdx.set(e.id, nv + branchIdx.size);
      unknowns.push(`I_{${e.label}}`);
      model.set(e.id, { type: 'branch' });
    }
  }
  const nUnk = nv + branchIdx.size;

  const vAcross = (e: NetElement): Lin => {
    const l = lin();
    addTerm(l, vIdx(e.n1), 1);
    addTerm(l, vIdx(e.n2), -1);
    return l;
  };
  let controlError: string | null = null;
  const depth = new Map<string, number>();
  const current = (e: NetElement): Lin => {
    // corriente a→b del elemento como expresión lineal
    if (branchIdx.has(e.id)) {
      const l = lin();
      addTerm(l, branchIdx.get(e.id)!, 1);
      return l;
    }
    const d = (depth.get(e.id) ?? 0) + 1;
    depth.set(e.id, d);
    if (d > 20) {
      controlError = `Las fuentes dependientes forman un ciclo de control que incluye a ${e.label}.`;
      return lin();
    }
    let res = lin();
    switch (e.kind) {
      case 'R': {
        const R = val(e);
        const l = vAcross(e);
        res = lin();
        addLin(res, l, 1 / R);
        break;
      }
      case 'G':
        addLin(res, vAcross(e), val(e));
        break;
      case 'I':
        res.c = val(e);
        break;
      case 'VCCS': {
        const c = byId.get(e.ctrlRef ?? '');
        if (!c) controlError = `La fuente dependiente ${e.label} no tiene una variable de control válida.`;
        else addLin(res, vAcross(c), val(e));
        break;
      }
      case 'CCCS': {
        const c = byId.get(e.ctrlRef ?? '');
        if (!c) controlError = `La fuente dependiente ${e.label} no tiene una variable de control válida.`;
        else addLin(res, current(c), val(e));
        break;
      }
      case 'C': {
        if (storage === 'companion') {
          const cm = opt.companion?.get(e.id) ?? { g: 0, j: 0 };
          addLin(res, vAcross(e), cm.g ?? 0);
          res.c += cm.j ?? 0;
        }
        break; // dc: abierto
      }
      case 'L': {
        // solo llega aquí en modo ic: fuente de corriente iL
        res.c = opt.icValues?.get(e.id) ?? 0;
        break;
      }
      default:
        break; // VM, SW abierto: corriente 0
    }
    depth.set(e.id, d - 1);
    return res;
  };

  const A: number[][] = Array.from({ length: nUnk }, () => new Array(nUnk).fill(0));
  const b: number[] = new Array(nUnk).fill(0);
  const stampRow = (row: number, l: Lin, k: number) => {
    if (row < 0) return;
    for (const [i, v] of l.t) A[row][i] += k * v;
    b[row] -= k * l.c;
  };
  for (const e of els) {
    const ie = current(e);
    // LCK: corriente que sale del nodo a (+) y entra al nodo b
    stampRow(vIdx(e.n1), ie, 1);
    stampRow(vIdx(e.n2), ie, -1);
    if (branchIdx.has(e.id)) {
      const row = branchIdx.get(e.id)!;
      const eq = vAcross(e); // v_ab ...
      switch (e.kind) {
        case 'V':
          eq.c -= val(e);
          break;
        case 'VCVS': {
          const c = byId.get(e.ctrlRef ?? '');
          if (!c) controlError = `La fuente dependiente ${e.label} no tiene una variable de control válida.`;
          else addLin(eq, vAcross(c), -val(e));
          break;
        }
        case 'CCVS': {
          const c = byId.get(e.ctrlRef ?? '');
          if (!c) controlError = `La fuente dependiente ${e.label} no tiene una variable de control válida.`;
          else addLin(eq, current(c), -val(e));
          break;
        }
        case 'L':
          if (storage === 'companion') {
            const cm = opt.companion?.get(e.id) ?? { r: 0, e: 0 };
            addTerm(eq, row, -(cm.r ?? 0));
            eq.c -= cm.e ?? 0;
          }
          break;
        case 'C':
          eq.c -= opt.icValues?.get(e.id) ?? 0;
          break;
        default:
          break; // AM, SW cerrado, L en dc: v = 0
      }
      for (const [i, v] of eq.t) A[row][i] += v;
      b[row] -= eq.c;
    }
  }
  const floating: number[] = [];
  // nodos sin camino de DC a la referencia (p. ej. tras un capacitor abierto): se fijan a 0 V con una
  // conductancia a tierra (equivale a suponer el capacitor descargado). No afecta al resto del circuito.
  {
    const par = Array.from({ length: N }, (_, i) => i);
    const f = (x: number): number => (par[x] === x ? x : (par[x] = f(par[x])));
    for (const e of els) {
      const m = model.get(e.id);
      const conductive =
        m?.type === 'branch' || e.kind === 'R' || e.kind === 'G' || (e.kind === 'C' && storage === 'companion') || ((e.kind === 'VCCS' || e.kind === 'CCCS') && false);
      if (conductive) par[f(e.n1)] = f(e.n2);
    }
    for (let n = 1; n < N; n++)
      if (f(n) !== f(0)) {
        A[n - 1][n - 1] += 1;
        floating.push(n);
      }
  }
  const empty: MNAResult = { ok: false, V: new Array(N).fill(0), el: new Map(), A, b, unknowns, cond: Infinity };
  if (controlError) return { ...empty, error: { kind: 'control', message: controlError } };
  if (nUnk === 0) return { ...empty, ok: els.length === 0 ? false : true, error: els.length === 0 ? { kind: 'empty', message: 'No hay elementos.' } : undefined, cond: 1 };
  const g = gauss(A, b);
  if (g.singular || !g.x) {
    return { ...empty, error: { kind: 'singular', message: 'El sistema de ecuaciones es singular.', column: unknowns[g.badColumn ?? 0] } };
  }
  const x = g.x;
  const V = [0, ...x.slice(0, nv)];
  // si a un nodo flotante le entra corriente, el circuito ideal no tiene solución (LCK imposible)
  const vScale = Math.max(1, ...x.map(Math.abs));
  for (const n of floating)
    if (Math.abs(V[n]) > 1e-9 * vScale)
      return { ...empty, error: { kind: 'singular', message: `Al nodo ${net.nodeNames[n]} le llega corriente de una fuente pero no tiene otro camino (viola la LCK).`, column: unknowns[n - 1] } };
  const evalLin = (l: Lin) => {
    let s = l.c;
    for (const [i, v] of l.t) s += v * x[i];
    return s;
  };
  const el = new Map<string, ElementResult>();
  for (const e of els) {
    const v = V[e.n1] - V[e.n2];
    depth.clear();
    const i = evalLin(current(e));
    el.set(e.id, { id: e.id, label: e.label, kind: e.kind, v, i, p: v * i });
  }
  return { ok: true, V, el, A, b, unknowns, cond: g.cond };
}

/** Atajo: tensión y corriente de un elemento por etiqueta */
export function byLabel(r: MNAResult, label: string): ElementResult | undefined {
  for (const e of r.el.values()) if (e.label === label) return e;
  return undefined;
}

/** Construye una netlist mínima (para pruebas o cálculos internos) */
export function makeNet(nodeCount: number, elements: Partial<NetElement>[], names?: string[]): Netlist {
  return {
    nodeCount,
    elements: elements.map((e, k) => ({
      id: e.id ?? e.label ?? `e${k}`,
      kind: e.kind!,
      label: e.label ?? e.id ?? `e${k}`,
      value: e.value ?? 0,
      n1: e.n1 ?? 0,
      n2: e.n2 ?? 0,
      ctrlRef: e.ctrlRef,
      swMode: e.swMode ?? 'close',
      t0: e.t0 ?? 0,
      ic: e.ic,
      icMode: e.icMode ?? 'dc',
      varName: e.varName,
    })),
    nodeNames: names ?? Array.from({ length: nodeCount }, (_, i) => String(i)),
    nodePoints: Array.from({ length: nodeCount }, () => []),
    autoGround: false,
    valueErrors: [],
    danglingPins: [],
  };
}
