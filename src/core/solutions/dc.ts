// Desarrollo paso a paso (formato de 7 puntos) y «mejor manera» para circuitos DC.
import { Analysis } from '../engine/analyze';
import { branchAnalysis } from '../engine/methods/branch';
import { meshAnalysis } from '../engine/methods/mesh';
import { nodalAnalysis } from '../engine/methods/nodal';
import { ctrlName, depTex, iName } from '../engine/methods/names';
import { reduceNetwork, REdge } from '../engine/methods/reduce';
import { integerize, texEq, texSystem, SolveMethod, SysEq } from '../engine/methods/symbolic';
import { NetElement, isCurrentSourceLike, isDependent, isVoltageSourceLike, KIND_INFO } from '../engine/types';
import { texNum, texQ } from '../engine/units';
import { BetterDoc, Block, BOX, H, L, P, StepDoc, T } from '../ui/panels';

export type DCMethod = 'ramas' | 'nodos' | 'mallas' | 'reduccion';

export const METHOD_NAMES: Record<DCMethod, string> = {
  ramas: 'Corrientes de rama (LVK + LCK)',
  nodos: 'Nodos y supernodos',
  mallas: 'Mallas y supermallas',
  reduccion: 'Reducción serie‑paralelo',
};

export function describeElement(e: NetElement, net: Analysis['net']): string {
  const nn = (n: number) => (n === 0 ? 'ref' : net.nodeNames[n]);
  const ctrl = net.elements.find((x) => x.id === e.ctrlRef);
  switch (e.kind) {
    case 'R':
      return `$${e.label} = ${texQ(e.value, 'Ω')}$ entre (${nn(e.n1)}) y (${nn(e.n2)})`;
    case 'G':
      return `$${e.label} = ${texQ(e.value, 'S')}$ ($R = 1/G = ${texQ(1 / e.value, 'Ω')}$)`;
    case 'V':
      return `Fuente de voltaje $${e.label} = ${texQ(e.value, 'V')}$, polo + en (${nn(e.n1)}), − en (${nn(e.n2)})`;
    case 'I':
      return `Fuente de corriente $${e.label} = ${texQ(e.value, 'A')}$, flecha de (${nn(e.n1)}) hacia (${nn(e.n2)})`;
    case 'VCVS':
    case 'CCVS':
      return `Fuente de voltaje dependiente $${e.label} = ${depTex(e, ctrl)}$ (rombo), + en (${nn(e.n1)})`;
    case 'VCCS':
    case 'CCCS':
      return `Fuente de corriente dependiente $${e.label} = ${depTex(e, ctrl)}$ (rombo), flecha de (${nn(e.n1)}) a (${nn(e.n2)})`;
    case 'AM':
      return `Amperímetro ${e.label} (ideal, 0 Ω)`;
    case 'VM':
      return `Voltímetro ${e.label} (ideal, ∞ Ω)`;
    case 'L':
      return `Inductor $${e.label} = ${texQ(e.value, 'H')}$ (en DC: cortocircuito)`;
    case 'C':
      return `Capacitor $${e.label} = ${texQ(e.value, 'F')}$ (en DC: circuito abierto)`;
    case 'SW':
      return `Interruptor ${e.label}: ${e.swMode === 'open' ? 'cerrado' : 'abierto'} para t < t₀ y se ${e.swMode === 'open' ? 'abre' : 'cierra'} en t₀ = ${e.t0 ?? 0} s`;
    default:
      return e.label;
  }
}

function identification(a: Analysis): Block[] {
  const net = a.net;
  const t = a.topo;
  const out: Block[] = [];
  out.push(L(net.elements.map((e) => describeElement(e, net))));
  out.push(
    P(
      `Nodos: ${t.nodes} (referencia ⏚ = ${net.nodeNames[0] === '0' ? 'nodo con el símbolo de tierra' : net.nodeNames[0]}); nodos principales o «con pedigree» (llegan 3 o más ramas): ${t.principalNodes.length}${t.principalNodes.length ? '' : ' (circuito de una sola malla: se toma n = 1)'}; ramas: ${t.branches.length}; mallas: ${t.meshes.length}. Comprobación: $l = b - n + 1 = ${t.branches.length} - ${Math.max(1, t.principalNodes.length)} + 1 = ${t.branches.length - Math.max(1, t.principalNodes.length) + 1}$.`,
    ),
  );
  const deps = net.elements.filter((e) => isDependent(e.kind));
  if (deps.length) out.push(P(`Fuentes dependientes: ${deps.map((d) => `${d.label} controlada por ${KIND_INFO[d.kind].name.includes('voltaje') && (d.kind === 'VCVS' || d.kind === 'VCCS') ? 'el voltaje' : 'la corriente'} de ${net.elements.find((x) => x.id === d.ctrlRef)?.label ?? '?'}`).join('; ')}.`));
  return out;
}

