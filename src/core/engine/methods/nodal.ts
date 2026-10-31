// Método de voltajes de nodo y supernodos (corrientes que SALEN del nodo, como en el TP4 de nodos).
import { Netlist, NetElement } from '../types';
import { texNum } from '../units';
import { ctrlName, depTex } from './names';
import { SLin, SysEq, sadd, sclean, sl, sscale, sv, texExpr, solveSystem, SolveMethod, SolvedSystem } from './symbolic';

export interface NodalAnalysis {
  ok: boolean;
  error?: string;
  reference: number;
  unknowns: string[];
  eqs: SysEq[];
  system: SolvedSystem | null;
  V: number[];
  supernodes: { nodes: number[]; sources: string[]; withReference: boolean }[];
  controls: string[];
  /** true si se necesitó agregar corrientes de fuentes de voltaje como incógnitas (MNA) */
  usedMNA: boolean;
  notes: string[];
}

/** Elementos que fijan una diferencia de voltaje (forman supernodos) */
export function isVLike(e: NetElement, storage: 'dc' | 'ic' = 'dc', swClosed: (e: NetElement) => boolean = () => true): boolean {
  if (e.kind === 'V' || e.kind === 'VCVS' || e.kind === 'CCVS' || e.kind === 'AM') return true;
  if (e.kind === 'L') return storage === 'dc';
  if (e.kind === 'C') return storage === 'ic';
  if (e.kind === 'SW') return swClosed(e);
  return false;
}

