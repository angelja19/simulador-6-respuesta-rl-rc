// Topología: nodos, nodos principales, ramas, mallas (caras del dibujo), lazos, árbol/co‑árbol,
// planaridad y relaciones serie/paralelo.
import { key, onSegment, pinsOf } from './netlist';
import { Circuit, Netlist, NetElement, Pt } from './types';

export interface Branch {
  /** elementos de la rama en orden */
  elements: string[];
  from: number;
  to: number;
}

export interface MeshLoop {
  index: number;
  /** elementos recorridos en sentido horario; dir = +1 si el recorrido va de a → b */
  items: { id: string; dir: 1 | -1 }[];
  /** centroide para dibujar la flecha de la malla (unidades de grilla) */
  center: Pt;
  area: number;
}

export interface Topology {
  nodes: number;
  /** grado (número de terminales de elementos) por nodo */
  degree: number[];
  principalNodes: number[];
  branches: Branch[];
  /** elementos que participan del grafo (sin voltímetros) */
  edges: NetElement[];
  components: number;
  /** número de mallas independientes l = b − n + 1 (por componente) */
  independentLoops: number;
  meshes: MeshLoop[];
  /** el dibujo tiene cruces de cables sin unión */
  crossings: { a: string; b: string; at: Pt }[];
  /** definitivamente no planar (cota de Euler) */
  nonPlanarByEuler: boolean;
  tree: string[];
  cotree: string[];
}

export interface TopoOptions {
  /** elementos tratados como circuito abierto (se excluyen del grafo) */
  isOpen?: (e: NetElement) => boolean;
}

export function defaultOpen(e: NetElement): boolean {
  return e.kind === 'VM';
}

export function analyzeTopology(c: Circuit | null, net: Netlist, opt: TopoOptions = {}): Topology {
  const isOpen = opt.isOpen ?? defaultOpen;
  const edges = net.elements.filter((e) => !isOpen(e));
  const N = net.nodeCount;
  const degree = new Array(N).fill(0);
  for (const e of edges) {
    degree[e.n1]++;
    degree[e.n2]++;
  }
  const used = new Set<number>();
  for (const e of edges) {
    used.add(e.n1);
    used.add(e.n2);
  }
  const principalNodes = [...used].filter((n) => degree[n] >= 3).sort((a, b) => a - b);
  // componentes conexas
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const tree: string[] = [];
  const cotree: string[] = [];
  for (const e of edges) {
    const a = find(e.n1);
    const b = find(e.n2);
    if (a !== b) {
      parent[a] = b;
      tree.push(e.id);
    } else cotree.push(e.id);
  }
  const comps = new Set([...used].map(find)).size;
  const independentLoops = edges.length - used.size + comps;
  // ramas: cadenas entre nodos principales
  const branches: Branch[] = [];
  const visited = new Set<string>();
  const adj = new Map<number, NetElement[]>();
  for (const e of edges) {
    for (const n of [e.n1, e.n2]) {
      if (!adj.has(n)) adj.set(n, []);
      adj.get(n)!.push(e);
    }
  }
  const isP = (n: number) => degree[n] >= 3;
  const walk = (start: number, first: NetElement): Branch => {
    const list = [first.id];
    visited.add(first.id);
    let cur = first.n1 === start ? first.n2 : first.n1;
    let prev = first;
    let guard = 0;
    while (!isP(cur) && cur !== start && guard++ < 10000) {
      const next = (adj.get(cur) ?? []).find((x) => x !== prev && !visited.has(x.id));
      if (!next) break;
      list.push(next.id);
      visited.add(next.id);
      cur = next.n1 === cur ? next.n2 : next.n1;
      prev = next;
    }
    return { elements: list, from: start, to: cur };
  };
  for (const p of principalNodes) for (const e of adj.get(p) ?? []) if (!visited.has(e.id)) branches.push(walk(p, e));
  // lazos sin nodos principales (circuito serie de un solo lazo)
  for (const e of edges) if (!visited.has(e.id)) branches.push(walk(e.n1, e));

  const { meshes, crossings } = c ? findMeshes(c, net, edges) : { meshes: [], crossings: [] };
  const v = used.size;
  // grafo simple subyacente para la cota de Euler
  const simple = new Set(edges.filter((e) => e.n1 !== e.n2).map((e) => [Math.min(e.n1, e.n2), Math.max(e.n1, e.n2)].join('-')));
  const nonPlanarByEuler = v >= 3 && simple.size > 3 * v - 6;
  return { nodes: used.size, degree, principalNodes, branches, edges, components: comps, independentLoops, meshes, crossings, nonPlanarByEuler, tree, cotree };
}

// ---------- caras del dibujo (mallas) ----------

interface GEdge {
  u: string;
  v: string;
  el?: string; // id del elemento (si no, es cable)
  dirAB?: boolean; // el elemento va de u (a) a v (b)
}

