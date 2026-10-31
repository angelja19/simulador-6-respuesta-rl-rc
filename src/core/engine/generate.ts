// Generador de circuitos aleatorios válidos (Practicar y pruebas cruzadas).
import { analyze } from './analyze';
import { CircuitBuilder } from './builder';
import { Circuit, Kind } from './types';

export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: Rng, arr: T[]): T => arr[Math.floor(r() * arr.length)];
const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export function randR(r: Rng, simple = true): number {
  if (simple) return pick(r, [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100]);
  return pick(r, E12) * pick(r, [10, 100, 1000, 10000]);
}
export const randV = (r: Rng) => pick(r, [5, 6, 9, 10, 12, 15, 20, 24, 30, 40, 50, 60, 100]);
export const randI = (r: Rng) => pick(r, [0.5, 1, 1.5, 2, 3, 4, 5]);

export interface GenOptions {
  cols?: number;
  rows?: number;
  vSources?: number;
  iSources?: number;
  dependent?: boolean;
  allowWires?: boolean;
  simpleValues?: boolean;
}

/** Red en grilla de mallas con elementos aleatorios. Devuelve un circuito que pasa el validador. */
export function randomGridCircuit(r: Rng, o: GenOptions = {}): Circuit {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cols = o.cols ?? 2;
    const rows = o.rows ?? 1;
    const S = 8;
    const edges: { a: [number, number]; b: [number, number] }[] = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) edges.push({ a: [i * S, j * S], b: [(i + 1) * S, j * S] });
    for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) edges.push({ a: [i * S, j * S], b: [i * S, (j + 1) * S] });
    const kinds: (Kind | 'W')[] = edges.map(() => 'R');
    const order = edges.map((_, k) => k);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let p = 0;
    for (let k = 0; k < (o.vSources ?? 1); k++) kinds[order[p++]] = 'V';
    for (let k = 0; k < (o.iSources ?? 0); k++) kinds[order[p++]] = 'I';
    if (o.dependent) kinds[order[p++]] = pick(r, ['VCVS', 'VCCS', 'CCVS', 'CCCS'] as Kind[]);
    if (o.allowWires !== false) {
      // algunos tramos de la fila inferior como cable (retorno común)
      for (let q = p; q < order.length; q++) {
        const e = edges[order[q]];
        if (e.a[1] === rows * S && e.b[1] === rows * S && r() < 0.6) kinds[order[q]] = 'W';
      }
    }
    const b = new CircuitBuilder();
    let nR = 0;
    let nV = 0;
    let nI = 0;
    let nD = 0;
    const rIds: string[] = [];
    const depIdx: number[] = [];
    edges.forEach((e, k) => {
      const flip = r() < 0.5;
      const [a, bb] = flip ? [e.b, e.a] : [e.a, e.b];
      const kd = kinds[k];
      if (kd === 'W') b.wire(e.a, e.b);
      else if (kd === 'R') {
        const id = `R${++nR}`;
        rIds.push(id);
        b.el('R', `R${nR}`, String(randR(r, o.simpleValues !== false)), a, bb, { id });
      } else if (kd === 'V') b.el('V', `E${++nV}`, String(randV(r)), a, bb);
      else if (kd === 'I') b.el('I', `I${++nI}`, String(randI(r)), a, bb);
      else {
        nD++;
        depIdx.push(k);
        const gain = kd === 'VCVS' || kd === 'CCCS' ? pick(r, [0.5, 1, 2, 3, 4, 5]) : kd === 'VCCS' ? pick(r, [0.05, 0.1, 0.2, 0.5]) : pick(r, [2, 3, 5, 10, 20]);
        b.el(kd, kd.startsWith('V') && kd.endsWith('VS') ? `Vd${nD}` : kd.endsWith('VS') ? `Vd${nD}` : `Id${nD}`, String(gain), a, bb, { id: `D${nD}` });
      }
    });
    const c = b.build();
    // asignar control de dependientes
    for (const el of c.elements) if (el.id.startsWith('D') && rIds.length) el.ctrlRef = pick(r, rIds);
    c.elements.push({ id: 'gnd', kind: 'GND', label: 'Tierra', value: '', x: 0, y: rows * S, rot: 0 });
    const an = analyze(c);
    if (!an.ok) continue;
    if (an.issues.some((i) => i.severity === 'warning' && i.code !== 'sincorriente')) continue;
    // evitar valores absurdos
    const maxI = Math.max(...[...an.dc!.el.values()].map((x) => Math.abs(x.i)));
    if (!isFinite(maxI) || maxI > 1e3 || maxI < 1e-6 || an.topo.meshes.length !== an.topo.independentLoops) continue;
    return c;
  }
  throw new Error('No se pudo generar un circuito válido');
}
