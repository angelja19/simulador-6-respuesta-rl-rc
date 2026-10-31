// Reducción de redes resistivas entre dos terminales: serie, paralelo y transformaciones Δ ↔ Y.
import { texNum } from '../units';

export interface REdge {
  id: string;
  name: string;
  R: number;
  a: number;
  b: number;
  /** de qué elementos proviene */
  from: string[];
}

export interface ReduceStep {
  kind: 'serie' | 'paralelo' | 'Δ→Y' | 'colgante' | 'corto';
  /** nombres combinados */
  inputs: string[];
  outputs: string[];
  tex: string;
  text: string;
  /** estado de la red después del paso */
  edges: REdge[];
  /** nodos nuevos creados (centro de estrella) */
  newNode?: number;
}

export interface ReduceResult {
  ok: boolean;
  Req: number;
  steps: ReduceStep[];
  initial: REdge[];
  /** necesitó Δ→Y (la red no era serie‑paralelo) */
  usedDeltaY: boolean;
  /** triángulo propuesto (si se usó) */
  proposal?: string;
  message?: string;
}

const fmt = (x: number) => texNum(x, 5);

export function deltaToY(R1: number, R2: number, R3: number) {
  const S = R1 + R2 + R3;
  return { Rx: (R1 * R2) / S, Ry: (R1 * R3) / S, Rz: (R2 * R3) / S };
}
export function yToDelta(Rx: number, Ry: number, Rz: number) {
  const N = Rx * Ry + Rx * Rz + Ry * Rz;
  return { R1: N / Rz, R2: N / Ry, R3: N / Rx };
}
export function parallel(...R: number[]) {
  return 1 / R.reduce((s, r) => s + 1 / r, 0);
}

/**
 * Reduce la red de resistencias `edges` vista entre los nodos s y t.
 * Los nodos son enteros arbitrarios; se crean nodos nuevos para los centros de estrella.
 */