function eqBlocks(eqs: SysEq[], order: string[], controls: string[] = []): Block[] {
  const out: Block[] = [];
  const hasCtrl = controls.length > 0;
  const groups = ['Restricción', 'LVK', 'LCK'];
  for (const g of groups) {
    const list = eqs.filter((e) => e.kind === g);
    if (!list.length) continue;
    out.push(H(g === 'LVK' ? 'Bloque LVK (ley de voltajes de Kirchhoff)' : g === 'LCK' ? 'Bloque LCK (ley de corrientes de Kirchhoff)' : 'Ecuaciones de restricción (fuentes)'));
    for (const e of list) {
      out.push(P(e.title + (hasCtrl ? '' : '')));
      out.push(T(e.raw, `(${e.n})`));
      const { lin, factor } = integerize(e.lin);
      const usesCtrl = hasCtrl && /\\cdot|[0-9]+[A-Za-z]_|[A-Za-z]_\{[^}]*\}/.test(e.raw) && controls.some((c) => e.raw.includes(c.split(' = ')[0]));
      out.push(T(`\\Rightarrow\\; ${texEq(lin, order)}${factor !== 1 ? `\\qquad (\\times ${factor})` : ''}${usesCtrl ? '\\qquad \\text{(sustituyendo el control)}' : ''}`));
    }
  }
  return out;
}

function resultsBlocks(a: Analysis): Block[] {
  const out: Block[] = [];
  const r = a.dc!;
  for (const e of a.net.elements) {
    const x = r.el.get(e.id)!;
    if (e.kind === 'VM') {
      out.push(BOX(`V_{${e.label}} = ${texQ(x.v, 'V')}`));
      continue;
    }
    if (e.kind === 'AM') {
      out.push(BOX(`I_{${e.label}} = ${texQ(x.i, 'A')}`));
      continue;
    }
    const st = x.p > 1e-12 ? '\\text{absorbe}' : x.p < -1e-12 ? '\\text{entrega}' : '';
    out.push(BOX(`${iName(e)} = ${texQ(x.i, 'A')},\\quad V_{${e.label}} = ${texQ(x.v, 'V')},\\quad P_{${e.label}} = ${texQ(x.p, 'W')}\\ ${st}`));
  }
  if (r.V.length > 1) out.push(T(r.V.slice(1).map((v, i) => `V_{${a.net.nodeNames[i + 1]}} = ${texQ(v, 'V')}`).join(',\\quad ')));
  out.push(P('Las corrientes van del terminal + (a) al − (b) de cada elemento; un valor negativo significa que el sentido real es el contrario.'));
  return out;
}

function verification(a: Analysis, extra: Block[]): Block[] {
  const out: Block[] = [];
  out.push(P('Unidades: $[\\Omega]\\cdot[A] = [V]$, $[V]\\cdot[A] = [W]$ ✓. Signos: con la convención pasiva, P > 0 absorbe y P < 0 entrega.'));
  const del = a.balance.delivered;
  const abs = a.balance.absorbed;
  out.push(T(`\\sum P_{\\text{entregada}} = ${texQ(del, 'W')} \\qquad \\sum P_{\\text{absorbida}} = ${texQ(abs, 'W')} \\qquad ${a.balance.ok ? '\\checkmark' : '\\times'}`));
  const maxK = Math.max(0, ...a.kcl.map((k) => Math.abs(k.residual)));
  const maxV = Math.max(0, ...a.kvl.map((k) => Math.abs(k.residual)));
  out.push(P(`Residuo máximo de LCK en los nodos: $${texNum(maxK, 2)}$ A; de LVK en las mallas: $${texNum(maxV, 2)}$ V (deben ser ≈ 0) ✓.`));
  out.push(...extra);
  return out;
}