export function nodalAnalysis(net: Netlist, method: SolveMethod = 'gauss', isOpen: (e: NetElement) => boolean = (e) => e.kind === 'VM' || e.kind === 'C'): NodalAnalysis {
  const N = net.nodeCount;
  const Vn = (n: number) => (n === 0 ? '' : `V_{${net.nodeNames[n]}}`);
  const unknowns = Array.from({ length: N - 1 }, (_, i) => Vn(i + 1));
  const els = net.elements.filter((e) => !isOpen(e));
  const byId = new Map(net.elements.map((e) => [e.id, e]));
  const fail = (error: string): NodalAnalysis => ({ ok: false, error, reference: 0, unknowns, eqs: [], system: null, V: [], supernodes: [], controls: [], usedMNA: false, notes: [] });
  const nv = (n: number): SLin => (n === 0 ? sl() : sv(Vn(n)));
  const vab = (e: NetElement) => sadd(nv(e.n1), sscale(nv(e.n2), -1));
  let needMNA = false;
  const iExpr = (e: NetElement, depth = 0): SLin => {
    if (depth > 20) return sl();
    switch (e.kind) {
      case 'R':
        return sscale(vab(e), 1 / e.value);
      case 'G':
        return sscale(vab(e), e.value);
      case 'I':
        return sl(e.value);
      case 'VCCS': {
        const c = byId.get(e.ctrlRef ?? '');
        return c ? sscale(vab(c), e.value) : sl();
      }
      case 'CCCS': {
        const c = byId.get(e.ctrlRef ?? '');
        return c ? sscale(iExpr(c, depth + 1), e.value) : sl();
      }
      default:
        if (isVLike(e)) {
          needMNA = true;
          return sv(`I_{${e.label}}`);
        }
        return sl();
    }
  };
  // supernodos
  const vl = els.filter((e) => isVLike(e));
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of vl) {
    const a = find(e.n1);
    const b = find(e.n2);
    if (a === b) return fail(`Las fuentes de voltaje (o elementos de 0 V) forman un lazo cerrado que incluye a ${e.label}; el método de nodos no puede plantearse así.`);
    parent[a] = b;
  }
  const groups = new Map<number, number[]>();
  for (let n = 0; n < N; n++) {
    const r = find(n);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(n);
  }
  const eqs: SysEq[] = [];
  const sys: SLin[] = [];
  const controls: string[] = [];
  let k = 0;
  // controles
  for (const e of els.filter((x) => x.kind === 'VCVS' || x.kind === 'VCCS' || x.kind === 'CCVS' || x.kind === 'CCCS')) {
    const c = byId.get(e.ctrlRef ?? '');
    if (!c) continue;
    const ex = e.kind === 'VCVS' || e.kind === 'VCCS' ? vab(c) : iExpr(c);
    controls.push(`${ctrlName(e, c)} = ${texExpr(ex, unknowns)}`);
  }
  // restricciones de fuentes de voltaje
  for (const e of vl) {
    let rhs: SLin;
    let rhsTex: string;
    if (e.kind === 'V') {
      rhs = sl(e.value);
      rhsTex = texNum(e.value, 5);
    } else if (e.kind === 'VCVS' || e.kind === 'CCVS') {
      const c = byId.get(e.ctrlRef ?? '');
      rhs = !c ? sl() : e.kind === 'VCVS' ? sscale(vab(c), e.value) : sscale(iExpr(c), e.value);
      rhsTex = depTex(e, c);
    } else {
      rhs = sl(0);
      rhsTex = '0';
    }
    const lin = sclean(sadd(vab(e), sscale(rhs, -1)));
    sys.push(lin);
    const lhs = e.n2 === 0 ? Vn(e.n1) : e.n1 === 0 ? `-${Vn(e.n2)}` : `${Vn(e.n1)} - ${Vn(e.n2)}`;
    const withRef = e.n1 === 0 || e.n2 === 0;
    eqs.push({ n: ++k, kind: 'Restricción', title: withRef ? `Fuente ${e.label} conectada a la referencia: voltaje de nodo conocido` : `Supernodo: fuente ${e.label} entre $${Vn(e.n1)}$ (+) y $${Vn(e.n2)}$ (−)`, raw: `${lhs} = ${rhsTex}`, lin });
  }
  // LCK por nodo o supernodo (excepto el que contiene la referencia)
  const supernodes: NodalAnalysis['supernodes'] = [];
  for (const [, nodes] of groups) {
    const inner = vl.filter((e) => nodes.includes(e.n1));
    if (nodes.length > 1 && !(nodes.includes(0) && nodes.length === 2)) supernodes.push({ nodes, sources: inner.map((e) => e.label), withReference: nodes.includes(0) });
    if (nodes.includes(0)) continue;
    const leaving: string[] = [];
    const entering: string[] = [];
    let lin = sl();
    for (const e of els) {
      const inA = nodes.includes(e.n1);
      const inB = nodes.includes(e.n2);
      if (inA === inB) continue;
      const s = inA ? 1 : -1; // corriente a→b sale del grupo si a está dentro
      const ie = iExpr(e);
      lin = sadd(lin, sscale(ie, s));
      const from = inA ? e.n1 : e.n2;
      const to = inA ? e.n2 : e.n1;
      if (e.kind === 'R' || e.kind === 'G') {
        const num = to === 0 ? Vn(from) : `${Vn(from)} - ${Vn(to)}`;
        leaving.push(e.kind === 'R' ? `\\dfrac{${num}}{${texNum(e.value, 5)}}` : `${texNum(e.value, 5)}(${num})`);
      } else if (e.kind === 'I') {
        // fuente que entra al grupo va al lado derecho
        if (s > 0) leaving.push(texNum(e.value, 5));
        else entering.push(texNum(e.value, 5));
      } else if (e.kind === 'VCCS' || e.kind === 'CCCS') {
        const t = depTex(e, byId.get(e.ctrlRef ?? ''));
        if (s > 0) leaving.push(t);
        else entering.push(t);
      } else if (isVLike(e)) {
        leaving.push(`${s > 0 ? '' : '-'}I_{${e.label}}`);
      }
    }
    lin = sclean(lin);
    sys.push(lin);
    const title = nodes.length > 1 ? `LCK en el supernodo {${nodes.map((x) => `$${Vn(x)}$`).filter((x) => x !== '$$').join(', ')}} (corrientes que salen = corrientes que entran)` : `LCK en el nodo $${Vn(nodes[0])}$ (corrientes que salen = corrientes que entran)`;
    eqs.push({ n: ++k, kind: 'LCK', title, raw: `${leaving.join(' + ') || '0'} = ${entering.join(' + ') || '0'}`, lin });
  }
  let unk = unknowns.slice();
  if (needMNA) {
    // corrientes de fuentes de voltaje usadas como control: se agregan como incógnitas y se plantea LCK en un nodo de la fuente
    const extra = new Set<string>();
    for (const l of sys) for (const n of l.t.keys()) if (n.startsWith('I_{')) extra.add(n);
    unk = unk.concat([...extra]);
    for (const name of extra) {
      const e = els.find((x) => `I_{${x.label}}` === name)!;
      const node = e.n1 !== 0 ? e.n1 : e.n2;
      let lin = sl();
      for (const x of els) {
        if (x.n1 === x.n2) continue;
        if (x.n1 === node) lin = sadd(lin, isVLike(x) ? sv(`I_{${x.label}}`) : iExpr(x));
        if (x.n2 === node) lin = sadd(lin, sscale(isVLike(x) ? sv(`I_{${x.label}}`) : iExpr(x), -1));
      }
      sys.push(sclean(lin));
      eqs.push({ n: ++k, kind: 'LCK', title: `LCK en $${Vn(node)}$ para hallar la corriente de ${e.label} (incógnita adicional)`, raw: texExpr(lin) + ' = 0', lin });
    }
    // las corrientes de V-like no usadas como control quedan fuera: si aparecen se cuentan arriba
    const vUnk = new Set(unk.filter((u) => u.startsWith('I_{')));
    for (const e of vl) if (!vUnk.has(`I_{${e.label}}`)) {/* no necesaria */}
  }
  if (sys.length !== unk.length) {
    return fail(`El planteo de nodos dio ${sys.length} ecuaciones para ${unk.length} incógnitas. Revise si hay nodos flotantes o fuentes en lazo.`);
  }
  const system = solveSystem(sys, unk, method);
  if (system.singular || !system.values) return fail('El sistema de nodos es singular: hay un nodo sin camino a la referencia, un corte formado solo por fuentes de corriente, o fuentes dependientes cuya ganancia anula el sistema.');
  const V = [0, ...unknowns.map((u) => system.values!.get(u)!)];
  return { ok: true, reference: 0, unknowns: unk, eqs, system, V, supernodes, controls, usedMNA: needMNA, notes: [] };
}
