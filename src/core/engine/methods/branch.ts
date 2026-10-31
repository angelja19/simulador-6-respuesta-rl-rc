// Método de corrientes de rama (U2, punto 2.11): LVK en cada malla + LCK en nodos con «pedigree».
import { Netlist, NetElement, isCurrentSourceLike } from '../types';
import { Topology } from '../topology';
import { texNum } from '../units';
import { ctrlName, depTex } from './names';
import { SLin, SysEq, sadd, sclean, sl, sscale, sv, texExpr, solveSystem, SolveMethod, SolvedSystem } from './symbolic';

export interface BranchAnalysis {
  ok: boolean;
  error?: string;
  branchNames: string[];
  /** para cada rama: elementos, nodo inicial y final */
  branches: { name: string; elements: string[]; from: number; to: number }[];
  eqs: SysEq[];
  system: SolvedSystem | null;
  current: Map<string, number>;
  controls: string[];
}

export function branchAnalysis(net: Netlist, topo: Topology, method: SolveMethod = 'gauss'): BranchAnalysis {
  const fail = (error: string): BranchAnalysis => ({ ok: false, error, branchNames: [], branches: [], eqs: [], system: null, current: new Map(), controls: [] });
  if (topo.crossings.length) return fail('El dibujo tiene cruces de cables sin unión; redibuje el circuito sin cruces para identificar las mallas.');
  const byId = new Map(net.elements.map((e) => [e.id, e]));
  // orientación de cada elemento respecto a su rama
  const orient = new Map<string, { b: number; s: number }>();
  const names: string[] = [];
  topo.branches.forEach((br, k) => {
    const nm = `I_{${k + 1}}`;
    names.push(nm);
    let node = br.from;
    for (const id of br.elements) {
      const e = byId.get(id)!;
      const s = e.n1 === node ? 1 : -1;
      orient.set(id, { b: k, s });
      node = e.n1 === node ? e.n2 : e.n1;
    }
  });
  const iExpr = (e: NetElement): SLin => {
    const o = orient.get(e.id);
    return o ? sv(names[o.b], o.s) : sl();
  };
  const uName = (e: NetElement) => `V_{${e.label}}`;
  const vExpr = (e: NetElement, d = 0): SLin => {
    if (d > 20) return sl();
    switch (e.kind) {
      case 'R':
        return sscale(iExpr(e), e.value);
      case 'G':
        return sscale(iExpr(e), 1 / e.value);
      case 'V':
        return sl(e.value);
      case 'VCVS': {
        const c = byId.get(e.ctrlRef ?? '');
        return c ? sscale(vExpr(c, d + 1), e.value) : sl();
      }
      case 'CCVS': {
        const c = byId.get(e.ctrlRef ?? '');
        return c ? sscale(iExpr(c), e.value) : sl();
      }
      case 'I':
      case 'VCCS':
      case 'CCCS':
        return sv(uName(e));
      default:
        return sl();
    }
  };
  const csrc = topo.edges.filter((e) => isCurrentSourceLike(e.kind));
  const unknowns = [...names, ...csrc.map(uName)];
  const eqs: SysEq[] = [];
  const sys: SLin[] = [];
  let k = 0;
  const controls: string[] = [];
  for (const e of topo.edges.filter((x) => x.kind === 'VCVS' || x.kind === 'VCCS' || x.kind === 'CCVS' || x.kind === 'CCCS')) {
    const c = byId.get(e.ctrlRef ?? '');
    if (c) controls.push(`${ctrlName(e, c)} = ${texExpr(e.kind === 'VCVS' || e.kind === 'VCCS' ? vExpr(c) : iExpr(c), unknowns)}`);
  }
  // LVK: recorrido horario, de − a + suma (+), de + a − resta (−)  (convención del curso)
  for (const m of topo.meshes) {
    let lin = sl();
    const parts: string[] = [];
    for (const it of m.items) {
      const e = byId.get(it.id)!;
      const rise = sscale(vExpr(e), -it.dir); // subida de potencial en el sentido del recorrido
      lin = sadd(lin, rise);
      const t = lvkTerm(e, it.dir, iExpr(e), byId, names);
      if (t) parts.push(t);
    }
    lin = sclean(lin);
    sys.push(lin);
    eqs.push({ n: ++k, kind: 'LVK', title: `Malla ${m.index} (sentido horario)`, raw: `${parts.join(' ').replace(/^\+\s*/, '') || '0'} = 0`, lin });
  }
  // LCK en nodos principales menos uno
  const pn = topo.principalNodes.length ? topo.principalNodes : [];
  for (const n of pn.slice(0, Math.max(0, pn.length - 1))) {
    let lin = sl();
    const inn: string[] = [];
    const out: string[] = [];
    topo.branches.forEach((br, bi) => {
      if (br.from === n && br.to === n) return;
      if (br.to === n) {
        lin = sadd(lin, sv(names[bi], 1));
        inn.push(names[bi]);
      }
      if (br.from === n) {
        lin = sadd(lin, sv(names[bi], -1));
        out.push(names[bi]);
      }
    });
    sys.push(sclean(lin));
    eqs.push({ n: ++k, kind: 'LCK', title: `Nodo ${net.nodeNames[n] === '0' ? 'de referencia' : net.nodeNames[n]} («agüita que entra = agüita que sale»)`, raw: `${inn.join(' + ') || '0'} = ${out.join(' + ') || '0'}`, lin: sclean(lin) });
  }
  // fuentes de corriente: corriente de rama conocida
  for (const e of csrc) {
    const c = byId.get(e.ctrlRef ?? '');
    const rhs = e.kind === 'I' ? sl(e.value) : !c ? sl() : e.kind === 'VCCS' ? sscale(vExpr(c), e.value) : sscale(iExpr(c), e.value);
    const lin = sclean(sadd(iExpr(e), sscale(rhs, -1)));
    sys.push(lin);
    eqs.push({ n: ++k, kind: 'Restricción', title: `Fuente de corriente ${e.label}`, raw: `${texExpr(iExpr(e))} = ${e.kind === 'I' ? texNum(e.value, 5) : depTex(e, c)}`, lin });
  }
  if (sys.length !== unknowns.length) return fail(`Se obtuvieron ${sys.length} ecuaciones para ${unknowns.length} incógnitas; revise que el circuito sea conexo y planar.`);
  const system = solveSystem(sys, unknowns, method);
  if (system.singular || !system.values) return fail('El sistema de ecuaciones de rama es singular.');
  const current = new Map<string, number>();
  for (const e of net.elements) {
    const ie = iExpr(e);
    let v = ie.c;
    for (const [nm, kk] of ie.t) v += kk * system.values.get(nm)!;
    current.set(e.id, v);
  }
  return {
    ok: true,
    branchNames: names,
    branches: topo.branches.map((b, i) => ({ name: names[i], elements: b.elements, from: b.from, to: b.to })),
    eqs,
    system,
    current,
    controls,
  };
}

function lvkTerm(e: NetElement, dir: number, ie: SLin, byId: Map<string, NetElement>, order: string[]): string | null {
  // subida = −dir·v_ab
  const curr = texExpr(sscale(ie, 1), order);
  switch (e.kind) {
    case 'R': {
      // la polaridad + está donde entra la corriente de rama
      const s = sscale(ie, -dir);
      const neg = [...s.t.values()][0] < 0;
      return `${neg ? '-' : '+'} ${texNum(e.value, 5)}${curr.replace(/^-/, '')}`;
    }
    case 'V':
      return `${dir > 0 ? '-' : '+'} ${texNum(e.value, 5)}`;
    case 'VCVS':
    case 'CCVS':
      return `${dir > 0 ? '-' : '+'} ${depTex(e, byId.get(e.ctrlRef ?? ''))}`;
    case 'I':
    case 'VCCS':
    case 'CCCS':
      return `${dir > 0 ? '-' : '+'} V_{${e.label}}`;
    default:
      return null;
  }
}