function findMeshes(c: Circuit, net: Netlist, edges: NetElement[]) {
  const allowed = new Set(edges.map((e) => e.id));
  const pts = new Map<string, Pt>();
  const add = (p: Pt) => pts.set(key(p), p);
  const segs: { a: Pt; b: Pt; el?: string }[] = [];
  for (const e of c.elements) {
    if (e.kind === 'GND' || !allowed.has(e.id)) continue;
    const { a, b } = pinsOf(e);
    add(a);
    add(b);
    segs.push({ a, b, el: e.id });
  }
  // tierras: se unen con un "cable" virtual entre todos los símbolos de tierra (mismo nodo)
  const gnds = c.elements.filter((e) => e.kind === 'GND');
  for (const w of c.wires) {
    add(w.a);
    add(w.b);
  }
  // partir cables en los puntos que tocan su interior
  const wireSegs: { a: Pt; b: Pt }[] = [];
  for (const w of c.wires) {
    const inner = [...pts.values()].filter((p) => onSegment(p, w.a, w.b));
    inner.sort((p, q) => (p.x - w.a.x) ** 2 + (p.y - w.a.y) ** 2 - ((q.x - w.a.x) ** 2 + (q.y - w.a.y) ** 2));
    for (let i = 0; i + 1 < inner.length; i++) if (key(inner[i]) !== key(inner[i + 1])) wireSegs.push({ a: inner[i], b: inner[i + 1] });
  }
  // cruces: segmentos que se cortan en un punto que no es vértice
  const all = [...segs.map((s) => ({ ...s, name: net.elements.find((x) => x.id === s.el)?.label ?? 'cable' })), ...wireSegs.map((s) => ({ ...s, el: undefined, name: 'cable' }))];
  const crossings: { a: string; b: string; at: Pt }[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const X = segIntersect(all[i].a, all[i].b, all[j].a, all[j].b);
      if (X && !pts.has(key(X))) crossings.push({ a: all[i].name, b: all[j].name, at: X });
    }
  // grafo geométrico (sin GND: las tierras múltiples se tratan uniendo sus puntos lógicamente)
  const gEdges: GEdge[] = [];
  for (const s of segs) gEdges.push({ u: key(s.a), v: key(s.b), el: s.el, dirAB: true });
  for (const s of wireSegs) gEdges.push({ u: key(s.a), v: key(s.b) });
  // si hay varias tierras separadas, el dibujo no forma caras cerradas por la tierra;
  // las unimos con aristas virtuales en orden de x (aproximación razonable: barra de tierra)
  if (gnds.length > 1) {
    const gp = gnds.map((g) => ({ x: g.x, y: g.y })).sort((p, q) => p.x - q.x || p.y - q.y);
    for (let i = 0; i + 1 < gp.length; i++) {
      add(gp[i]);
      add(gp[i + 1]);
      gEdges.push({ u: key(gp[i]), v: key(gp[i + 1]) });
    }
  }
  // half-edges
  const out = new Map<string, { to: string; e: number; ang: number }[]>();
  gEdges.forEach((ge, idx) => {
    const pu = pts.get(ge.u)!;
    const pv = pts.get(ge.v)!;
    if (!pu || !pv || ge.u === ge.v) return;
    const push = (from: string, to: string, p: Pt, q: Pt) => {
      if (!out.has(from)) out.set(from, []);
      out.get(from)!.push({ to, e: idx, ang: Math.atan2(q.y - p.y, q.x - p.x) });
    };
    push(ge.u, ge.v, pu, pv);
    push(ge.v, ge.u, pv, pu);
  });
  for (const l of out.values()) l.sort((a, b) => a.ang - b.ang);
  const usedHE = new Set<string>();
  const heKey = (from: string, to: string, e: number) => `${from}>${to}#${e}`;
  const faces: { verts: string[]; hes: { from: string; to: string; e: number }[] }[] = [];
  for (const [from, list] of out) {
    for (const h of list) {
      if (usedHE.has(heKey(from, h.to, h.e))) continue;
      const verts: string[] = [];
      const hes: { from: string; to: string; e: number }[] = [];
      let f = from;
      let cur = h;
      let guard = 0;
      while (guard++ < 5000) {
        const k = heKey(f, cur.to, cur.e);
        if (usedHE.has(k)) break;
        usedHE.add(k);
        verts.push(f);
        hes.push({ from: f, to: cur.to, e: cur.e });
        // en el vértice destino, tomar la siguiente arista girando (regla de la cara)
        const lst = out.get(cur.to)!;
        const backIdx = lst.findIndex((x) => x.to === f && x.e === cur.e);
        const nxt = lst[(backIdx - 1 + lst.length) % lst.length];
        f = cur.to;
        cur = nxt;
      }
      faces.push({ verts, hes });
    }
  }
  // área con signo (y hacia abajo: positivo = horario en pantalla)
  const area = (vs: string[]) => {
    let s = 0;
    for (let i = 0; i < vs.length; i++) {
      const p = pts.get(vs[i])!;
      const q = pts.get(vs[(i + 1) % vs.length])!;
      s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
  };
  const meshes: MeshLoop[] = [];
  const facesA = faces.map((f) => ({ ...f, A: area(f.verts) }));
  // caras interiores: las de área positiva o negativa según la regla de recorrido; detectamos la orientación
  // de las caras exteriores como aquellas con |área| máxima por componente y signo opuesto al resto.
  // con la regla de giro usada, las caras interiores se recorren en sentido horario (área > 0)
  const innerSign = 1;
  for (const f of facesA) {
    if (Math.sign(f.A) !== innerSign || Math.abs(f.A) < 1e-9) continue;
    // recorrer en sentido horario de pantalla
    const hes = innerSign === 1 ? f.hes : f.hes.slice().reverse().map((h) => ({ from: h.to, to: h.from, e: h.e }));
    const items: MeshLoop['items'] = [];
    for (const h of hes) {
      const ge = gEdges[h.e];
      if (!ge.el) continue;
      const forward = h.from === ge.u; // u es el terminal a
      items.push({ id: ge.el, dir: forward ? 1 : -1 });
    }
    // un elemento recorrido en ambos sentidos (rama colgante) no aporta
    const cnt = new Map<string, number>();
    for (const it of items) cnt.set(it.id, (cnt.get(it.id) ?? 0) + it.dir);
    const clean = items.filter((it, k) => cnt.get(it.id) !== 0 && items.findIndex((x) => x.id === it.id) === k);
    if (!clean.length) continue;
    const cx = f.verts.reduce((s, v) => s + pts.get(v)!.x, 0) / f.verts.length;
    const cy = f.verts.reduce((s, v) => s + pts.get(v)!.y, 0) / f.verts.length;
    meshes.push({ index: 0, items: clean, center: polyCentroid(f.verts.map((v) => pts.get(v)!)) ?? { x: cx, y: cy }, area: Math.abs(f.A) });
  }
  // ordenar mallas: izquierda→derecha, arriba→abajo
  meshes.sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y);
  meshes.forEach((m, i) => (m.index = i + 1));
  return { meshes, crossings };
}

