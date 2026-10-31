// Convierte el dibujo del editor (elementos + cables en grilla) en una netlist con nodos numerados.
import { parseSI } from './units';
import { CElement, Circuit, ELEMENT_LEN, KIND_INFO, Netlist, NetElement, Pt } from './types';

const DIRS: Pt[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** Posición de los terminales a y b de un elemento. */
export function pinsOf(e: CElement): { a: Pt; b: Pt } {
  if (e.kind === 'GND') return { a: { x: e.x, y: e.y }, b: { x: e.x, y: e.y } };
  const d = DIRS[e.rot];
  const p0 = { x: e.x, y: e.y };
  const p1 = { x: e.x + d.x * ELEMENT_LEN, y: e.y + d.y * ELEMENT_LEN };
  return e.flip ? { a: p1, b: p0 } : { a: p0, b: p1 };
}

export const key = (p: Pt) => `${p.x},${p.y}`;

class UF {
  parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = k;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** ¿El punto p está sobre el segmento ab (incluidos extremos)? */
export function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  return p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9 && p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9;
}

export function parseElementValue(e: CElement): { ok: boolean; value: number; message?: string } {
  const info = KIND_INFO[e.kind];
  if (e.kind === 'GND' || e.kind === 'AM' || e.kind === 'VM') return { ok: true, value: 0 };
  if (e.kind === 'SW') {
    const r = parseSI(e.t0 ?? '0', 's');
    if (!r.ok) return { ok: false, value: 0, message: `Instante de conmutación de ${e.label}: ${r.error}` };
    return { ok: true, value: r.value! };
  }
  const r = parseSI(e.value, info.unit || undefined);
  if (!r.ok) return { ok: false, value: 0, message: `${e.label}: ${r.error}` };
  return { ok: true, value: r.value! };
}

export function buildNetlist(c: Circuit): Netlist {
  const uf = new UF();
  const pts: Pt[] = [];
  const addPt = (p: Pt) => {
    pts.push(p);
    uf.find(key(p));
  };
  for (const e of c.elements) {
    const { a, b } = pinsOf(e);
    addPt(a);
    if (e.kind !== 'GND') addPt(b);
  }
  for (const w of c.wires) {
    addPt(w.a);
    addPt(w.b);
    uf.union(key(w.a), key(w.b));
  }
  // uniones automáticas: cualquier punto sobre el interior de un cable se une a él
  for (const w of c.wires) {
    for (const p of pts) if (onSegment(p, w.a, w.b)) uf.union(key(p), key(w.a));
  }
  // todas las tierras son el mismo nodo
  const gnds = c.elements.filter((e) => e.kind === 'GND');
  for (let i = 1; i < gnds.length; i++) uf.union(key(pinsOf(gnds[0]).a), key(pinsOf(gnds[i]).a));

  // agrupar puntos por raíz
  const groups = new Map<string, Pt[]>();
  const seen = new Set<string>();
  for (const p of pts) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const r = uf.find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(p);
  }
  // nodos que tocan al menos un terminal de elemento (no-GND)
  const rootTerminalCount = new Map<string, number>();
  for (const e of c.elements) {
    if (e.kind === 'GND') continue;
    const { a, b } = pinsOf(e);
    for (const p of [a, b]) {
      const r = uf.find(key(p));
      rootTerminalCount.set(r, (rootTerminalCount.get(r) ?? 0) + 1);
    }
  }
  let groundRoot: string | null = gnds.length ? uf.find(key(pinsOf(gnds[0]).a)) : null;
  let autoGround = false;
  const roots = [...groups.keys()].filter((r) => rootTerminalCount.has(r) || r === groundRoot);
  if (!groundRoot && roots.length) {
    // tierra automática: el nodo con más conexiones (empate: el más abajo)
    autoGround = true;
    let best = roots[0];
    for (const r of roots) {
      const cr = rootTerminalCount.get(r) ?? 0;
      const cb = rootTerminalCount.get(best) ?? 0;
      const yr = Math.max(...groups.get(r)!.map((p) => p.y));
      const yb = Math.max(...groups.get(best)!.map((p) => p.y));
      if (cr > cb || (cr === cb && yr > yb)) best = r;
    }
    groundRoot = best;
  }
  // numerar: tierra = 0; el resto por posición (arriba-izquierda primero)
  const others = roots.filter((r) => r !== groundRoot);
  const minPt = (r: string) => {
    const g = groups.get(r)!;
    return g.reduce((m, p) => (p.y < m.y || (p.y === m.y && p.x < m.x) ? p : m), g[0]);
  };
  others.sort((r1, r2) => {
    const a = minPt(r1);
    const b = minPt(r2);
    return a.x - b.x || a.y - b.y;
  });
  const index = new Map<string, number>();
  if (groundRoot) index.set(groundRoot, 0);
  others.forEach((r, i) => index.set(r, i + 1));
  const nodeCount = (groundRoot ? 1 : 0) + others.length;
  const nodePoints: Pt[][] = new Array(nodeCount).fill(null).map(() => []);
  for (const [r, g] of groups) if (index.has(r)) nodePoints[index.get(r)!] = g;
  const nodeNames = new Array(nodeCount).fill('');
  nodeNames[0] = '0';
  const userNamed = new Set<number>();
  for (const nn of c.nodeNames ?? []) {
    const r = uf.find(key(nn));
    if (index.has(r) && nn.name.trim()) {
      nodeNames[index.get(r)!] = nn.name.trim();
      userNamed.add(index.get(r)!);
    }
  }
  const used = new Set(nodeNames.filter(Boolean));
  let auto = 1;
  for (let i = 1; i < nodeCount; i++) {
    if (userNamed.has(i)) continue;
    while (used.has(String(auto))) auto++;
    nodeNames[i] = String(auto);
    used.add(String(auto));
    auto++;
  }

  const elements: NetElement[] = [];
  const valueErrors: Netlist['valueErrors'] = [];
  const danglingPins: Netlist['danglingPins'] = [];
  for (const e of c.elements) {
    if (e.kind === 'GND') continue;
    const { a, b } = pinsOf(e);
    const ra = uf.find(key(a));
    const rb = uf.find(key(b));
    const pv = parseElementValue(e);
    if (!pv.ok) valueErrors.push({ id: e.id, label: e.label, message: pv.message! });
    let ic: number | undefined;
    if ((e.kind === 'L' || e.kind === 'C') && e.icMode === 'given') {
      const r = parseSI(e.ic ?? '0', e.kind === 'L' ? 'A' : 'V');
      if (!r.ok) valueErrors.push({ id: e.id, label: e.label, message: `Condición inicial de ${e.label}: ${r.error}` });
      else ic = r.value;
    }
    let t0: number | undefined;
    if (e.kind === 'SW') t0 = pv.value;
    for (const [pin, r, p] of [['a', ra, a], ['b', rb, b]] as const) {
      if ((rootTerminalCount.get(r) ?? 0) < 2 && r !== groundRoot) danglingPins.push({ id: e.id, label: e.label, pin, at: p });
      else if (r === groundRoot && (rootTerminalCount.get(r) ?? 0) < 2 && !autoGround) danglingPins.push({ id: e.id, label: e.label, pin, at: p });
    }
    elements.push({
      id: e.id,
      kind: e.kind,
      label: e.label,
      value: pv.value,
      n1: index.get(ra) ?? 0,
      n2: index.get(rb) ?? 0,
      ctrlRef: e.ctrlRef,
      swMode: e.swMode ?? 'close',
      t0,
      ic,
      icMode: e.icMode ?? 'dc',
      varName: e.varName,
    });
  }
  return { nodeCount, elements, nodeNames, nodePoints, autoGround, valueErrors, danglingPins };
}

/** Nombre de nodo para LaTeX: V_{1}, V_{a} */
export function nodeV(net: Netlist, n: number): string {
  if (n === 0) return '0';
  return `V_{${net.nodeNames[n]}}`;
}
