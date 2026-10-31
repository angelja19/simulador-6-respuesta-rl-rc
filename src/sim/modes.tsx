import React, { useCallback, useMemo, useState } from 'react';
import { analyze, Analysis } from '../core/engine/analyze';
import { transientAnalysis, TransientResult } from '../core/engine/transient';
import { fmtEng, fmtNum, parseSI, texNum, texQ } from '../core/engine/units';
import { Kpi, Plot, ThreePanels, usePreset } from '../core/ui/basic';
import { CircuitEditor } from '../core/ui/CircuitEditor';
import { usePendingTemplate } from '../core/ui/DCMode';
import { BetterDoc, BetterView, BOX, H, IssuesPanel, L, NeedsFix, P, StepDoc, StepsView, T } from '../core/ui/panels';
import { useCircuitDoc } from '../core/ui/useCircuitDoc';
import { describeElement } from '../core/solutions/dc';
import { Issue } from '../core/engine/validate';
import { rcCarga, valuesAt } from './calc';

const PALETTE = ['R', 'V', 'I', 'L', 'C', 'SW', 'VCVS', 'VCCS', 'CCVS', 'CCCS', 'AM', 'VM', 'GND'] as const;

export function TransientMode() {
  const doc = useCircuitDoc('u6-transitorio', rcCarga());
  usePendingTemplate('u6-transitorio', doc.load);
  const a = useMemo(() => analyze(doc.circuit, { mode: 'transient' }), [doc.circuit]);
  const tr = useMemo<TransientResult | null>(() => (a.issues.some((i) => i.severity === 'error') ? null : transientAnalysis(a.net)), [a]);
  const trErr: Issue[] = tr && !tr.ok ? [{ code: 'impulso', severity: 'error', what: tr.error!, why: tr.storage.length ? 'La corriente de un inductor y el voltaje de un capacitor no pueden cambiar de golpe (energía ½Li² y ½Cv² continuas).' : 'Sin elementos almacenadores no hay transitorio.', consequence: tr.storage.length ? 'Exigiría un impulso (voltaje o corriente infinitos): arco eléctrico o daño.' : 'Las variables cambian instantáneamente.', fix: tr.storage.length ? 'Agregue una resistencia que dé camino a la corriente del inductor o que limite la corriente del capacitor.' : 'Agregue un inductor o un capacitor.', elements: tr.errorElement ? [tr.errorElement] : [], nodes: [] }] : [];
  const issues = [...a.issues, ...trErr];
  const ok = !!tr && tr.ok;
  const [sel, setSel] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [before, setBefore] = useState(false);
  const storage = ok ? tr!.storage : [];
  const defaultKeys = storage.map((s) => (s.kind === 'C' ? `v:${s.id}` : `i:${s.id}`));
  const keys = (sel.length ? sel : defaultKeys).filter((k) => tr?.vars.some((v) => v.key === k));
  const iv0 = ok ? tr!.intervals[0] : null;
  const tCur = cursor ?? (ok ? tr!.events[0] + (isFinite(iv0!.tau) ? iv0!.tau : 0) : 0);
  const vals = ok ? valuesAt(tr!, before ? tr!.events[0] - 1e-9 : tCur) : null;
  const keysSig = keys.join(',');
  const series = useMemo(
    () =>
      !ok
        ? []
        : keys.flatMap((k) => {
            const v = tr!.vars.find((x) => x.key === k)!;
            const out: any[] = [{ label: `${v.type}_${v.label} numérica [${v.unit}]`, x: tr!.t, y: tr!.numeric.get(k)!, width: 3 }];
            if (tr!.analytic) out.push({ label: `${v.type}_${v.label} analítica`, x: tr!.t, y: tr!.analytic.get(k)!, dash: [6, 4], width: 2 });
            return out;
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tr, keysSig],
  );
  const vlines = useMemo(() => (!ok ? [] : [...tr!.events.map((e) => ({ x: e, label: 't₀' })), ...tr!.intervals.filter((iv) => isFinite(iv.tau)).flatMap((iv) => [{ x: iv.t0 + iv.tau, label: 'τ (63,2 %)' }, { x: iv.t0 + 5 * iv.tau, label: '5τ' }])]), [tr, ok]);
  const onHover = useCallback((x: number | null) => {
    if (x !== null) setCursor(x);
  }, []);
  const errorIds = new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.elements));
  const p1 = (
    <div className="col">
      <CircuitEditor doc={doc} palette={[...PALETTE]} analysis={a} values={vals} nodeV={null} errorIds={errorIds} showSwitchBefore={before} />
      <label className="row small">
        <input type="checkbox" checked={before} onChange={(e) => setBefore(e.target.checked)} /> mostrar el circuito para t &lt; t₀ (interruptores en su estado inicial)
      </label>
      <h4>Panel de errores</h4>
      <IssuesPanel issues={issues} />
      {ok && (
        <>
          <Kpi
            items={tr!.intervals.flatMap((iv, k) => [
              { l: `Intervalo ${k + 1}: τ`, v: isFinite(iv.tau) ? fmtEng(iv.tau, 's', 4) : '∞ (sin descarga)' },
              { l: `R_eq vista por ${storage[0]?.label ?? 'L/C'}`, v: isFinite(iv.Req) ? fmtEng(iv.Req, 'Ω', 4) : '∞' },
            ])}
          />
          {!tr!.firstOrder && <div className="issue box-warn">Hay {storage.length} elementos almacenadores: no es un circuito de primer orden. Se muestra solo la solución numérica.</div>}
          <div className="row small">
            Graficar:
            {tr!.vars.map((v) => (
              <label key={v.key} className="row" style={{ gap: 2 }}>
                <input type="checkbox" checked={keys.includes(v.key)} onChange={(e) => setSel(e.target.checked ? [...keys, v.key] : keys.filter((k) => k !== v.key))} />
                {v.type}<sub>{v.label}</sub>
              </label>
            ))}
          </div>
          <Plot series={series} xLabel="t [s]" vlines={vlines} onHover={onHover} height={260} />
          <p className="hint">Mueva el mouse (o toque) sobre la gráfica: el dibujo muestra los valores en ese instante (t = {fmtEng(tCur, 's', 4)}). Error numérico vs analítico: {fmtNum(tr!.maxRelError * 100, 3)} % ({tr!.steps} pasos adaptativos).</p>
          {tr!.energy && (
            <div className="card">
              <h4>Energía</h4>
              <Kpi items={[{ l: 'Energía inicial almacenada W₀', v: fmtEng(tr!.energy.W0, 'J', 5) }, { l: 'Energía final almacenada', v: fmtEng(tr!.energy.Wfinal, 'J', 5) }, { l: 'Disipada en resistencias', v: fmtEng(tr!.energy.Wdiss, 'J', 5) }, { l: 'Entregada por fuentes', v: fmtEng(tr!.energy.Wsources, 'J', 5) }]} />
              <p className="hint">Balance en la ventana simulada (hasta 6τ): W₀ + W_fuentes = W_final + W_disipada ({fmtEng(tr!.energy.W0 + tr!.energy.Wsources, 'J', 4)} ≈ {fmtEng(tr!.energy.Wfinal + tr!.energy.Wdiss, 'J', 4)}). {Math.abs(tr!.energy.Wsources) < 1e-12 * Math.max(1, tr!.energy.W0) ? 'Respuesta natural: toda la energía inicial se disipa en las resistencias.' : 'Con fuentes conectadas la energía disipada sigue creciendo mientras la fuente entregue corriente: depende de la ventana simulada.'}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
  const p2 = ok ? <StepsView doc={transientDoc(a, tr!)} /> : <NeedsFix issues={issues} />;
  return <ThreePanels p1={p1} p2={p2} p3={ok && !tr!.firstOrder ? <div className="card box-warn">Circuito de orden superior: la estrategia de primer orden no aplica. Reduzca los inductores (o capacitores) en serie/paralelo a uno solo si es posible.</div> : <BetterView doc={transientBetter(tr)} />} />;
}

function transientDoc(a: Analysis, tr: TransientResult): StepDoc {
  if (!tr.firstOrder) {
    const last = tr.t.length - 1;
    return {
      title: 'Circuito de orden superior (solo solución numérica)',
      concept: `El circuito tiene ${tr.storage.length} elementos almacenadores (${tr.storage.map((x) => x.label).join(', ')}). Su respuesta no es una sola exponencial, así que la fórmula de primer orden NO se aplica: el simulador integra numéricamente (modelos compañeros, trapezoidal adaptativo). Este caso sale del alcance de la Unidad 6.`,
      identification: [L(a.net.elements.map((e) => describeElement(e, a.net)))],
      laws: [P('Se resolvería con una ecuación diferencial de segundo orden o mayor (Circuitos II).')],
      development: [P('Valores numéricos al inicio y al final del intervalo simulado:'), L(tr.storage.map((x) => { const k = x.kind === 'C' ? `v:${x.id}` : `i:${x.id}`; return `${x.kind === 'C' ? 'v' : 'i'}_${x.label}: ${fmtEng(tr.numeric.get(k)![0], x.kind === 'C' ? 'V' : 'A', 5)} → ${fmtEng(tr.numeric.get(k)![last], x.kind === 'C' ? 'V' : 'A', 5)}`; }))],
      results: [P('Vea las curvas numéricas en la ventanilla 1.')],
      verification: [P(tr.energy ? `Balance de energía (numérico): W₀ + W_fuentes = ${fmtEng(tr.energy.W0 + tr.energy.Wsources, 'J', 4)} ≈ W_final + W_disipada = ${fmtEng(tr.energy.Wfinal + tr.energy.Wdiss, 'J', 4)}.` : '—')],
      tip: 'Si dos inductores están en serie o paralelo (o dos capacitores), redúzcalos a uno equivalente y el circuito vuelve a ser de primer orden.',
    };
  }
  const S = tr.storage[0];
  const isC = S.kind === 'C';
  const xs = isC ? `v_C` : `i_L`;
  const key = isC ? `v:${S.id}` : `i:${S.id}`;
  const u = isC ? 'V' : 'A';
  const dev: StepDoc['development'] = [];
  dev.push(H(`Paso 1: circuito para t < t₀ = ${fmtEng(tr.events[0], 's')} (régimen permanente DC)`));
  if (S.icMode === 'given') dev.push(P(`Condición inicial dada: $${xs}(t_0^-) = ${texQ(S.ic ?? 0, u)}$.`));
  else {
    dev.push(P(`Con los interruptores en su estado inicial, ${isC ? 'el capacitor es un circuito abierto' : 'el inductor es un cortocircuito'} (DC):`));
    dev.push(T(`${xs}(t_0^-) = ${texQ(tr.intervals[0].xMinus.get(key) ?? 0, u)}`, '(1)'));
  }
  let n = 1;
  tr.intervals.forEach((iv, k) => {
    const x0 = iv.x0.get(key)!;
    const xi = iv.xInf.get(key)!;
    dev.push(H(`${k === 0 ? 'Paso 2' : `Intervalo ${k + 1}`}: circuito para t > ${fmtEng(iv.t0, 's')}`));
    dev.push(P(`Continuidad: ${isC ? 'el voltaje del capacitor' : 'la corriente del inductor'} no cambia de golpe:`));
    dev.push(T(`${xs}(${texNum(iv.t0)}^+) = ${xs}(${texNum(iv.t0)}^-) = ${texQ(x0, u)}`, `(${++n})`));
    dev.push(P(`Thévenin visto por ${S.label} (fuentes independientes apagadas${a.net.elements.some((e) => e.kind.length === 4) ? '; con dependientes se usa una fuente de prueba' : ''}):`));
    dev.push(T(`R_{eq} = ${isFinite(iv.Req) ? texQ(iv.Req, 'Ω') : '\\infty'},\\qquad \\tau = ${isC ? 'R_{eq}C' : '\\frac{L}{R_{eq}}'} = ${isFinite(iv.tau) ? texQ(iv.tau, 's') : '\\infty'}`, `(${++n})`));
    dev.push(P(`Valor final (${isC ? 'C abierto' : 'L en corto'} con la nueva posición de los interruptores):`));
    dev.push(T(`${xs}(\\infty) = ${texQ(xi, u)}`, `(${++n})`));
    dev.push(T(isFinite(iv.tau) ? `${xs}(t) = ${texNum(xi, 5)} + \\left(${texNum(x0, 5)} - ${xi < 0 ? `(${texNum(xi, 5)})` : texNum(xi, 5)}\\right)e^{-(t - ${texNum(iv.t0)})/${texNum(iv.tau, 5)}}\\ [${u}]` : `${xs}(t) = ${texNum(x0, 5)}\\ [${u}]\\ (\\text{constante})`, `(${++n})`));
  });
  return {
    title: tr.firstOrder ? 'Respuesta de un circuito de primer orden' : 'Circuito de orden superior',
    concept: 'Todo circuito de primer orden (un solo L o C con resistencias y fuentes DC) responde con una exponencial: $x(t) = x(\\infty) + [x(t_0^+) - x(\\infty)]\\,e^{-(t - t_0)/\\tau}$, con $\\tau = L/R_{eq}$ o $\\tau = R_{eq}C$. Si no hay fuentes después de la conmutación, x(∞) = 0: es la respuesta natural.',
    identification: [L(a.net.elements.map((e) => describeElement(e, a.net))), P(`Conmutaciones en: ${tr.events.map((e) => fmtEng(e, 's')).join(', ')}.`)],
    laws: [T('x(t) = x(\\infty) + [x(t_0^+) - x(\\infty)]\\,e^{-(t-t_0)/\\tau},\\qquad \\tau_{RL} = \\frac{L}{R_{eq}},\\ \\tau_{RC} = R_{eq}C'), P('$i_L$ y $v_C$ son continuas; las demás variables pueden saltar en $t_0$.')],
    development: dev,
    results: tr.intervals.map((w, k) => { const a0 = w.x0.get(key)!; const b0 = w.xInf.get(key)!; const rng = `${texNum(w.t0)} \\le t${isFinite(w.t1) ? ` < ${texNum(w.t1)}` : ''}`; return BOX(isFinite(w.tau) && Math.abs(a0 - b0) > 1e-12 ? `${xs}(t) = ${texNum(b0, 5)} ${a0 - b0 < 0 ? '-' : '+'} ${texNum(Math.abs(a0 - b0), 5)}\\,e^{-(t-${texNum(w.t0)})/${texNum(w.tau, 5)}}\\ [${u}],\\quad ${rng}` : `${xs}(t) = ${texNum(a0, 5)}\\ [${u}]\\ (\\text{constante}),\\quad ${rng}`); }),
    verification: [
      P(`Comparación con la integración numérica (trapezoidal adaptativa): error máximo ${fmtNum(tr.maxRelError * 100, 3)} % ✓. En $t = t_0 + \\tau$ la variable recorrió el 63,2 % del cambio; en $5\\tau$ el 99,3 %.`),
      ...(tr.energy ? [P(`Energía: inicial ${fmtEng(tr.energy.W0, 'J', 5)}, disipada ${fmtEng(tr.energy.Wdiss, 'J', 5)}, entregada por fuentes ${fmtEng(tr.energy.Wsources, 'J', 5)}, final ${fmtEng(tr.energy.Wfinal, 'J', 5)} ✓.`)] : []),
    ],
    tip: 'Tres números y listo: x(t₀⁺) (continuidad), x(∞) (DC final) y τ (R_eq visto por L o C). Escriba la fórmula general sin resolver ninguna ecuación diferencial.',
  };
}

function transientBetter(tr: TransientResult | null): BetterDoc {
  return {
    method: 'Fórmula general de primer orden (método de los tres valores)',
    why: 'Evita plantear y resolver la ecuación diferencial: la forma de la respuesta siempre es la misma exponencial.',
    savings: 'Tres cálculos DC sencillos en lugar de una ecuación diferencial.',
    formulas: [
      { tex: 'x(t) = x(\\infty) + [x(t_0^+) - x(\\infty)]e^{-(t-t_0)/\\tau}', meaning: 'Vale para CUALQUIER variable del circuito.' },
      { tex: '\\tau = L/R_{eq},\\quad \\tau = R_{eq}C', meaning: 'R_eq = Thévenin visto desde los terminales de L o C.' },
      { tex: 'W_0 = \\tfrac12 L I_0^2 = \\int_0^\\infty p_R\\,dt', meaning: 'En la respuesta natural toda la energía se disipa en las resistencias.' },
    ],
    tricks: ['A los 5τ se considera terminado el transitorio.', 'Con varios interruptores, el valor final de un intervalo es el inicial del siguiente.', 'Con fuentes dependientes, R_eq por fuente de prueba.'],
    mistakes: ['Usar la condición inicial de una variable que SÍ puede saltar (solo i_L y v_C son continuas).', 'Calcular τ con la R del circuito antes de conmutar.', 'Olvidar apagar las fuentes al calcular R_eq.'],
    compare: { long: 'Plantear LVK, obtener L di/dt + R i = E y resolver la ecuación diferencial.', short: 'Tres valores y la fórmula general.', result: tr?.ok && tr.intervals[0] ? `$\\tau = ${isFinite(tr.intervals[0].tau) ? texQ(tr.intervals[0].tau, 's') : '\\infty'}$ en ambos casos.` : 'la misma exponencial.' },
  };
}

// =============== Calculadora de respuesta natural / escalón ===============
export function FormulaMode() {
  const [s, set] = usePreset('u6-formula', { type: 'RC' as 'RL' | 'RC', R: '1k', K: '1µ', x0: '0', xInf: '10' });
  const R = parseSI(s.R, 'Ω');
  const K = parseSI(s.K, s.type === 'RL' ? 'H' : 'F');
  const x0 = parseSI(s.x0);
  const xi = parseSI(s.xInf);
  const errs = [!R.ok ? `R: ${R.error}` : R.value! <= 0 ? 'R debe ser positiva.' : '', !K.ok ? `${s.type === 'RL' ? 'L' : 'C'}: ${K.error}` : K.value! <= 0 ? 'L o C debe ser positiva.' : '', !x0.ok ? `x(0): ${x0.error}` : '', !xi.ok ? `x(∞): ${xi.error}` : ''].filter(Boolean);
  const ok = !errs.length;
  const tau = ok ? (s.type === 'RL' ? K.value! / R.value! : R.value! * K.value!) : NaN;
  const ts = ok ? Array.from({ length: 301 }, (_, k) => (6 * tau * k) / 300) : [];
  const u = s.type === 'RL' ? 'A' : 'V';
  const xs = s.type === 'RL' ? 'i_L' : 'v_C';
  const f = (t: number) => xi.value! + (x0.value! - xi.value!) * Math.exp(-t / tau);
  const p1 = (
    <div className="col">
      <div className="row">
        <button className={s.type === 'RC' ? 'active' : ''} onClick={() => s.type !== 'RC' && set({ ...s, type: 'RC', K: '1µ' })}>RC</button>
        <button className={s.type === 'RL' ? 'active' : ''} onClick={() => s.type !== 'RL' && set({ ...s, type: 'RL', K: '0,5' })}>RL</button>
      </div>
      <div className="row">
        <label className="row">R [Ω] <input value={s.R} onChange={(e) => set({ ...s, R: e.target.value })} style={{ width: 80 }} aria-label="R" /></label>
        <label className="row">{s.type === 'RL' ? 'L [H]' : 'C [F]'} <input value={s.K} onChange={(e) => set({ ...s, K: e.target.value })} style={{ width: 80 }} aria-label="L o C" /></label>
        <label className="row">{xs}(0⁺) [{u}] <input value={s.x0} onChange={(e) => set({ ...s, x0: e.target.value })} style={{ width: 70 }} aria-label="valor inicial" /></label>
        <label className="row">{xs}(∞) [{u}] <input value={s.xInf} onChange={(e) => set({ ...s, xInf: e.target.value })} style={{ width: 70 }} aria-label="valor final" /></label>
      </div>
      {errs.length > 0 && <div className="issue box-err" role="alert">{errs.join(' ')}</div>}
      {ok && (
        <>
          <Kpi items={[{ l: 'τ', v: fmtEng(tau, 's', 5) }, { l: `${xs}(τ)`, v: fmtEng(f(tau), u, 5) }, { l: `${xs}(5τ)`, v: fmtEng(f(5 * tau), u, 5) }, { l: 'Tipo', v: xi.value === 0 ? 'respuesta natural' : 'respuesta al escalón' }]} />
          <Plot series={[{ label: `${xs}(t) [${u}]`, x: ts, y: ts.map(f) }]} xLabel="t [s]" vlines={[{ x: tau, label: 'τ (63,2 %)' }, { x: 5 * tau, label: '5τ' }]} points={[{ x: tau, y: f(tau) }]} height={260} />
        </>
      )}
    </div>
  );
  const doc: StepDoc | null = ok
    ? {
        title: s.type === 'RC' ? 'Circuito RC de primer orden' : 'Circuito RL de primer orden',
        concept: xi.value === 0 ? 'Respuesta natural: sin fuentes, la energía almacenada se disipa en R y la variable decae exponencialmente a cero.' : 'Respuesta al escalón: la variable pasa exponencialmente de su valor inicial al valor final.',
        identification: [L([`$R = ${texQ(R.value!, 'Ω')}$`, s.type === 'RL' ? `$L = ${texQ(K.value!, 'H')}$` : `$C = ${texQ(K.value!, 'F')}$`, `$${xs}(0^+) = ${texQ(x0.value!, u)}$, $${xs}(\\infty) = ${texQ(xi.value!, u)}$`])],
        laws: [T(s.type === 'RL' ? '\\tau = L/R,\\quad i(t) = I_0 e^{-t/\\tau}\\ (\\text{natural})' : '\\tau = RC,\\quad v(t) = V_0 e^{-t/\\tau}\\ (\\text{natural})'), T('x(t) = x(\\infty) + [x(0^+) - x(\\infty)]e^{-t/\\tau}')],
        development: [T(`\\tau = ${s.type === 'RL' ? `\\frac{${texNum(K.value!)}}{${texNum(R.value!)}}` : `${texNum(R.value!)}\\cdot ${texNum(K.value!)}`} = ${texQ(tau, 's')}`, '(1)'), T(`${xs}(t) = ${texNum(xi.value!)} + (${texNum(x0.value! - xi.value!)})e^{-t/${texNum(tau, 5)}}\\ [${u}]`, '(2)')],
        results: [BOX(`${xs}(t) = ${texNum(xi.value!)} + (${texNum(x0.value! - xi.value!)})e^{-t/${texNum(tau, 5)}}\\ [${u}]`)],
        verification: [P(`En t = 0: ${fmtEng(f(0), u)} = x(0⁺) ✓. En t = τ: se recorrió el 63,2 % del cambio ✓. En 5τ: ${fmtEng(f(5 * tau), u, 5)} ≈ x(∞) ✓.`)],
        tip: 'τ es el tiempo en que la exponencial recorre el 63,2 % del cambio total; la pendiente inicial corta al valor final justo en t = τ.',
      }
    : null;
  return <ThreePanels titles={['Datos', 'Solución', 'Cómo resolverlo de una mejor manera']} p1={p1} p2={doc ? <StepsView doc={doc} /> : <div className="card box-err">Corrija los datos.</div>} p3={<BetterView doc={transientBetter(null)} />} />;
}