function polyCentroid(p: Pt[]): Pt | null {
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const cr = a.x * b.y - b.x * a.y;
    A += cr;
    cx += (a.x + b.x) * cr;
    cy += (a.y + b.y) * cr;
  }
  if (Math.abs(A) < 1e-9) return null;
  return { x: cx / (3 * A), y: cy / (3 * A) };
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

// ---------- serie / paralelo entre dos elementos ----------

export interface PairRelation {
  relation: 'serie' | 'paralelo' | 'ninguno' | 'mismo';
  reason: string;
}

export function relationOf(net: Netlist, topo: Topology, idA: string, idB: string): PairRelation {
  if (idA === idB) return { relation: 'mismo', reason: 'Es el mismo elemento.' };
  const A = net.elements.find((e) => e.id === idA);
  const B = net.elements.find((e) => e.id === idB);
  if (!A || !B) return { relation: 'ninguno', reason: 'Elemento no encontrado.' };
  const name = (n: number) => (n === 0 ? 'la referencia' : `el nodo ${net.nodeNames[n]}`);
  const setA = [A.n1, A.n2].sort().join(',');
  const setB = [B.n1, B.n2].sort().join(',');
  if (setA === setB)
    return {
      relation: 'paralelo',
      reason: `${A.label} y ${B.label} están conectados entre los mismos dos nodos (${name(A.n1)} y ${name(A.n2)}): tienen el mismo voltaje (E = V₁ = V₂).`,
    };
  // serie: comparten un nodo al que solo llegan ellos dos
  for (const n of [A.n1, A.n2]) {
    if ((n === B.n1 || n === B.n2) && topo.degree[n] === 2)
      return {
        relation: 'serie',
        reason: `${A.label} y ${B.label} comparten ${name(n)} y a ese nodo no llega ningún otro elemento: toda la corriente que sale de uno entra al otro (I = I₁ = I₂).`,
      };
  }
  // serie a través de una cadena de nodos de grado 2 (misma rama)
  const br = topo.branches.find((b) => b.elements.includes(idA) && b.elements.includes(idB));
  if (br)
    return {
      relation: 'serie',
      reason: `${A.label} y ${B.label} están en la misma rama (entre nodos principales), sin derivaciones intermedias: los recorre la misma corriente.`,
    };
  const shared = [A.n1, A.n2].find((n) => n === B.n1 || n === B.n2);
  if (shared !== undefined)
    return {
      relation: 'ninguno',
      reason: `Comparten ${name(shared)}, pero a ese nodo llegan ${topo.degree[shared]} elementos: la corriente se reparte, así que no están en serie; y no comparten los dos nodos, así que tampoco en paralelo.`,
    };
  return { relation: 'ninguno', reason: `No comparten ningún nodo ni la misma rama: no están ni en serie ni en paralelo.` };
}
