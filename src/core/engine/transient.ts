// Transitorios de circuitos con interruptores, L y C: solución analítica de primer orden por intervalos
// y solución numérica con modelos compañeros (trapezoidal adaptativo + arranque Euler implícito).
import { solveMNA, MNAResult, switchClosedAt, switchStateBefore } from './mna';
import { Netlist, NetElement } from './types';

export interface TVar {
  key: string;
  elementId: string;
  label: string;
  type: 'v' | 'i';
  unit: 'V' | 'A';
}

export interface TInterval {
  t0: number;
  t1: number; // Infinity para el último
  /** constante de tiempo (Infinity si no hay descarga) */
  tau: number;
  Req: number;
  storageId: string | null;
  x0: Map<string, number>; // valores en t0+
  xInf: Map<string, number>; // valores finales
  xMinus: Map<string, number>; // valores en t0−
  dcFinal: MNAResult | null;
  icSolve: MNAResult | null;
}

export interface TransientResult {
  ok: boolean;
  error?: string;
  errorElement?: string;
  firstOrder: boolean;
  storage: NetElement[];
  events: number[];
  before: MNAResult | null;
  intervals: TInterval[];
  vars: TVar[];
  /** malla de tiempos uniforme para las gráficas */
  t: number[];
  analytic: Map<string, number[]> | null;
  numeric: Map<string, number[]>;
  /** puntos aceptados por el integrador (para mostrar el paso adaptativo) */
  steps: number;
  maxRelError: number;
  energy: { W0: number; Wdiss: number; Wfinal: number; Wsources: number } | null;
}

const isStorage = (e: NetElement) => e.kind === 'L' || e.kind === 'C';

