import React, { useMemo } from 'react';
import { analyze } from '../engine/analyze';
import { ElementResult } from '../engine/mna';
import { key, onSegment, pinsOf } from '../engine/netlist';
import { Circuit, Pt, isDependent } from '../engine/types';
import { usePalette } from './basic';
import { ElementView, fitView, toSub } from './CircuitEditor';
import { U } from './symbols';

/** Dibujo estático de un circuito (ejercicios, pasos de reducción, plantillas). */
export function CircuitPreview({ circuit, height = 220, values = null, showNodes = true, showMeshes = false, highlightIds = [], showSwitchBefore }: { circuit: Circuit; height?: number; values?: Map<string, ElementResult> | null; showNodes?: boolean; showMeshes?: boolean; highlightIds?: string[]; showSwitchBefore?: boolean }) {
  const pal = usePalette();
  const v = fitView(circuit);
  const a = useMemo(() => analyze(circuit), [circuit]);
  const hi = new Set(highlightIds);
  const junctions = useMemo(() => {
    const cnt = new Map<string, number>();
    const add = (p: Pt) => cnt.set(key(p), (cnt.get(key(p)) ?? 0) + 1);
    for (const e of circuit.elements) {
      if (e.kind === 'GND') continue;
      const { a: pa, b } = pinsOf(e);
      add(pa);
      add(b);
    }
    for (const w of circuit.wires) {
      add(w.a);
      add(w.b);
    }
    const pts = [...cnt.keys()].map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }));
    for (const w of circuit.wires) for (const p of pts) if (onSegment(p, w.a, w.b) && key(p) !== key(w.a) && key(p) !== key(w.b)) cnt.set(key(p), (cnt.get(key(p)) ?? 0) + 2);
    return pts.filter((p) => (cnt.get(key(p)) ?? 0) >= 3);
  }, [circuit]);
  const labelOf = (id?: string) => circuit.elements.find((e) => e.id === id)?.label ?? '?';
  return (
    <svg viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} style={{ width: '100%', height, background: pal.bg, borderRadius: 8, border: '1px solid var(--border)' }} role="img" aria-label="Diagrama del circuito">
      {circuit.wires.map((w) => (
        <line key={w.id} x1={w.a.x * U} y1={w.a.y * U} x2={w.b.x * U} y2={w.b.y * U} stroke={pal.wire} strokeWidth={2} strokeLinecap="round" />
      ))}
      {circuit.elements.map((e) => (
        <ElementView key={e.id} e={e} pal={pal} res={values?.get(e.id) ?? null} highlight={hi.has(e.id)} ctrlLabel={isDependent(e.kind) ? labelOf(e.ctrlRef) : undefined} showSwitchBefore={showSwitchBefore} />
      ))}
      {junctions.map((p) => (
        <circle key={key(p)} cx={p.x * U} cy={p.y * U} r={4} fill={pal.node} />
      ))}
      {showNodes &&
        a.net.nodePoints.map((pts, n) => {
          if (!pts.length) return null;
          const p = pts.find((q) => junctions.some((j) => j.x === q.x && j.y === q.y)) ?? pts.reduce((m, q) => (q.y < m.y || (q.y === m.y && q.x < m.x) ? q : m), pts[0]);
          return (
            <text key={n} x={p.x * U + 6} y={p.y * U - 8} fontSize={11.5} fill={pal.node} fontWeight={600}>
              {n === 0 ? '⏚' : `(${a.net.nodeNames[n]})`}
            </text>
          );
        })}
      {showMeshes &&
        a.topo.meshes.map((m) => (
          <text key={m.index} x={m.center.x * U} y={m.center.y * U + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill={pal.mesh}>
            ↻ I{toSub(m.index)}
          </text>
        ))}
    </svg>
  );
}
