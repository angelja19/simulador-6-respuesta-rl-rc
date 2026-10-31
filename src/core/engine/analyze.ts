// Punto de entrada único para la interfaz: netlist + validación + solución DC + topología + balances.
import { buildNetlist } from './netlist';
import { solveMNA, MNAResult, switchStateAfter } from './mna';
import { analyzeTopology, Topology } from './topology';
import { Circuit, Netlist, NetElement } from './types';
import { Issue, prepareForSolve, validate, hasErrors } from './validate';

export interface Analysis {
  circuit: Circuit;
  net: Netlist;
  issues: Issue[];
  ok: boolean;
  dc: MNAResult | null;
  topo: Topology;
  /** LCK por nodo: suma de corrientes que salen (debe ser 0) */
  kcl: { node: number; residual: number; terms: { label: string; i: number }[] }[];
  /** LVK por malla: suma de caídas en sentido horario (debe ser 0) */
  kvl: { mesh: number; residual: number; terms: { label: string; v: number }[] }[];
  balance: { delivered: number; absorbed: number; ok: boolean };
}

export interface AnalyzeOptions {
  mode?: 'dc' | 'transient';
  wantsMesh?: boolean;
}

export function dcOpen(e: NetElement) {
  return e.kind === 'VM' || e.kind === 'C' || (e.kind === 'SW' && !switchStateAfter(e));
}

export function analyze(circuit: Circuit, opt: AnalyzeOptions = {}): Analysis {
  const net = buildNetlist(circuit);
  const topo = analyzeTopology(circuit, net, { isOpen: dcOpen });
  const issues = validate(circuit, net, { mode: opt.mode, wantsMesh: opt.wantsMesh, nonPlanar: topo.crossings.length > 0 || topo.nonPlanarByEuler });
  const ok = !hasErrors(issues);
  let dc: MNAResult | null = null;
  if (ok) {
    const prep = prepareForSolve(net, issues);
    const r = solveMNA(prep.net, { storage: 'dc' });
    if (r.ok) {
      // completar resultados de fuentes retiradas (reparto en partes iguales)
      for (const [keep, all] of prep.shared) {
        const k = r.el.get(keep);
        if (!k) continue;
        for (const id of all) {
          const e = net.elements.find((x) => x.id === id)!;
          const i = k.i / all.length;
          r.el.set(id, { id, label: e.label, kind: e.kind, v: k.v, i, p: k.v * i });
        }
      }
      dc = r;
    }
  }
  const kcl: Analysis['kcl'] = [];
  const kvl: Analysis['kvl'] = [];
  let delivered = 0;
  let absorbed = 0;
  if (dc) {
    for (let n = 0; n < net.nodeCount; n++) {
      const terms: { label: string; i: number }[] = [];
      let s = 0;
      for (const e of net.elements) {
        const r = dc.el.get(e.id);
        if (!r || e.n1 === e.n2) continue;
        if (e.n1 === n) {
          terms.push({ label: e.label, i: r.i });
          s += r.i;
        } else if (e.n2 === n) {
          terms.push({ label: e.label, i: -r.i });
          s -= r.i;
        }
      }
      if (terms.length) kcl.push({ node: n, residual: s, terms });
    }
    for (const m of topo.meshes) {
      let s = 0;
      const terms: { label: string; v: number }[] = [];
      for (const it of m.items) {
        const r = dc.el.get(it.id)!;
        terms.push({ label: r.label, v: it.dir * r.v });
        s += it.dir * r.v;
      }
      kvl.push({ mesh: m.index, residual: s, terms });
    }
    for (const r of dc.el.values()) {
      if (r.p > 0) absorbed += r.p;
      else delivered -= r.p;
    }
  }
  const scale = Math.max(1e-12, delivered, absorbed);
  return { circuit, net, issues, ok: ok && !!dc, dc, topo, kcl, kvl, balance: { delivered, absorbed, ok: Math.abs(delivered - absorbed) <= 1e-9 * scale + 1e-9 } };
}