export function transientAnalysis(net: Netlist, opts: { points?: number; tEnd?: number } = {}): TransientResult {
  const storage = net.elements.filter(isStorage);
  const switches = net.elements.filter((e) => e.kind === 'SW');
  const events = [...new Set(switches.map((s) => s.t0 ?? 0))].sort((a, b) => a - b);
  if (!events.length) events.push(0);
  const vars: TVar[] = [];
  for (const e of net.elements) {
    vars.push({ key: `v:${e.id}`, elementId: e.id, label: e.label, type: 'v', unit: 'V' });
    vars.push({ key: `i:${e.id}`, elementId: e.id, label: e.label, type: 'i', unit: 'A' });
  }
  const base: TransientResult = { ok: false, firstOrder: storage.length === 1, storage, events, before: null, intervals: [], vars, t: [], analytic: null, numeric: new Map(), steps: 0, maxRelError: 0, energy: null };
  if (!storage.length) return { ...base, error: 'El circuito no tiene inductores ni capacitores: no hay respuesta transitoria (todas las variables cambian al instante).' };
  // 1) régimen permanente antes del primer evento
  const before = solveMNA(net, { storage: 'dc', switchClosed: switchStateBefore });
  const state = new Map<string, number>();
  const anyDC = storage.some((s) => s.icMode !== 'given');
  if (anyDC && !before.ok) {
    return { ...base, error: 'No se puede calcular el régimen permanente para t < t₀ (con L como corto y C como abierto el circuito no tiene solución). Revise si un capacitor queda en serie con una fuente de corriente o un inductor en paralelo con una fuente de voltaje.' };
  }
  for (const s of storage) {
    if (s.icMode === 'given') state.set(s.id, s.ic ?? 0);
    else {
      const r = before.el.get(s.id)!;
      state.set(s.id, s.kind === 'C' ? r.v : r.i);
    }
  }
  const valuesOf = (r: MNAResult) => {
    const m = new Map<string, number>();
    for (const e of net.elements) {
      const x = r.el.get(e.id);
      m.set(`v:${e.id}`, x?.v ?? 0);
      m.set(`i:${e.id}`, x?.i ?? 0);
    }
    return m;
  };
  const intervals: TInterval[] = [];
  let analyticOK = storage.length === 1;
  let xMinus = before.ok ? valuesOf(before) : new Map<string, number>();
  for (let k = 0; k < events.length; k++) {
    const t0 = events[k];
    const t1 = k + 1 < events.length ? events[k + 1] : Infinity;
    const sw = switchClosedAt(t0);
    const ic = solveMNA(net, { storage: 'ic', icValues: state, switchClosed: sw });
    if (!ic.ok) {
      // localizar el elemento que provoca el impulso
      const culprit = storage.find((s) => !solveMNA(net, { storage: 'ic', icValues: state, switchClosed: sw, remove: new Set([s.id]) }).ok === false) ?? storage[0];
      return {
        ...base,
        before,
        intervals,
        errorElement: culprit.id,
        error:
          culprit.kind === 'L'
            ? `En t = ${t0} s la corriente del inductor ${culprit.label} (${(state.get(culprit.id) ?? 0).toPrecision(4)} A) quedaría interrumpida bruscamente: no tiene camino para seguir circulando. Eso exigiría un voltaje infinito (v = L·di/dt con di/dt → ∞), un impulso no físico. En la práctica salta un arco en el interruptor. Agregue un camino (resistencia o diodo de rueda libre) en paralelo con el inductor.`
            : `En t = ${t0} s el capacitor ${culprit.label} sería forzado a cambiar su voltaje al instante (queda en paralelo con una fuente de voltaje o en cortocircuito). Eso exigiría una corriente infinita (i = C·dv/dt con dv/dt → ∞), un impulso no físico. Agregue una resistencia en serie con el capacitor.`,
      };
    }
    const dcFinal = solveMNA(net, { storage: 'dc', switchClosed: sw });
    let tau = NaN;
    let Req = NaN;
    let sId: string | null = null;
    if (storage.length === 1) {
      const S = storage[0];
      sId = S.id;
      const off = new Map<string, number>();
      for (const e of net.elements) if (e.kind === 'V' || e.kind === 'I') off.set(e.id, 0);
      const t = solveMNA(net, { storage: 'dc', switchClosed: sw, remove: new Set([S.id]), valueOverride: off, extra: [{ id: '__t', kind: 'I', label: 'Ip', value: 1, n1: S.n2, n2: S.n1 }] });
      Req = t.ok ? t.V[S.n1] - t.V[S.n2] : Infinity;
      if (S.kind === 'C') tau = Req * S.value;
      else tau = Req === 0 ? Infinity : S.value / Req;
      if (!isFinite(Req)) tau = S.kind === 'C' ? Infinity : 0;
      if (!dcFinal.ok && isFinite(tau)) analyticOK = false;
    }
    const x0 = valuesOf(ic);
    const xInf = dcFinal.ok ? valuesOf(dcFinal) : new Map(x0);
    if (storage.length === 1 && !isFinite(tau)) {
      // sin descarga: las variables quedan constantes en su valor inicial
      for (const [kk, v] of x0) xInf.set(kk, v);
    }
    intervals.push({ t0, t1, tau, Req, storageId: sId, x0, xInf, xMinus, dcFinal: dcFinal.ok ? dcFinal : null, icSolve: ic });
    // estado en t1−
    if (isFinite(t1)) {
      if (storage.length === 1) {
        const S = storage[0];
        const kx = S.kind === 'C' ? `v:${S.id}` : `i:${S.id}`;
        const x = isFinite(tau) && tau > 0 ? xInf.get(kx)! + (x0.get(kx)! - xInf.get(kx)!) * Math.exp(-(t1 - t0) / tau) : x0.get(kx)!;
        state.set(S.id, x);
        const m = new Map<string, number>();
        for (const [kk, v] of x0) m.set(kk, isFinite(tau) && tau > 0 ? xInf.get(kk)! + (v - xInf.get(kk)!) * Math.exp(-(t1 - t0) / tau) : v);
        xMinus = m;
      } else {
        // orden superior: integrar numéricamente hasta t1 para obtener el estado
        const r = integrate(net, state, t0, t1, sw, guessScale(net));
        for (const s of storage) state.set(s.id, r.state.get(s.id)!);
        xMinus = r.last;
      }
    }
  }
  // malla de tiempo para gráficas
  const last = intervals[intervals.length - 1];
  const tauRef = intervals.map((iv) => iv.tau).filter((x) => isFinite(x) && x > 0);
  const tauMax = tauRef.length ? Math.max(...tauRef) : guessScale(net);
  const tStart = events[0] - 0.15 * Math.max(tauMax, (events[events.length - 1] - events[0]) / 4 || tauMax);
  const tEnd = opts.tEnd ?? last.t0 + 6 * (isFinite(last.tau) && last.tau > 0 ? last.tau : tauMax);
  const P = opts.points ?? 600;
  const t: number[] = [];
  for (let i = 0; i <= P; i++) t.push(tStart + ((tEnd - tStart) * i) / P);
  // añadir instantes de conmutación exactos (antes y después)
  for (const ev of events) {
    t.push(ev - 1e-12 * Math.max(1, Math.abs(tEnd)));
    t.push(ev);
  }
  t.sort((a, b) => a - b);
  // analítica
  let analytic: Map<string, number[]> | null = null;
  if (analyticOK && storage.length === 1) {
    analytic = new Map(vars.map((v) => [v.key, [] as number[]]));
    for (const tt of t) {
      let iv = intervals[0];
      for (const x of intervals) if (tt >= x.t0) iv = x;
      for (const v of vars) {
        let val: number;
        if (tt < intervals[0].t0) val = intervals[0].xMinus.get(v.key) ?? 0;
        else {
          const a = iv.x0.get(v.key)!;
          const b = iv.xInf.get(v.key)!;
          val = isFinite(iv.tau) && iv.tau > 0 ? b + (a - b) * Math.exp(-(tt - iv.t0) / iv.tau) : a;
        }
        analytic.get(v.key)!.push(val);
      }
    }
  }
  // numérica: integrar intervalo por intervalo desde el estado inicial
  const numeric = new Map<string, number[]>(vars.map((v) => [v.key, [] as number[]]));
  const st = new Map<string, number>();
  for (const s of storage) st.set(s.id, s.icMode === 'given' ? s.ic ?? 0 : before.ok ? (s.kind === 'C' ? before.el.get(s.id)!.v : before.el.get(s.id)!.i) : 0);
  const samples: { t: number; vals: Map<string, number> }[] = [];
  let totalSteps = 0;
  for (let k = 0; k < intervals.length; k++) {
    const iv = intervals[k];
    const tEndK = Math.min(iv.t1, tEnd);
    if (tEndK <= iv.t0) continue;
    const sw = switchClosedAt(iv.t0);
    const r = integrate(net, st, iv.t0, tEndK, sw, isFinite(iv.tau) && iv.tau > 0 ? iv.tau : tauMax, (tt, vals) => samples.push({ t: tt, vals }));
    totalSteps += r.steps;
    for (const s of storage) st.set(s.id, r.state.get(s.id)!);
  }
  const preVals = intervals[0].xMinus;
  let sIdx = 0;
  for (const tt of t) {
    if (tt < events[0]) {
      for (const v of vars) numeric.get(v.key)!.push(preVals.get(v.key) ?? 0);
      continue;
    }
    while (sIdx + 1 < samples.length && samples[sIdx + 1].t <= tt) sIdx++;
    const a = samples[sIdx];
    const b = samples[Math.min(sIdx + 1, samples.length - 1)];
    // interpolación lineal (no cruzar conmutaciones)
    const w = b.t > a.t && tt >= a.t ? Math.min(1, (tt - a.t) / (b.t - a.t)) : 0;
    const crosses = events.some((ev) => a.t < ev && b.t >= ev && tt < ev) ;
    for (const v of vars) {
      const va = a.vals.get(v.key) ?? 0;
      const vb = b.vals.get(v.key) ?? 0;
      numeric.get(v.key)!.push(crosses ? va : va + (vb - va) * w);
    }
  }
  // error relativo máximo numérico vs analítico (variables de los elementos almacenadores y resistencias)
  let maxRel = 0;
  if (analytic) {
    for (const v of vars) {
      const A = analytic.get(v.key)!;
      const N = numeric.get(v.key)!;
      const range = Math.max(...A.map(Math.abs), 1e-15);
      if (range < 1e-12) continue;
      for (let i = 0; i < t.length; i++) {
        if (events.some((ev) => Math.abs(t[i] - ev) < 1e-9 * Math.max(1, Math.abs(tEnd)))) continue;
        maxRel = Math.max(maxRel, Math.abs(A[i] - N[i]) / range);
      }
    }
  }
  // energía
  let energy: TransientResult['energy'] = null;
  if (storage.length >= 1) {
    const iv0 = intervals[0];
    const W = (vals: Map<string, number>) => storage.reduce((s, e) => s + (e.kind === 'C' ? 0.5 * e.value * vals.get(`v:${e.id}`)! ** 2 : 0.5 * e.value * vals.get(`i:${e.id}`)! ** 2), 0);
    const W0 = W(iv0.x0);
    const Wf = W(intervals[intervals.length - 1].xInf);
    let Wdiss = 0;
    let Wsrc = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].t - samples[i - 1].t;
      if (dt <= 0) continue;
      for (const e of net.elements) {
        const p0 = samples[i - 1].vals.get(`v:${e.id}`)! * samples[i - 1].vals.get(`i:${e.id}`)!;
        const p1 = samples[i].vals.get(`v:${e.id}`)! * samples[i].vals.get(`i:${e.id}`)!;
        if (e.kind === 'R' || e.kind === 'G') Wdiss += 0.5 * (p0 + p1) * dt;
        else if (e.kind === 'V' || e.kind === 'I' || e.kind === 'VCVS' || e.kind === 'VCCS' || e.kind === 'CCVS' || e.kind === 'CCCS') Wsrc += -0.5 * (p0 + p1) * dt;
      }
    }
    // cola analítica más allá de tEnd en la respuesta natural (≈ e^{-12} del total, despreciable)
    energy = { W0, Wdiss, Wfinal: Wf, Wsources: Wsrc };
  }
  return { ok: true, firstOrder: storage.length === 1, storage, events, before: before.ok ? before : null, intervals, vars, t, analytic, numeric, steps: totalSteps, maxRelError: maxRel, energy };
}

