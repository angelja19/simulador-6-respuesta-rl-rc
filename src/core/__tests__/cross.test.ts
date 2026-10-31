import { describe, expect, it } from 'vitest';
import { analyze } from '../engine/analyze';
import { mulberry32, randomGridCircuit } from '../engine/generate';
import { meshAnalysis } from '../engine/methods/mesh';
import { nodalAnalysis } from '../engine/methods/nodal';

describe('pruebas cruzadas con circuitos aleatorios', () => {
  const configs = [
    { cols: 2, rows: 1, vSources: 1, iSources: 0 },
    { cols: 2, rows: 1, vSources: 1, iSources: 1 },
    { cols: 3, rows: 1, vSources: 2, iSources: 1 },
    { cols: 2, rows: 2, vSources: 1, iSources: 1 },
    { cols: 2, rows: 2, vSources: 1, iSources: 0, dependent: true },
    { cols: 3, rows: 2, vSources: 2, iSources: 1, dependent: true },
  ];
  configs.forEach((cfg, ci) => {
    it(`configuración ${ci + 1}: nodos = mallas = MNA, balance de potencias, LCK/LVK con residuo 0`, () => {
      const rng = mulberry32(1000 + ci);
      for (let k = 0; k < 15; k++) {
        const c = randomGridCircuit(rng, cfg);
        const a = analyze(c);
        expect(a.ok).toBe(true);
        const n = nodalAnalysis(a.net);
        expect(n.ok).toBe(true);
        const m = meshAnalysis(a.net, a.topo);
        expect(m.ok).toBe(true);
        for (const e of a.net.elements) {
          const ref = a.dc!.el.get(e.id)!;
          const scale = Math.max(1, Math.abs(ref.i));
          expect(Math.abs(m.current.get(e.id)! - ref.i) / scale).toBeLessThan(1e-9);
        }
        for (let q = 1; q < a.net.nodeCount; q++) expect(Math.abs(n.V[q] - a.dc!.V[q]) / Math.max(1, Math.abs(a.dc!.V[q]))).toBeLessThan(1e-9);
        expect(a.balance.ok).toBe(true);
        for (const x of a.kcl) expect(Math.abs(x.residual)).toBeLessThan(1e-9);
        for (const x of a.kvl) expect(Math.abs(x.residual)).toBeLessThan(1e-9);
      }
    });
  });
});
