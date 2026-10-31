// Thévenin / Norton, superposición, transformación de fuentes y máxima transferencia de potencia.
import { solveMNA, MNAResult } from '../mna';
import { Netlist, NetElement, isDependent } from '../types';

export type TheveninCase = 'independientes' | 'mixto' | 'dependientes';

export interface TheveninResult {
  ok: boolean;
  error?: string;
  case: TheveninCase;
  /** E_TH = V(p) − V(q) en circuito abierto */
  Eth: number;
  Rth: number;
  /** corriente de cortocircuito de p a q (por el corto) */
  Icc: number;
  In: number;
  /** método usado para R_TH */
  rMethod: 'apagar fuentes' | 'Eth/Icc' | 'fuente de prueba 1 V' | 'fuente de prueba 1 A';
  /** resultado de la fuente de prueba (si se usó) */
  test?: { kind: '1V' | '1A'; value: number };
  openCircuit: MNAResult | null;
}

const isIndep = (e: NetElement) => e.kind === 'V' || e.kind === 'I';

export function thevenin(net: Netlist, p: number, q: number, removeIds: string[] = [], prefer: '1V' | '1A' = '1A'): TheveninResult {
  const remove = new Set(removeIds);
  const els = net.elements.filter((e) => !remove.has(e.id));
  const hasIndep = els.some(isIndep);
  const hasDep = els.some((e) => isDependent(e.kind));
  const kase: TheveninCase = hasIndep && !hasDep ? 'independientes' : hasIndep ? 'mixto' : 'dependientes';
  const base: TheveninResult = { ok: false, case: kase, Eth: 0, Rth: NaN, Icc: NaN, In: NaN, rMethod: 'apagar fuentes', openCircuit: null };
  if (p === q) return { ...base, error: 'Los dos terminales elegidos son el mismo nodo.' };
  // Voltaje de circuito abierto: se agrega una fuente de prueba de 0 A entre p y q (no altera nada) para asegurar el nodo
  const ctrlRemoved = net.elements.find((e) => e.ctrlRef && remove.has(e.ctrlRef));
  if (ctrlRemoved) return { ...base, error: `La carga elegida es la variable de control de ${ctrlRemoved.label}: si se retira, la fuente dependiente pierde su control. Elija los terminales a y b sin retirar ese elemento, o tome como carga otro elemento.` };
  const oc = solveMNA(net, { remove });
  if (!oc.ok) return { ...base, error: 'No se puede resolver el circuito con los terminales abiertos (revise que la red no quede flotante al retirar la carga).' };
  const Eth = oc.V[p] - oc.V[q];
  const testElement = (kind: 'V' | 'I', value: number): NetElement => ({ id: '__test', kind, label: kind === 'V' ? 'Vp' : 'Ip', value, n1: kind === 'V' ? p : q, n2: kind === 'V' ? q : p });
  // corriente de cortocircuito (de p a q por el corto)
  const scR = solveMNA(net, { remove, extra: [{ id: '__sc', kind: 'AM', label: 'Icc', value: 0, n1: p, n2: q }] });
  const Icc = scR.ok ? scR.el.get('__sc')!.i : NaN;
  if (kase === 'independientes') {
    const off = new Map<string, number>();
    for (const e of els) if (isIndep(e)) off.set(e.id, 0);
    const t = solveMNA(net, { remove, valueOverride: off, extra: [testElement('I', 1)] });
    if (!t.ok) return { ...base, Eth, error: 'Con las fuentes apagadas la red entre los terminales queda abierta: R_TH es infinita (no existe equivalente de Norton).' };
    const Rth = t.V[p] - t.V[q];
    return { ok: true, case: kase, Eth, Rth, Icc, In: Eth / Rth, rMethod: 'apagar fuentes', openCircuit: oc };
  }
  if (kase === 'mixto' && isFinite(Icc) && Math.abs(Icc) > 1e-12 && Math.abs(Eth) > 1e-12) {
    const Rth = Eth / Icc;
    return { ok: true, case: kase, Eth, Rth, Icc, In: Icc, rMethod: 'Eth/Icc', openCircuit: oc };
  }
  // solo dependientes (o E_TH = I_CC = 0): fuente de prueba
  const off = new Map<string, number>();
  for (const e of els) if (isIndep(e)) off.set(e.id, 0);
  if (prefer === '1V') {
    const t = solveMNA(net, { remove, valueOverride: off, extra: [testElement('V', 1)] });
    if (!t.ok) return { ...base, Eth, error: 'No se pudo aplicar la fuente de prueba de 1 V.' };
    const iSrc = -t.el.get('__test')!.i; // corriente que entrega la fuente de prueba hacia la red
    const Rth = 1 / iSrc;
    return { ok: true, case: kase, Eth, Rth, Icc, In: Eth / Rth, rMethod: 'fuente de prueba 1 V', test: { kind: '1V', value: iSrc }, openCircuit: oc };
  }
  const t = solveMNA(net, { remove, valueOverride: off, extra: [testElement('I', 1)] });
  if (!t.ok) return { ...base, Eth, error: 'No se pudo aplicar la fuente de prueba de 1 A.' };
  const Vt = t.V[p] - t.V[q];
  return { ok: true, case: kase, Eth, Rth: Vt / 1, Icc, In: Eth / Vt, rMethod: 'fuente de prueba 1 A', test: { kind: '1A', value: Vt }, openCircuit: oc };
}

export interface SuperpositionPart {
  sourceId: string;
  label: string;
  result: MNAResult;
}
export interface SuperpositionResult {
  ok: boolean;
  parts: SuperpositionPart[];
  total: MNAResult;
  dependents: string[];
}

export function superposition(net: Netlist): SuperpositionResult {
  const indep = net.elements.filter(isIndep);
  const parts: SuperpositionPart[] = [];
  for (const s of indep) {
    const off = new Map<string, number>();
    for (const o of indep) if (o.id !== s.id) off.set(o.id, 0);
    parts.push({ sourceId: s.id, label: s.label, result: solveMNA(net, { valueOverride: off }) });
  }
  const total = solveMNA(net);
  return { ok: total.ok && parts.every((p) => p.result.ok), parts, total, dependents: net.elements.filter((e) => isDependent(e.kind)).map((e) => e.label) };
}

/** Potencia en una carga R_L conectada a un equivalente de Thévenin */
export function loadPower(Eth: number, Rth: number, RL: number) {
  const I = Eth / (Rth + RL);
  const P = I * I * RL;
  const eff = RL / (Rth + RL);
  return { I, P, eff };
}
export function maxPower(Eth: number, Rth: number) {
  return { RL: Rth, Pmax: (Eth * Eth) / (4 * Rth), eff: 0.5 };
}

/** Transformación de fuentes: V en serie con R ↔ I en paralelo con R */
export function sourceTransform(kind: 'V' | 'I', value: number, R: number) {
  return kind === 'V' ? { kind: 'I' as const, value: value / R, R } : { kind: 'V' as const, value: value * R, R };
}