function guessScale(net: Netlist): number {
  // escala de tiempo aproximada: usa L/R y R·C con la resistencia típica
  const Rs = net.elements.filter((e) => e.kind === 'R').map((e) => e.value);
  const Rt = Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : 1;
  const taus = net.elements.filter((e) => e.kind === 'L' || e.kind === 'C').map((e) => (e.kind === 'L' ? e.value / Rt : e.value * Rt));
  return taus.length ? Math.max(...taus) : 1;
}

/** Integra desde t0 (estado = valores de L y C en t0) hasta t1 con interruptores fijos. */
export function integrate(
  net: Netlist,
  stateIn: Map<string, number>,
  t0: number,
  t1: number,
  sw: (e: NetElement) => boolean,
  tauScale: number,
  onSample?: (t: number, vals: Map<string, number>) => void,
) {
  const storage = net.elements.filter((e) => e.kind === 'L' || e.kind === 'C');
  // estado completo: para C (v, i); para L (i, v)
  const icR = solveMNA(net, { storage: 'ic', icValues: stateIn, switchClosed: sw });
  const st = new Map<string, { x: number; y: number }>(); // x = variable de estado (vC o iL), y = la otra (iC o vL)
  for (const s of storage) {
    const r = icR.el.get(s.id);
    st.set(s.id, s.kind === 'C' ? { x: stateIn.get(s.id) ?? 0, y: r?.i ?? 0 } : { x: stateIn.get(s.id) ?? 0, y: r?.v ?? 0 });
  }
  const valsOf = (r: MNAResult) => {
    const m = new Map<string, number>();
    for (const e of net.elements) {
      m.set(`v:${e.id}`, r.el.get(e.id)?.v ?? 0);
      m.set(`i:${e.id}`, r.el.get(e.id)?.i ?? 0);
    }
    return m;
  };
  if (icR.ok) onSample?.(t0, valsOf(icR));
  const step = (S: Map<string, { x: number; y: number }>, h: number, be: boolean) => {
    const comp = new Map<string, { g?: number; j?: number; r?: number; e?: number }>();
    for (const s of storage) {
      const { x, y } = S.get(s.id)!;
      if (s.kind === 'C') {
        const g = (be ? 1 : 2) * s.value / h;
        comp.set(s.id, { g, j: be ? -g * x : -g * x - y });
      } else {
        const r = (be ? 1 : 2) * s.value / h;
        comp.set(s.id, { r, e: be ? -r * x : -r * x - y });
      }
    }
    const res = solveMNA(net, { storage: 'companion', companion: comp, switchClosed: sw });
    const N = new Map<string, { x: number; y: number }>();
    for (const s of storage) {
      const r = res.el.get(s.id);
      N.set(s.id, s.kind === 'C' ? { x: r?.v ?? 0, y: r?.i ?? 0 } : { x: r?.i ?? 0, y: r?.v ?? 0 });
    }
    return { N, res };
  };
  const span = t1 - t0;
  let h = Math.min(tauScale / 200, span / 50);
  const hMax = Math.min(tauScale / 20, span / 20);
  const tol = 1e-7;
  let t = t0;
  let S = st;
  let steps = 0;
  let beSteps = 2; // arranque con Euler implícito
  let last = icR.ok ? valsOf(icR) : new Map<string, number>();
  let guard = 0;
  while (t < t1 - 1e-15 * Math.max(1, Math.abs(t1)) && guard++ < 200000) {
    if (t + h > t1) h = t1 - t;
    const be = beSteps > 0;
    const hh = be ? Math.min(h, tauScale / 2000) : h;
    const full = step(S, hh, be);
    const half1 = step(S, hh / 2, be);
    const half2 = step(half1.N, hh / 2, be);
    // error local por duplicación de paso
    let err = 0;
    let scale = 1e-12;
    for (const s of storage) {
      const a = full.N.get(s.id)!.x;
      const b = half2.N.get(s.id)!.x;
      err = Math.max(err, Math.abs(a - b));
      scale = Math.max(scale, Math.abs(b), Math.abs(S.get(s.id)!.x));
    }
    const rel = err / scale;
    if (rel > tol && hh > tauScale * 1e-7 && !be) {
      h = hh / 2;
      continue;
    }
    // aceptar (extrapolación: usar la solución de dos medios pasos)
    S = half2.N;
    t += hh;
    steps++;
    if (be) beSteps--;
    last = valsOf(half2.res);
    onSample?.(t, last);
    if (!be && rel < tol / 10) h = Math.min(hh * 1.5, hMax);
    else h = Math.min(hh, hMax);
  }
  const state = new Map<string, number>();
  for (const s of storage) state.set(s.id, S.get(s.id)!.x);
  return { state, steps, last };
}
