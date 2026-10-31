// Método de corrientes de malla y supermallas (sentido horario, como en el TP4 de mallas).
import { Netlist, NetElement, isCurrentSourceLike } from '../types';
import { Topology } from '../topology';
import { texNum } from '../units';
import { ctrlName, depTex, iName, vName } from './names';
import { SLin, SysEq, sadd, sclean, sl, sscale, sv, texEq, texExpr, integerize, solveSystem, SolveMethod, SolvedSystem } from './symbolic';

export interface MeshAnalysis {
  ok: boolean;
  error?: string;
  meshNames: string[];
  /** ecuaciones a mostrar (restricciones, controles, LVK de mallas y supermallas) */
  eqs: SysEq[];
  /** sistema final (solo corrientes de malla) */
  system: SolvedSystem | null;
  /** corriente a→b de cada elemento */
  current: Map<string, number>;
  voltage: Map<string, number>;
  supermeshes: { meshes: number[]; sources: string[] }[];
  /** ecuaciones de control (definición de la variable de control) */
  controls: string[];
  notes: string[];
}

export function meshNameOf(i: number) {
  return `I_{${i}}`;
}

export function meshAnalysis(net: Netlist, topo: Topology, method: SolveMethod = 'gauss', isOpen: (e: NetElement) => boolean = (e) => e.kind === 'VM'): MeshAnalysis {
  const fail = (error: string): MeshAnalysis => ({ ok: false, error, meshNames: [], eqs: [], system: null, current: new Map(), voltage: new Map(), supermeshes: [], controls: [], notes: [] });
  if (topo.crossings.length) return fail(`El dibujo tiene cables que se cruzan sin unión (${topo.crossings[0].a} y ${topo.crossings[0].b}). El método de mallas necesita un circuito planar dibujado sin cruces: redibújelo o use el método de nodos.`);
  if (topo.nonPlanarByEuler) return fail('El circuito no es planar (tiene demasiadas ramas para sus nodos: e > 3n − 6). El método de mallas solo se aplica a circuitos planares; use el método de nodos.');
  const M = topo.meshes.length;
  if (M === 0) return fail('No se encontraron mallas cerradas en el dibujo.');
  if (M !== topo.independentLoops) {
    return fail(`El dibujo muestra ${M} malla(s) pero el circuito tiene ${topo.independentLoops} lazos independientes (l = b − n + 1). Revise que no haya elementos superpuestos o tierras separadas que cierren lazos fuera del dibujo; conecte las tierras con un cable.`);
  }
  const meshNames = topo.meshes.map((m) => meshNameOf(m.index));
  const els = net.elements.filter((e) => !isOpen(e));
  const byId = new Map(net.elements.map((e) => [e.id, e]));
  // incidencia elemento-malla
  const inc = new Map<string, Map<number, number>>();
  for (const m of topo.meshes) for (const it of m.items) {
    if (!inc.has(it.id)) inc.set(it.id, new Map());
    inc.get(it.id)!.set(m.index, (inc.get(it.id)!.get(m.index) ?? 0) + it.dir);
  }
  const iExpr = (e: NetElement): SLin => {
    const r = sl();
    for (const [m, s] of inc.get(e.id) ?? []) r.t.set(meshNameOf(m), (r.t.get(meshNameOf(m)) ?? 0) + s);
    return r;
  };
  const csrc = els.filter((e) => isCurrentSourceLike(e.kind));
  const uName = (e: NetElement) => `V_{${e.label}}`;
  const vExpr = (e: NetElement, depth = 0): SLin => {
    if (depth > 20) return sl();
    switch (e.kind) {
      case 'R':
        return sscale(iExpr(e), e.value);
      case 'G':
        return sscale(iExpr(e), 1 / e.value);
      case 'V':
        return sl(e.value);
      case 'VCVS': {
        const c = byId.get(e.ctrlRef ?? '');
        return c ? sscale(vExpr(c, depth + 1), e.value) : sl();
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
  // ecuaciones completas (con voltajes de fuentes de corriente como incógnitas auxiliares)
  const fullEqs: SLin[] = [];
  const fullUnk = [...meshNames, ...csrc.map(uName)];
  for (const m of topo.meshes) {
    let s = sl();
    for (const it of m.items) s = sadd(s, sscale(vExpr(byId.get(it.id)!), it.dir));
    fullEqs.push(s);
  }
  const constraint = (e: NetElement): SLin => {
    let rhs: SLin;
    if (e.kind === 'I') rhs = sl(e.value);
    else {
      const c = byId.get(e.ctrlRef ?? '');
      rhs = !c ? sl() : e.kind === 'VCCS' ? sscale(vExpr(c), e.value) : sscale(iExpr(c), e.value);
    }
    return sadd(iExpr(e), sscale(rhs, -1));
  };
  for (const e of csrc) fullEqs.push(constraint(e));
  const full = solveSystem(fullEqs, fullUnk, 'gauss');
  if (full.singular || !full.values) return fail('El sistema de mallas es singular: revise fuentes de corriente que formen un corte, o fuentes dependientes cuya ganancia anula el sistema.');

  // agrupar mallas unidas por fuentes de corriente (supermallas)
  const parent = new Map<number, number>(topo.meshes.map((m) => [m.index, m.index]));
  const find = (x: number): number => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const e of csrc) {
    const ms = [...(inc.get(e.id) ?? new Map()).keys()];
    for (let k = 1; k < ms.length; k++) parent.set(find(ms[k]), find(ms[0]));
  }
  const groups = new Map<number, number[]>();
  for (const m of topo.meshes) {
    const r = find(m.index);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(m.index);
  }
  const eqs: SysEq[] = [];
  const controls: string[] = [];
  const notes: string[] = [];
  let n = 0;
  // definición de variables de control
  for (const e of els.filter((x) => x.kind === 'VCVS' || x.kind === 'VCCS' || x.kind === 'CCVS' || x.kind === 'CCCS')) {
    const c = byId.get(e.ctrlRef ?? '');
    if (!c) continue;
    const ex = e.kind === 'VCVS' || e.kind === 'VCCS' ? vExpr(c) : iExpr(c);
    controls.push(`${ctrlName(e, c)} = ${texExpr(ex, meshNames)}`);
  }
  // restricciones de fuentes de corriente
  const supermeshes: MeshAnalysis['supermeshes'] = [];
  const sysEqs: SLin[] = [];
  for (const e of csrc) {
    const ms = [...(inc.get(e.id) ?? new Map()).entries()].filter(([, s]) => s !== 0);
    const lhs = texExpr(iExpr(e), meshNames);
    const val = e.kind === 'I' ? texNum(e.value, 5) : depTex(e, byId.get(e.ctrlRef ?? ''));
    const kindTxt = ms.length === 1 ? `fuente ${e.label} en rama exterior (solo en la malla ${ms[0][0]})` : `fuente ${e.label} compartida por las mallas ${ms.map((x) => x[0]).join(' y ')}`;
    const c = constraint(e);
    sysEqs.push(c);
    eqs.push({ n: ++n, kind: 'Restricción', title: kindTxt, raw: `${lhs} = ${val}`, lin: c });
  }
  for (const [, ms] of groups) {
    const srcIn = csrc.filter((e) => [...(inc.get(e.id) ?? new Map()).keys()].some((m) => ms.includes(m)));
    const kvlCount = ms.length - srcIn.length;
    if (srcIn.length) supermeshes.push({ meshes: ms, sources: srcIn.map((s) => s.label) });
    if (kvlCount <= 0) continue;
    // términos de la (super)malla
    const terms = new Map<string, number>();
    for (const mi of ms) {
      const m = topo.meshes.find((x) => x.index === mi)!;
      for (const it of m.items) terms.set(it.id, (terms.get(it.id) ?? 0) + it.dir);
    }
    let raw = '';
    let lin = sl();
    let first = true;
    for (const [id, d] of terms) {
      if (d === 0) continue;
      const e = byId.get(id)!;
      if (isCurrentSourceLike(e.kind)) continue; // se cancelan dentro de la supermalla
      const term = termTex(e, d, iExpr(e), meshNames, byId);
      if (!term) continue;
      raw += first ? term.replace(/^\+\s*/, '') : ` ${term}`;
      first = false;
      lin = sadd(lin, sscale(vExpr(e), d));
    }
    lin = sclean(lin);
    sysEqs.push(lin);
    const title = ms.length > 1 ? `Supermalla (mallas ${ms.join(', ')})` : `Malla ${ms[0]}`;
    eqs.push({ n: ++n, kind: 'LVK', title, raw: `${raw || '0'} = 0`, lin });
  }
  if (sysEqs.length !== M) notes.push('El número de ecuaciones no coincide con el de mallas; se usó la formulación completa.');
  const system = solveSystem(sysEqs.length === M ? sysEqs : fullEqs.slice(0, M), meshNames, method);
  const current = new Map<string, number>();
  const voltage = new Map<string, number>();
  const vals = full.values;
  for (const e of net.elements) {
    if (isOpen(e)) {
      current.set(e.id, 0);
      continue;
    }
    let i = 0;
    for (const [nm, k] of iExpr(e).t) i += k * vals.get(nm)!;
    current.set(e.id, i);
    const ve = vExpr(e);
    let v = ve.c;
    for (const [nm, k] of ve.t) v += k * vals.get(nm)!;
    voltage.set(e.id, v);
  }
  return { ok: true, meshNames, eqs, system, current, voltage, supermeshes, controls, notes };
}

/** Término de LVK al estilo del curso: R(I₁ − I₂), ±E, ±4V_Δ */
function termTex(e: NetElement, dir: number, ie: SLin, order: string[], byId: Map<string, NetElement>): string | null {
  const sgn = dir > 0 ? '+' : '-';
  const cur = texExpr(sscale(ie, dir), order);
  const curP = sclean(ie).t.size > 1 ? `(${cur})` : cur;
  switch (e.kind) {
    case 'R':
      return `+ ${texNum(e.value, 5)}${curP}`;
    case 'G':
      return `+ \\dfrac{${cur}}{${texNum(e.value, 5)}}`;
    case 'V':
      return `${sgn} ${texNum(e.value, 5)}`;
    case 'VCVS':
    case 'CCVS':
      return `${sgn} ${depTex(e, byId.get(e.ctrlRef ?? ''))}`;
    default:
      return null;
  }
}

/** Ecuación simplificada con coeficientes enteros si es posible */
export function texSimplified(l: SLin, order: string[]): string {
  const { lin } = integerize(l);
  return texEq(lin, order);
}
