import { describe, expect, it } from 'vitest';
import { analyze } from '../core/engine/analyze';
import { buildNetlist } from '../core/engine/netlist';
import { transientAnalysis } from '../core/engine/transient';
import { mulberry32 } from '../core/engine/generate';
import { firstOrder, rcCarga, rcDependiente, rcDescarga, rlEscalon, rlNatural, secuencial, valuesAt } from '../sim/calc';
import { GENS } from '../sim/content';

const tr = (c: ReturnType<typeof rcCarga>) => transientAnalysis(buildNetlist(c));

describe('Simulador 6 — transitorios', () => {
  it('RC carga: τ = 1 ms, v_C(∞) = 10 V, numérica vs analítica < 0,1 %', () => {
    const r = tr(rcCarga());
    expect(r.ok).toBe(true);
    expect(r.intervals[0].tau).toBeCloseTo(1e-3, 12);
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('RC descarga: v_C(0) = 12·5/7 V, τ = R2·C = 50 ms', () => {
    const r = tr(rcDescarga());
    const C = r.storage[0];
    expect(r.intervals[0].x0.get(`v:${C.id}`)).toBeCloseTo((12 * 5) / 7, 9);
    expect(r.intervals[0].tau).toBeCloseTo(0.05, 12);
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('RL natural: energía inicial = energía disipada', () => {
    const r = tr(rlNatural());
    expect(r.energy!.W0).toBeCloseTo(0.5, 12);
    expect(Math.abs(r.energy!.Wdiss - 0.5) / 0.5).toBeLessThan(5e-3);
  });
  it('RL escalón: i_L → 3 A con τ = 50 ms', () => {
    const r = tr(rlEscalon());
    const L = r.storage[0];
    expect(r.intervals[0].xInf.get(`i:${L.id}`)).toBeCloseTo(3, 12);
    expect(r.intervals[0].tau).toBeCloseTo(0.05, 12);
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('llaveo secuencial: dos intervalos encadenados', () => {
    const r = tr(secuencial());
    expect(r.intervals.length).toBe(2);
    expect(r.intervals[1].tau).toBeCloseTo(0.5e-3, 12);
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('fuente dependiente: R_eq = 8 kΩ por fuente de prueba, τ = 0,4 s', () => {
    const r = tr(rcDependiente());
    expect(r.ok).toBe(true);
    expect(r.intervals[0].Req).toBeCloseTo(8000, 6);
    expect(r.intervals[0].tau).toBeCloseTo(0.4, 9);
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('validador en modo transitorio no marca errores en las plantillas', () => {
    for (const c of [rcCarga(), rcDescarga(), rlNatural(), rlEscalon(), secuencial(), rcDependiente()]) {
      expect(analyze(c, { mode: 'transient' }).issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
  it('fórmula general y valores en un instante', () => {
    expect(firstOrder(10, 0, 1, 1)).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);
    const r = tr(rcCarga());
    const v = valuesAt(r, 1e-3);
    const C = r.storage[0];
    expect(v.get(C.id)!.v).toBeCloseTo(10 * (1 - Math.exp(-1)), 2);
  });
  it('ejercicios generados con respuestas finitas', () => {
    const rr = mulberry32(13);
    for (const g of GENS)
      for (const l of ['basico', 'intermedio', 'examen'] as const) {
        const ex = g.gen(rr, l);
        for (const x of ex.answers) expect(isFinite(x.value)).toBe(true);
      }
  });
});