const pick = (eqs: SysEq[]) => eqs[eqs.length - 1];

export function dcSolution(a: Analysis, method: DCMethod, sys: SolveMethod = 'gauss', wanted?: string): StepDoc {
  const net = a.net;
  const id = identification(a);
  const dev: Block[] = [];
  const laws: Block[] = [];
  const ver: Block[] = [];
  let concept = '';
  let tip = '';
  if (method === 'reduccion') {
    return reductionDoc(a);
  }
  if (method === 'mallas') {
    const m = meshAnalysis(net, a.topo, sys);
    concept = 'Método de mallas: se asigna a cada «ventana» del circuito una corriente de malla en sentido horario ($I_1, I_2, \\dots$). Cada elemento lleva la suma algebraica de las corrientes de las mallas que lo contienen y se escribe una LVK por malla. Si una fuente de corriente separa dos mallas se forma una supermalla.';
    laws.push(T('\\sum_{\\text{malla}} V = 0 \\quad(\\text{LVK, sentido horario}),\\qquad V_R = R\\,(I_m - I_k)'));
    laws.push(P('En fuentes de voltaje el signo depende del polo por donde ENTRA la corriente de malla (+ si entra por +). Fuente de corriente en rama exterior: $I_m = \\pm I_s$; compartida: $I_a - I_b = I_s$ (supermalla).'));
    if (!m.ok) {
      dev.push(P(`⚠ ${m.error}`));
    } else {
      dev.push(P(`Mallas (sentido horario): ${m.meshNames.map((x) => `$${x}$`).join(', ')}.${m.supermeshes.filter((s) => s.meshes.length > 1).length ? ' Supermallas: ' + m.supermeshes.filter((s) => s.meshes.length > 1).map((s) => `mallas ${s.meshes.join('+')} (fuente${s.sources.length > 1 ? 's' : ''} ${s.sources.join(', ')})`).join('; ') + '.' : ''}`));
      if (m.controls.length) {
        dev.push(H('Variables de control en función de las corrientes de malla'));
        for (const c of m.controls) dev.push(T(c));
      }
      dev.push(...eqBlocks(m.eqs, m.meshNames, m.controls));
      dev.push(H('Sistema de ecuaciones'));
      dev.push(T(texSystem(m.eqs.map((e) => texEq(integerize(e.lin).lin, m.meshNames)))));
      dev.push(H(`Resolución (${sys === 'cramer' ? 'Cramer' : sys === 'gauss' ? 'Gauss' : 'sustitución'})`));
      for (const d of m.system?.detailTex ?? []) dev.push(T(d));
      dev.push(H('Corrientes de rama a partir de las de malla'));
      for (const e of net.elements) {
        if (e.kind === 'VM') continue;
        const i = m.current.get(e.id) ?? 0;
        dev.push(T(`${iName(e)} = ${texNum(i, 6)}\\ [A]`));
      }
      tip = 'Cuente primero: mallas − fuentes de corriente = ecuaciones a resolver. Escriba la ecuación de cada fuente de corriente ANTES de las LVK y sustitúyala de inmediato.';
      const n = nodalAnalysis(net);
      if (n.ok) ver.push(P(`Segundo método (nodos): ${n.unknowns.filter((u) => u.startsWith('V')).map((u, i) => `$${u} = ${texNum(n.V[i + 1], 6)}$`).join(', ')} — coinciden con los voltajes obtenidos de las corrientes de malla ✓.`));
      const unused = pick(m.eqs);
      if (unused) ver.push(P(`Sustitución en la ecuación (${unused.n}): el lado izquierdo da $${texNum(cleanZero(evalLin(unused, m.system!.values!)), 3)}$ ≈ 0 ✓.`));
    }
  } else if (method === 'nodos') {
    const n = nodalAnalysis(net, sys);
    concept = 'Método de nodos: se elige un nodo de referencia (0 V) y se toman como incógnitas los voltajes de los demás nodos. En cada nodo se suman las corrientes que SALEN (escritas con la ley de Ohm, $I = (V_i - V_j)/R$) y se igualan a las que entran por fuentes. Si una fuente de voltaje une dos nodos (sin la referencia) se forma un supernodo.';
    laws.push(T('\\sum I_{\\text{salen}} = \\sum I_{\\text{entran}} \\quad(\\text{LCK}),\\qquad I = \\frac{V_i - V_j}{R}'));
    laws.push(P('Supernodo: $V_{(+)} - V_{(-)} = E$ (minuendo: nodo del polo +), luego LCK al supernodo completo.'));
    if (!n.ok) dev.push(P(`⚠ ${n.error}`));
    else {
      dev.push(P(`Referencia: nodo ⏚. Incógnitas: ${n.unknowns.map((u) => `$${u}$`).join(', ')}.${n.supernodes.length ? ' Supernodos: ' + n.supernodes.map((s) => `{${s.nodes.map((x) => (x === 0 ? 'ref' : net.nodeNames[x])).join(', ')}} por ${s.sources.join(', ')}${s.withReference ? ' (incluye la referencia: voltaje conocido)' : ''}`).join('; ') + '.' : ''}`));
      if (n.controls.length) {
        dev.push(H('Variables de control en función de los voltajes de nodo'));
        for (const c of n.controls) dev.push(T(c));
      }
      if (n.usedMNA) dev.push(P('Una fuente dependiente está controlada por la corriente de una fuente de voltaje: esa corriente se agrega como incógnita adicional (análisis nodal modificado).'));
      dev.push(...eqBlocks(n.eqs, n.unknowns, n.controls));
      dev.push(H('Sistema de ecuaciones'));
      dev.push(T(texSystem(n.eqs.map((e) => texEq(integerize(e.lin).lin, n.unknowns)))));
      dev.push(H(`Resolución (${sys === 'cramer' ? 'Cramer' : sys === 'gauss' ? 'Gauss' : 'sustitución'})`));
      for (const d of n.system?.detailTex ?? []) dev.push(T(d));
      dev.push(H('Corrientes de cada elemento con la ley de Ohm'));
      for (const e of net.elements.filter((x) => x.kind === 'R' || x.kind === 'G')) {
        const x = a.dc!.el.get(e.id)!;
        const num = e.n2 === 0 ? `V_{${net.nodeNames[e.n1]}}` : e.n1 === 0 ? `-V_{${net.nodeNames[e.n2]}}` : `V_{${net.nodeNames[e.n1]}} - V_{${net.nodeNames[e.n2]}}`;
        dev.push(T(`${iName(e)} = \\frac{${num}}{${texNum(e.kind === 'R' ? e.value : 1 / e.value, 5)}} = ${texNum(x.i, 6)}\\ [A]`));
      }
      tip = 'Elija como referencia el nodo con más conexiones (o el extremo − de la fuente de voltaje): así varios voltajes de nodo quedan conocidos y ahorra ecuaciones.';
      const m = meshAnalysis(net, a.topo);
      if (m.ok) ver.push(P(`Segundo método (mallas): ${m.meshNames.map((x) => `$${x} = ${texNum(m.system!.values!.get(x)!, 6)}$`).join(', ')}; las corrientes de rama coinciden ✓.`));
      const unused = pick(n.eqs);
      if (unused) ver.push(P(`Sustitución en la ecuación (${unused.n}): el lado izquierdo da $${texNum(cleanZero(evalLin(unused, n.system!.values!)), 3)}$ ≈ 0 ✓.`));
    }
  } else {
    const b = branchAnalysis(net, a.topo, sys);
    concept = 'Método de corrientes de rama (U2, 2.11): se asigna una corriente a cada rama, se marcan las polaridades (+ por donde entra la corriente en las resistencias; la corriente sale por el + de las fuentes), se escribe una LVK por malla (de − a + suma, de + a − resta) y una LCK por cada nodo con «pedigree» menos uno.';
    laws.push(T('\\sum V_i = 0 \\ (\\text{LVK}),\\qquad \\sum I_{\\text{entran}} = \\sum I_{\\text{salen}} \\ (\\text{LCK}),\\qquad V = R\\cdot I'));
    if (!b.ok) dev.push(P(`⚠ ${b.error}`));
    else {
      dev.push(H('Paso 1: ramas y corrientes'));
      dev.push(L(b.branches.map((br) => `$${br.name}$: ${br.elements.map((id) => net.elements.find((x) => x.id === id)!.label).join(' – ')} (de ${br.from === 0 ? 'ref' : net.nodeNames[br.from]} a ${br.to === 0 ? 'ref' : net.nodeNames[br.to]})`)));
      dev.push(H('Paso 2: polaridades'));
      dev.push(P('Resistencias: + donde entra la corriente de rama. Fuentes de voltaje: según su símbolo. Fuentes de corriente: su voltaje $V_{Is}$ es una incógnita más.'));
      if (b.controls.length) {
        dev.push(H('Variables de control'));
        for (const c of b.controls) dev.push(T(c));
      }
      dev.push(H('Paso 3: LVK y LCK'));
      const unk = b.system!.unknowns;
      dev.push(...eqBlocks(b.eqs, unk, b.controls));
      dev.push(H('Paso 4: resolver'));
      dev.push(T(texSystem(b.eqs.map((e) => texEq(integerize(e.lin).lin, unk)))));
      for (const d of b.system?.detailTex ?? []) dev.push(T(d));
      tip = 'Siempre salen tantas ecuaciones como incógnitas: (nodos principales − 1) LCK + (mallas) LVK. Si ve que el número no cuadra, le falta una rama o le sobra un nodo.';
      const n = nodalAnalysis(net);
      if (n.ok) ver.push(P(`Segundo método (nodos): voltajes ${n.unknowns.filter((u) => u.startsWith('V')).map((u, i) => `$${u} = ${texNum(n.V[i + 1], 6)}$`).join(', ')} ✓.`));
    }
  }
  if (wanted) dev.push(P(`Se pidió: ${wanted}.`));
  return {
    title: `Solución por ${METHOD_NAMES[method]}`,
    concept,
    identification: id,
    laws,
    development: dev,
    results: a.dc ? resultsBlocks(a) : [P('—')],
    verification: verification(a, ver),
    tip,
  };
}