export function reduceNetwork(edgesIn: REdge[], s: number, t: number): ReduceResult {
  let edges = edgesIn.map((e) => ({ ...e }));
  const initial = edges.map((e) => ({ ...e }));
  const steps: ReduceStep[] = [];
  let nextNode = Math.max(s, t, ...edges.flatMap((e) => [e.a, e.b])) + 1;
  let eqCount = 0;
  let usedDeltaY = false;
  let proposal: string | undefined;
  const newName = () => `R_{eq${++eqCount}}`;
  const snapshot = () => edges.map((e) => ({ ...e }));
  const degree = (n: number) => edges.reduce((c, e) => c + (e.a === n ? 1 : 0) + (e.b === n ? 1 : 0), 0);
  let guard = 0;
  while (guard++ < 500) {
    // 0) resistencias en cortocircuito (ambos extremos en el mismo nodo)
    const sc = edges.find((e) => e.a === e.b);
    if (sc) {
      edges = edges.filter((e) => e !== sc);
      steps.push({ kind: 'corto', inputs: [sc.name], outputs: [], tex: `${sc.name}\\ \\text{está en cortocircuito (sus dos extremos en el mismo nodo): no aporta}`, text: `$${sc.name}$ está cortocircuitada y no aporta nada.`, edges: snapshot() });
      continue;
    }
    // 1) ramas colgantes: nodo de grado 1 que no es terminal
    const dang = edges.find((e) => (degree(e.a) === 1 && e.a !== s && e.a !== t) || (degree(e.b) === 1 && e.b !== s && e.b !== t));
    if (dang) {
      edges = edges.filter((e) => e !== dang);
      steps.push({ kind: 'colgante', inputs: [dang.name], outputs: [], tex: `${dang.name}\\ \\text{tiene un extremo libre: no circula corriente, se elimina}`, text: `$${dang.name}$ queda con un extremo libre: no conduce corriente.`, edges: snapshot() });
      continue;
    }
    if (edges.length === 1 && ((edges[0].a === s && edges[0].b === t) || (edges[0].a === t && edges[0].b === s))) break;
    // 2) paralelo: mismas dos terminales
    let done = false;
    for (let i = 0; i < edges.length && !done; i++) {
      const grp = edges.filter((e) => (e.a === edges[i].a && e.b === edges[i].b) || (e.a === edges[i].b && e.b === edges[i].a));
      if (grp.length >= 2) {
        const R = parallel(...grp.map((g) => g.R));
        const nm = newName();
        const ne: REdge = { id: nm, name: nm, R, a: grp[0].a, b: grp[0].b, from: grp.flatMap((g) => g.from) };
        edges = edges.filter((e) => !grp.includes(e)).concat(ne);
        let tex: string;
        if (grp.length === 2) tex = `${nm} = \\dfrac{${grp[0].name}\\cdot ${grp[1].name}}{${grp[0].name} + ${grp[1].name}} = \\dfrac{${fmt(grp[0].R)}\\cdot ${fmt(grp[1].R)}}{${fmt(grp[0].R)} + ${fmt(grp[1].R)}} = ${fmt(R)}\\ [\\Omega]`;
        else if (grp.length === 3) tex = `${nm} = \\dfrac{${grp.map((g) => g.name).join('\\,')}}{${grp[0].name}${grp[1].name} + ${grp[0].name}${grp[2].name} + ${grp[1].name}${grp[2].name}} = ${fmt(R)}\\ [\\Omega]`;
        else tex = `\\dfrac{1}{${nm}} = ${grp.map((g) => `\\dfrac{1}{${fmt(g.R)}}`).join(' + ')} \\Rightarrow ${nm} = ${fmt(R)}\\ [\\Omega]`;
        steps.push({ kind: 'paralelo', inputs: grp.map((g) => g.name), outputs: [nm], tex, text: `${grp.map((g) => `$${g.name}$`).join(' ∥ ')} están en paralelo (mismos dos nodos).`, edges: snapshot() });
        done = true;
      }
    }
    if (done) continue;
    // 3) serie: nodo interno de grado 2 (no terminal)
    const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
    for (const n of nodes) {
      if (n === s || n === t || degree(n) !== 2) continue;
      const pair = edges.filter((e) => e.a === n || e.b === n);
      const o1 = pair[0].a === n ? pair[0].b : pair[0].a;
      const o2 = pair[1].a === n ? pair[1].b : pair[1].a;
      const R = pair[0].R + pair[1].R;
      const nm = newName();
      edges = edges.filter((e) => !pair.includes(e)).concat({ id: nm, name: nm, R, a: o1, b: o2, from: pair.flatMap((g) => g.from) });
      steps.push({ kind: 'serie', inputs: pair.map((g) => g.name), outputs: [nm], tex: `${nm} = ${pair[0].name} + ${pair[1].name} = ${fmt(pair[0].R)} + ${fmt(pair[1].R)} = ${fmt(R)}\\ [\\Omega]`, text: `$${pair[0].name}$ y $${pair[1].name}$ están en serie (el nodo entre ellos no tiene otra conexión).`, edges: snapshot() });
      done = true;
      break;
    }
    if (done) continue;
    // 4) Δ → Y: buscar un triángulo
    const tri = findTriangle(edges);
    if (!tri) break;
    usedDeltaY = true;
    const [e12, e13, e23, n1, n2, n3] = tri; // R1 entre n1-n2, R2 entre n1-n3, R3 entre n2-n3 (forma del material: R1 y R2 adyacentes al vértice n1)
    const { Rx, Ry, Rz } = deltaToY(e12.R, e13.R, e23.R);
    const c = nextNode++;
    const nx = `R_{x${eqCount + 1}}`;
    const ny = `R_{y${eqCount + 1}}`;
    const nz = `R_{z${eqCount + 1}}`;
    eqCount++;
    if (!proposal) proposal = `Transformar el triángulo formado por ${[e12, e13, e23].map((x) => x.name.replace(/[{}_\\]/g, '')).join(', ')} en una estrella.`;
    edges = edges.filter((e) => e !== e12 && e !== e13 && e !== e23).concat(
      { id: nx, name: nx, R: Rx, a: n1, b: c, from: [...e12.from, ...e13.from] },
      { id: ny, name: ny, R: Ry, a: n2, b: c, from: [...e12.from, ...e23.from] },
      { id: nz, name: nz, R: Rz, a: n3, b: c, from: [...e13.from, ...e23.from] },
    );
    const S = e12.R + e13.R + e23.R;
    steps.push({
      kind: 'Δ→Y',
      inputs: [e12.name, e13.name, e23.name],
      outputs: [nx, ny, nz],
      tex: `${nx} = \\dfrac{${e12.name}\\,${e13.name}}{\\Sigma} = \\dfrac{${fmt(e12.R)}\\cdot ${fmt(e13.R)}}{${fmt(S)}} = ${fmt(Rx)};\\quad ${ny} = \\dfrac{${e12.name}\\,${e23.name}}{\\Sigma} = ${fmt(Ry)};\\quad ${nz} = \\dfrac{${e13.name}\\,${e23.name}}{\\Sigma} = ${fmt(Rz)}\\ [\\Omega]`,
      text: `La red no se puede reducir solo con serie y paralelo: se transforma el triángulo $${e12.name}$–$${e13.name}$–$${e23.name}$ en estrella ($\\Sigma = ${fmt(S)}$ Ω).`,
      edges: snapshot(),
      newNode: c,
    });
  }
  const final = edges.filter((e) => (e.a === s && e.b === t) || (e.a === t && e.b === s));
  if (edges.length === 0) return { ok: false, Req: Infinity, steps, initial, usedDeltaY, proposal, message: 'No hay camino de resistencias entre los terminales: R_eq es infinita (circuito abierto).' };
  if (final.length === 1 && edges.length === 1) return { ok: true, Req: final[0].R, steps, initial, usedDeltaY, proposal };
  return { ok: false, Req: NaN, steps, initial, usedDeltaY, proposal, message: 'La red no se pudo reducir por completo con serie, paralelo y Δ→Y.' };
}

function findTriangle(edges: REdge[]): [REdge, REdge, REdge, number, number, number] | null {
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const A = edges[i];
      const B = edges[j];
      const common = [A.a, A.b].find((n) => n === B.a || n === B.b);
      if (common === undefined) continue;
      const p = A.a === common ? A.b : A.a;
      const q = B.a === common ? B.b : B.a;
      if (p === q) continue;
      const C = edges.find((e, k) => k !== i && k !== j && ((e.a === p && e.b === q) || (e.a === q && e.b === p)));
      if (C) return [A, B, C, common, p, q];
    }
  return null;
}
