import { describe, expect, it } from 'vitest';
import { cb } from '../engine/builder';
import { buildNetlist } from '../engine/netlist';
import { transientAnalysis } from '../engine/transient';

export function rcCarga() {
  const b = cb();
  b.el('V', 'E', '10', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
  b.el('R', 'R', '1k', [8, 0], [16, 0]);
  b.el('C', 'C', '1µ', [16, 0], [16, 8]);
  b.wire([0, 8], [16, 8]);
  b.gnd([0, 8]);
  return b.build();
}
export function rlNatural() {
  const b = cb();
  b.el('V', 'E', '10', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'open', t0: '0' });
  b.el('R', 'R1', '10', [8, 0], [16, 0]);
  b.el('L', 'L', '1', [16, 0], [16, 8]);
  b.wire([16, 0], [24, 0]);
  b.el('R', 'R2', '20', [24, 0], [24, 8]);
  b.wire([0, 8], [24, 8]);
  b.gnd([0, 8]);
  return b.build();
}

describe('transitorios de primer orden', () => {
  it('RC al escalón: v_C(t) = 10(1 − e^{−t/τ}), τ = RC = 1 ms; numérica vs analítica < 0,1 %', () => {
    const net = buildNetlist(rcCarga());
    const r = transientAnalysis(net);
    expect(r.ok).toBe(true);
    const iv = r.intervals[0];
    expect(Math.abs(iv.tau - 1e-3) / 1e-3).toBeLessThan(1e-9);
    const c = net.elements.find((e) => e.label === 'C')!;
    const key = `v:${c.id}`;
    // analítica exacta en puntos
    r.t.forEach((t, i) => {
      if (t <= 0) return;
      const exact = 10 * (1 - Math.exp(-t / 1e-3));
      expect(Math.abs(r.analytic!.get(key)![i] - exact)).toBeLessThan(1e-9 * 10);
    });
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('RL natural: i(t) = I₀ e^{−t/τ}, τ = L/R = 0,05 s; energía inicial = energía disipada', () => {
    const net = buildNetlist(rlNatural());
    const r = transientAnalysis(net);
    expect(r.ok).toBe(true);
    const iv = r.intervals[0];
    expect(Math.abs(iv.tau - 0.05)).toBeLessThan(1e-12);
    const L = net.elements.find((e) => e.label === 'L')!;
    expect(Math.abs(iv.x0.get(`i:${L.id}`)! - 1)).toBeLessThan(1e-12);
    expect(Math.abs(iv.xInf.get(`i:${L.id}`)!)).toBeLessThan(1e-12);
    expect(r.maxRelError).toBeLessThan(1e-3);
    expect(Math.abs(r.energy!.W0 - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(r.energy!.Wdiss - r.energy!.W0) / r.energy!.W0).toBeLessThan(5e-3);
  });
  it('llaveo secuencial: dos interruptores encadenan la respuesta por intervalos', () => {
    const b = cb();
    b.el('V', 'E', '10', [0, 0], [0, 8]);
    b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
    b.el('R', 'R', '1k', [8, 0], [16, 0]);
    b.el('C', 'C', '1µ', [16, 0], [16, 8]);
    b.wire([16, 0], [24, 0]);
    b.el('SW', 'S2', '', [24, 0], [24, 4], { swMode: 'close', t0: '2m' });
    b.el('R', 'R2', '1k', [24, 4], [24, 8]);
    b.wire([0, 8], [24, 8]);
    b.gnd([0, 8]);
    const net = buildNetlist(b.build());
    const r = transientAnalysis(net);
    expect(r.ok).toBe(true);
    expect(r.intervals.length).toBe(2);
    const c = net.elements.find((e) => e.label === 'C')!;
    const v2 = 10 * (1 - Math.exp(-2));
    expect(Math.abs(r.intervals[1].x0.get(`v:${c.id}`)! - v2)).toBeLessThan(1e-9);
    expect(Math.abs(r.intervals[1].tau - 0.5e-3)).toBeLessThan(1e-12);
    expect(Math.abs(r.intervals[1].xInf.get(`v:${c.id}`)! - 5)).toBeLessThan(1e-9);
    expect(r.maxRelError).toBeLessThan(1e-3);
  });
  it('detecta la interrupción brusca de la corriente de un inductor', () => {
    const b = cb();
    b.el('V', 'E', '10', [0, 0], [0, 8]);
    b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'open', t0: '0' });
    b.el('R', 'R1', '10', [8, 0], [16, 0]);
    b.el('L', 'L', '1', [16, 0], [16, 8]);
    b.wire([0, 8], [16, 8]);
    b.gnd([0, 8]);
    const r = transientAnalysis(buildNetlist(b.build()));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/interrumpida/);
  });
  it('detecta un capacitor forzado a cambiar de voltaje al instante', () => {
    const b = cb();
    b.el('V', 'E', '10', [0, 0], [0, 8]);
    b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
    b.el('C', 'C', '1µ', [8, 0], [8, 8]);
    b.el('R', 'R', '1k', [8, 0], [16, 0]);
    b.wire([16, 0], [16, 8]);
    b.wire([0, 8], [16, 8]);
    b.gnd([0, 8]);
    const r = transientAnalysis(buildNetlist(b.build()));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cambiar su voltaje/);
  });
});