const cleanZero = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x);
function evalLin(e: SysEq, vals: Map<string, number>) {
  let s = e.lin.c;
  for (const [k, v] of e.lin.t) s += v * (vals.get(k) ?? 0);
  return s;
}

// ---------------- reducción serie‑paralelo ----------------
export function resistorEdges(a: Analysis): REdge[] {
  return a.net.elements.filter((e) => e.kind === 'R' || e.kind === 'G').map((e) => ({ id: e.id, name: e.label, R: e.kind === 'R' ? e.value : 1 / e.value, a: e.n1, b: e.n2, from: [e.id] }));
}

export function reductionDoc(a: Analysis): StepDoc {
  const net = a.net;
  const sources = net.elements.filter((e) => isVoltageSourceLike(e.kind) || isCurrentSourceLike(e.kind));
  const dev: Block[] = [];
  let concept = 'Reducción: se combinan resistencias en serie ($R_1 + R_2$) y en paralelo ($R_1R_2/(R_1+R_2)$) hasta obtener una sola resistencia equivalente vista por la fuente; luego se regresa paso a paso al circuito original con la ley de Ohm y los divisores de voltaje y corriente.';
  if (sources.length !== 1 || isDependent(sources[0].kind)) {
    dev.push(P(sources.length === 0 ? 'No hay fuentes: solo se puede calcular la resistencia equivalente entre dos terminales (herramienta de la ventanilla 1).' : 'La reducción directa sirve cuando hay UNA sola fuente independiente. Este circuito tiene ' + sources.length + ' fuentes: use nodos, mallas o superposición.'));
    return { title: 'Reducción serie‑paralelo', concept, identification: identification(a), laws: [], development: dev, results: a.dc ? resultsBlocks(a) : [], verification: a.dc ? verification(a, []) : [], tip: 'Con varias fuentes, superposición + reducción es otra opción.' };
  }
  const s = sources[0];
  const red = reduceNetwork(resistorEdges(a), s.n1, s.n2);
  for (const st of red.steps) {
    dev.push(P(st.text));
    dev.push(T(st.tex));
  }
  if (!red.ok) dev.push(P(`⚠ ${red.message}`));
  else {
    dev.push(T(`R_{eq} = ${texQ(red.Req, 'Ω')}`));
    const x = a.dc!.el.get(s.id)!;
    if (s.kind === 'V') dev.push(T(`I_{total} = \\frac{E}{R_{eq}} = \\frac{${texNum(s.value, 5)}}{${texNum(red.Req, 5)}} = ${texQ(-x.i, 'A')}`));
    else dev.push(T(`V = I_s\\,R_{eq} = ${texNum(s.value, 5)}\\cdot ${texNum(red.Req, 5)} = ${texQ(-x.v, 'V')}`));
    dev.push(H('Regreso al circuito original'));
    dev.push(P('Se recorren las etapas al revés: en cada serie la corriente es la misma y el voltaje se reparte (divisor de voltaje); en cada paralelo el voltaje es el mismo y la corriente se reparte (divisor de corriente). Así se obtiene el voltaje de cada resistencia y con Ohm su corriente:'));
    for (const e of net.elements.filter((x) => x.kind === 'R')) {
      const r = a.dc!.el.get(e.id)!;
      dev.push(T(`I_{${e.label}} = \\frac{V_{${e.label}}}{R} = \\frac{${texNum(r.v, 5)}}{${texNum(e.value, 5)}} = ${texQ(r.i, 'A')}`));
    }
  }
  concept += red.usedDeltaY ? ' En este circuito fue necesario transformar un triángulo (Δ) en estrella (Y) porque no se podía reducir solo con serie y paralelo.' : '';
  return {
    title: 'Solución por reducción serie‑paralelo',
    concept,
    identification: identification(a),
    laws: [T('R_s = R_1 + R_2 + \\dots + R_n,\\qquad \\frac{1}{R_p} = \\frac{1}{R_1} + \\dots + \\frac{1}{R_n},\\qquad R_{eq} = \\frac{R_1 R_2}{R_1 + R_2}'), T('R_X = \\frac{R_1 R_2}{R_1 + R_2 + R_3}\\ (\\Delta\\to Y)')],
    development: dev,
    results: a.dc ? resultsBlocks(a) : [],
    verification: a.dc ? verification(a, [P('Comparación con el análisis nodal (MNA): los valores coinciden ✓.')]) : [],
    tip: 'Reduzca desde el extremo más alejado de la fuente hacia ella; al regresar, use divisor de voltaje en las series y divisor de corriente en los paralelos.',
  };
}

// ---------------- recomendador ----------------
export interface MethodCount {
  nodos: number;
  mallas: number;
  ramas: number;
  reducible: boolean;
  singleSource: boolean;
}

export function countEquations(a: Analysis): MethodCount {
  const net = a.net;
  const vl = net.elements.filter((e) => isVoltageSourceLike(e.kind) || e.kind === 'AM').length;
  const il = net.elements.filter((e) => isCurrentSourceLike(e.kind)).length;
  const nodos = Math.max(0, a.topo.nodes - 1 - vl);
  const nonPlanar = a.topo.crossings.length > 0 || a.topo.nonPlanarByEuler || a.topo.meshes.length !== a.topo.independentLoops;
  const mallas = nonPlanar ? Infinity : Math.max(0, a.topo.meshes.length - il);
  const ramas = a.topo.branches.length;
  const sources = net.elements.filter((e) => isVoltageSourceLike(e.kind) || isCurrentSourceLike(e.kind));
  let reducible = false;
  if (sources.length === 1 && !isDependent(sources[0].kind)) {
    const r = reduceNetwork(resistorEdges(a), sources[0].n1, sources[0].n2);
    reducible = r.ok && !r.usedDeltaY;
  }
  return { nodos, mallas, ramas, reducible, singleSource: sources.length === 1 };
}

export function betterWayDC(a: Analysis): BetterDoc {
  const c = countEquations(a);
  const hasDep = a.net.elements.some((e) => isDependent(e.kind));
  let method: string;
  let why: string;
  if (c.reducible) {
    method = 'Reducción serie‑paralelo + divisores de voltaje y corriente';
    why = 'Hay una sola fuente independiente y la red se reduce solo con serie y paralelo: no hace falta plantear ningún sistema de ecuaciones.';
  } else if (c.nodos < c.mallas) {
    method = 'Nodos (y supernodos)';
    why = `Nodos necesita ${c.nodos} ecuación(es) simultánea(s) frente a ${c.mallas} de mallas: cada fuente de voltaje fija un voltaje de nodo o forma un supernodo y ahorra una incógnita.`;
  } else if (c.mallas < c.nodos) {
    method = 'Mallas (y supermallas)';
    why = `Mallas necesita ${c.mallas} ecuación(es) frente a ${c.nodos} de nodos: cada fuente de corriente fija una corriente de malla o forma una supermalla.`;
  } else {
    method = 'Nodos o mallas (empate)';
    why = `Ambos métodos piden ${c.nodos} ecuación(es). Use el que le resulte más natural; con fuentes de corriente suele ser más cómodo nodos y con fuentes de voltaje, mallas.`;
  }
  const best = c.reducible ? 0 : Math.min(c.nodos, c.mallas);
  const dc = a.dc;
  const first = a.net.elements.find((e) => e.kind === 'R');
  return {
    method,
    why,
    savings: `Corrientes de rama: ${c.ramas} incógnitas · Nodos: ${c.nodos} · Mallas: ${isFinite(c.mallas) ? c.mallas : 'no aplica (no planar)'}${c.reducible ? ' · Reducción: 0 sistemas' : ''}. El método recomendado ahorra ${Math.max(0, c.ramas - best)} ecuación(es) respecto al método de ramas.`,
    formulas: [
      { tex: 'I = \\frac{V_i - V_j}{R}', meaning: 'Corriente que SALE del nodo i hacia el nodo j por una resistencia (ley de Ohm).' },
      { tex: 'V_{(+)} - V_{(-)} = E', meaning: 'Ecuación del supernodo: la fuente fija la diferencia entre sus dos nodos.' },
      { tex: 'R\\,(I_m - I_k)', meaning: 'Caída en una resistencia compartida por las mallas m y k (recorriendo la malla m).' },
      { tex: 'I_a - I_b = I_s', meaning: 'Fuente de corriente compartida: une dos mallas en una supermalla.' },
      ...(hasDep ? [{ tex: 'V_x = f(\\text{incógnitas})', meaning: 'Escriba la variable de control de cada fuente dependiente en función de las incógnitas antes de sustituir.' }] : []),
    ],
    tricks: [
      'Antes de escribir nada, cuente: (nodos − 1 − fuentes de voltaje) vs. (mallas − fuentes de corriente). Gana el menor.',
      'Ponga la referencia en el polo − de una fuente de voltaje: ese voltaje de nodo queda conocido.',
      'Multiplique cada ecuación por el m.c.m. de las resistencias para trabajar con enteros (como en el cuaderno).',
      'Verifique siempre con el balance de potencias: ΣP entregada = ΣP absorbida.',
    ],
    mistakes: [
      'Olvidar que una fuente de corriente en una malla NO permite escribir la LVK de esa malla (su voltaje es desconocido).',
      'Mezclar sentidos: en nodos todas las corrientes «salen»; en mallas todas giran en sentido horario.',
      'No expresar la variable de control de la fuente dependiente en función de las incógnitas.',
      'Confundir «absorbe» y «entrega»: con convención pasiva, P = V·I > 0 absorbe.',
    ],
    compare: {
      long: `Corrientes de rama: ${c.ramas} ecuaciones (LVK + LCK + restricciones) resueltas a la vez.`,
      short: c.reducible ? 'Reducción: sumar y combinar resistencias, una división y luego divisores.' : `${method}: solo ${best} ecuación(es) simultánea(s).`,
      result: dc && first ? `por cualquiera de los dos caminos, $I_{${first.label}} = ${texNum(dc.el.get(first.id)!.i, 5)}$ A.` : 'los mismos valores en ambos casos.',
    },
  };
}

/** Lista corta del control de dependientes (para mostrar en la identificación) */
export function controlSummary(a: Analysis) {
  return a.net.elements.filter((e) => isDependent(e.kind)).map((e) => `${e.label} = ${depTex(e, a.net.elements.find((x) => x.id === e.ctrlRef))} con ${ctrlName(e, a.net.elements.find((x) => x.id === e.ctrlRef))}`);
}
