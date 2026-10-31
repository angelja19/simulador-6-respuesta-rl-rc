import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analysis } from '../engine/analyze';
import { ElementResult } from '../engine/mna';
import { key, pinsOf, onSegment } from '../engine/netlist';
import { CElement, Circuit, ELEMENT_LEN, Kind, KIND_INFO, Pt, Wire, isDependent, isVoltageControlled } from '../engine/types';
import { fmtEng } from '../engine/units';
import { downloadText, usePalette } from './basic';
import { CircuitDoc } from './useCircuitDoc';
import { LEN, PALETTE_NAMES, PaletteIcon, SymbolShape, U } from './symbols';

export const DEFAULT_VALUE: Record<Kind, string> = { R: '10', G: '0,1', V: '10', I: '1', VCVS: '2', VCCS: '0,5', CCVS: '5', CCCS: '2', L: '10m', C: '100µ', SW: '', AM: '', VM: '', GND: '' };
const LABEL_PREFIX: Record<Kind, string> = { R: 'R', G: 'G', V: 'E', I: 'Is', VCVS: 'Vd', VCCS: 'Id', CCVS: 'Vd', CCCS: 'Id', L: 'L', C: 'C', SW: 'S', AM: 'A', VM: 'Vm', GND: 'GND' };

export type PickMode = { kind: 'node' | 'element' | 'mesh'; count: number; onPick: (ids: (string | number)[]) => void; prompt: string } | null;

export interface EditorProps {
  doc: CircuitDoc;
  palette: Kind[];
  analysis?: Analysis | null;
  /** resultados a mostrar sobre el dibujo (por defecto los DC del análisis) */
  values?: Map<string, ElementResult> | null;
  nodeV?: number[] | null;
  errorIds?: Set<string>;
  errorNodes?: number[];
  highlightIds?: string[];
  highlightNodes?: number[];
  showMeshes?: boolean;
  highlightMesh?: number | null;
  pick?: PickMode;
  /** se muestra el estado de interruptores en t < t0 */
  showSwitchBefore?: boolean;
  toolbarExtra?: ReactNode;
  onSelect?: (sel: { element?: string; node?: number } | null) => void;
  height?: number;
}

type Tool = { t: 'select' } | { t: 'wire' } | { t: 'place'; kind: Kind } | { t: 'name' };

const snap = (v: number) => Math.round(v);
let idCounter = Date.now() % 100000;
const newId = (p: string) => `${p}${(idCounter++).toString(36)}`;

function nextLabel(c: Circuit, kind: Kind) {
  const p = LABEL_PREFIX[kind];
  let n = 1;
  const used = new Set(c.elements.map((e) => e.label));
  while (used.has(`${p}${n}`)) n++;
  return `${p}${n}`;
}

export function CircuitEditor(props: EditorProps) {
  const { doc, palette, analysis } = props;
  const c = doc.circuit;
  const pal = usePalette();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>({ t: 'select' });
  const [sel, setSel] = useState<{ el?: string; wire?: string; node?: number } | null>(null);
  const [view, setView] = useState(() => fitView(c));
  const [hover, setHover] = useState<Pt | null>(null);
  const [wireStart, setWireStart] = useState<Pt | null>(null);
  const [valMode, setValMode] = useState<'resumen' | 'completo' | 'ninguno'>('resumen');
  const showVals = valMode !== 'ninguno';
  const [picked, setPicked] = useState<(string | number)[]>([]);
  const drag = useRef<{ mode: 'move' | 'pan'; start: Pt; orig: CElement | null; view?: typeof view; moved: boolean; pointerId: number } | null>(null);

  useEffect(() => setPicked([]), [props.pick]);
  // encuadrar cuando se carga un circuito nuevo (plantilla, archivo o enlace)
  useEffect(() => {
    if (doc.loadCount) setView(fitView(doc.circuit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.loadCount]);
  useEffect(() => {
    props.onSelect?.(sel?.el ? { element: sel.el } : sel?.node !== undefined ? { node: sel.node } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const toWorld = useCallback((ev: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x / U, y: p.y / U };
  }, []);

  const values = props.values !== undefined ? props.values : analysis?.dc?.el ?? null;
  const nodeV = props.nodeV !== undefined ? props.nodeV : analysis?.dc?.V ?? null;
  const net = analysis?.net;

  // nodo al que pertenece cada punto de grilla
  const nodeAt = useMemo(() => {
    const m = new Map<string, number>();
    if (net) net.nodePoints.forEach((pts, n) => pts.forEach((p) => m.set(key(p), n)));
    return m;
  }, [net]);

  // puntos de unión (3 o más conexiones) y punto representativo de cada nodo
  const junctions = useMemo(() => {
    const cnt = new Map<string, number>();
    const add = (p: Pt) => cnt.set(key(p), (cnt.get(key(p)) ?? 0) + 1);
    for (const e of c.elements) {
      if (e.kind === 'GND') continue;
      const { a, b } = pinsOf(e);
      add(a);
      add(b);
    }
    for (const w of c.wires) {
      add(w.a);
      add(w.b);
    }
    // puntos sobre el interior de cables
    const allPts = [...cnt.keys()].map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    });
    for (const w of c.wires) for (const p of allPts) if (onSegment(p, w.a, w.b) && key(p) !== key(w.a) && key(p) !== key(w.b)) cnt.set(key(p), (cnt.get(key(p)) ?? 0) + 2);
    return allPts.filter((p) => (cnt.get(key(p)) ?? 0) >= 3);
  }, [c]);
  const nodeLabelPos = useMemo(() => {
    const m = new Map<number, Pt>();
    if (!net) return m;
    net.nodePoints.forEach((pts, n) => {
      if (!pts.length) return;
      // preferir una unión; si no, el punto más arriba-izquierda
      const j = pts.find((p) => junctions.some((q) => q.x === p.x && q.y === p.y));
      m.set(n, j ?? pts.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a), pts[0]));
    });
    return m;
  }, [net, junctions]);

  // ------------- acciones -------------
  const update = (fn: (c: Circuit) => Circuit) => doc.set(fn(JSON.parse(JSON.stringify(c))));
  const selectedEl = sel?.el ? c.elements.find((e) => e.id === sel.el) : undefined;
  const rotate = () =>
    selectedEl &&
    update((cc) => {
      const e = cc.elements.find((x) => x.id === selectedEl.id)!;
      // girar 90° alrededor del terminal de origen (queda conectado a su cable)
      e.rot = ((e.rot + 1) % 4) as 0 | 1 | 2 | 3;
      return cc;
    });
  const flip = () =>
    selectedEl &&
    update((cc) => {
      const e = cc.elements.find((x) => x.id === selectedEl.id)!;
      e.flip = !e.flip;
      return cc;
    });
  const del = () => {
    if (sel?.el)
      update((cc) => {
        cc.elements = cc.elements.filter((x) => x.id !== sel.el);
        for (const x of cc.elements) if (x.ctrlRef === sel.el) x.ctrlRef = undefined;
        return cc;
      });
    if (sel?.wire) update((cc) => ({ ...cc, wires: cc.wires.filter((w) => w.id !== sel.wire) }));
    setSel(null);
  };
  const duplicate = () =>
    selectedEl &&
    update((cc) => {
      const ne = { ...selectedEl, id: newId(selectedEl.kind), label: nextLabel(cc, selectedEl.kind), x: selectedEl.x + 2, y: selectedEl.y + 2 };
      cc.elements.push(ne);
      return cc;
    });
  const clearAll = () => {
    if (confirm('¿Borrar todo el circuito? (se puede deshacer)')) {
      doc.set({ elements: [], wires: [], nodeNames: [] });
      setSel(null);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? doc.redo() : doc.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doc.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel) {
          e.preventDefault();
          del();
        }
      } else if (e.key === 'r' || e.key === 'R') rotate();
      else if (e.key === 'f' || e.key === 'F') flip();
      else if (e.key === 'Escape') {
        setWireStart(null);
        setTool({ t: 'select' });
      } else if (e.key === 'w' || e.key === 'W') setTool({ t: 'wire' });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const placeAt = (kind: Kind, p: Pt) => {
    const id = newId(kind);
    update((cc) => {
      const e: CElement = { id, kind, label: kind === 'GND' ? 'Tierra' : nextLabel(cc, kind), value: DEFAULT_VALUE[kind], x: snap(p.x), y: snap(p.y), rot: kind === 'V' || kind === 'VCVS' || kind === 'CCVS' ? 1 : kind === 'I' || kind === 'VCCS' || kind === 'CCCS' ? 3 : 0 };
      if (kind === 'SW') {
        e.swMode = 'close';
        e.t0 = '0';
      }
      if (kind === 'L' || kind === 'C') {
        e.icMode = 'dc';
        e.ic = '0';
      }
      // la fuente dependiente se crea SIN control: el validador pide elegirlo explícitamente
      cc.elements.push(e);
      return cc;
    });
    setSel({ el: id });
    setTool({ t: 'select' });
  };

  const addWire = (a: Pt, b: Pt) => {
    if (a.x === b.x && a.y === b.y) return;
    update((cc) => {
      const segs: Wire[] = [];
      if (a.x === b.x || a.y === b.y) segs.push({ id: newId('w'), a, b });
      else {
        const corner = { x: b.x, y: a.y };
        segs.push({ id: newId('w'), a, b: corner }, { id: newId('w'), a: corner, b });
      }
      cc.wires.push(...segs);
      return cc;
    });
  };

  const handlePick = (id: string | number) => {
    if (!props.pick) return;
    const np = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    if (np.length >= props.pick.count) {
      props.pick.onPick(np.slice(0, props.pick.count));
      setPicked([]);
    } else setPicked(np);
  };

  // ------------- eventos del lienzo -------------
  const onPointerDown = (ev: React.PointerEvent) => {
    const p = toWorld(ev);
    if (tool.t === 'select' || tool.t === 'name') {
      drag.current = { mode: 'pan', start: { x: ev.clientX, y: ev.clientY }, orig: null, view, moved: false, pointerId: ev.pointerId };
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
    }
    setHover(p);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const p = toWorld(ev);
    setHover({ x: snap(p.x), y: snap(p.y) });
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan' && d.view) {
      const svg = svgRef.current!;
      const k = d.view.w / svg.clientWidth;
      const dx = (ev.clientX - d.start.x) * k;
      const dy = (ev.clientY - d.start.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
    } else if (d.mode === 'move' && d.orig) {
      const dx = snap(p.x - d.start.x);
      const dy = snap(p.y - d.start.y);
      if (dx || dy) d.moved = true;
      const cc: Circuit = { ...c, elements: c.elements.map((e) => (e.id === d.orig!.id ? { ...e, x: d.orig!.x + dx, y: d.orig!.y + dy } : e)) };
      doc.preview(cc);
    }
  };
  const onPointerUp = (ev: React.PointerEvent) => {
    const p = toWorld(ev);
    const sp = { x: snap(p.x), y: snap(p.y) };
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'move') {
      if (d.moved) doc.commit();
      return;
    }
    if (d?.mode === 'pan' && d.moved) return;
    if (tool.t === 'place') placeAt(tool.kind, sp);
    else if (tool.t === 'wire') {
      if (!wireStart) setWireStart(sp);
      else if (wireStart.x === sp.x && wireStart.y === sp.y) setWireStart(null);
      else {
        addWire(wireStart, sp);
        const k2 = key(sp);
        const hits = c.elements.some((e) => e.kind !== 'GND' && (key(pinsOf(e).a) === k2 || key(pinsOf(e).b) === k2)) || c.wires.some((w) => onSegment(sp, w.a, w.b));
        setWireStart(hits ? null : sp);
      }
    } else if (!d?.moved) setSel(null);
  };
  const onWheel = (ev: React.WheelEvent) => {
    const p = toWorld(ev);
    const f = ev.deltaY > 0 ? 1.12 : 1 / 1.12;
    zoomAt(p, f);
  };
  const zoomAt = (p: Pt, f: number) => {
    setView((v) => {
      const w = Math.min(4000, Math.max(160, v.w * f));
      const k = w / v.w;
      const px = p.x * U;
      const py = p.y * U;
      return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, w, h: v.h * k };
    });
  };

  const startMove = (ev: React.PointerEvent, e: CElement) => {
    if ((tool.t === 'place' || tool.t === 'wire') && props.pick?.kind !== 'element') return;
    ev.stopPropagation();
    if (props.pick?.kind === 'element') {
      handlePick(e.id);
      return;
    }
    if (tool.t === 'wire') {
      // permitir iniciar cables desde terminales
      return;
    }
    setSel({ el: e.id });
    const p = toWorld(ev);
    drag.current = { mode: 'move', start: p, orig: e, moved: false, pointerId: ev.pointerId };
    svgRef.current?.setPointerCapture?.(ev.pointerId);
  };

  // ------------- exportar -------------
  const exportSVG = () => {
    const s = serializeSVG(svgRef.current!, pal.bg);
    downloadText('circuito.svg', s, 'image/svg+xml');
  };
  const exportPNG = () => {
    const s = serializeSVG(svgRef.current!, pal.bg);
    const img = new Image();
    const svg = svgRef.current!;
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = svg.clientWidth * 2;
      cv.height = svg.clientHeight * 2;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'circuito.png';
        a.click();
      });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const loadJSON = (f: File) => {
    f.text().then((t) => {
      try {
        const cc = JSON.parse(t);
        if (!Array.isArray(cc.elements) || !Array.isArray(cc.wires)) throw new Error();
        doc.load(cc);
        setView(fitView(cc));
      } catch {
        alert('El archivo no es un circuito válido (JSON del simulador).');
      }
    });
  };
  const share = async () => {
    const url = doc.shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      alert('Enlace copiado al portapapeles. Quien lo abra verá este mismo circuito.');
    } catch {
      prompt('Copie este enlace:', url);
    }
  };

  // ------------- dibujo -------------
  const errIds = props.errorIds ?? new Set<string>();
  const hiIds = new Set(props.highlightIds ?? []);
  const vb = `${view.x} ${view.y} ${view.w} ${view.h}`;
  const gridLines = useMemo(() => {
    const out: ReactNode[] = [];
    const x0 = Math.floor(view.x / U) - 1;
    const x1 = Math.ceil((view.x + view.w) / U) + 1;
    const y0 = Math.floor(view.y / U) - 1;
    const y1 = Math.ceil((view.y + view.h) / U) + 1;
    if ((x1 - x0) * (y1 - y0) > 40000) return out;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(<circle key={`${x},${y}`} cx={x * U} cy={y * U} r={1.1} fill={pal.grid} />);
    return out;
  }, [view, pal.grid]);

  const elName = (id?: string) => c.elements.find((e) => e.id === id)?.label ?? '—';

  return (
    <div className="editor">
      <div className="palette no-print" aria-label="Paleta de componentes">
        <button className={tool.t === 'select' ? 'active' : ''} onClick={() => setTool({ t: 'select' })} title="Seleccionar y mover (Esc)">
          <svg viewBox="0 0 40 22">
            <path d="M14 3 L14 19 L18 15 L21 21 L24 20 L21 14 L26 14 Z" fill={pal.el} />
          </svg>
          Mover
        </button>
        <button className={tool.t === 'wire' ? 'active' : ''} onClick={() => { setTool({ t: 'wire' }); setWireStart(null); }} title="Cable: toque un punto y luego otro (W)">
          <svg viewBox="0 0 40 22">
            <path d="M4 18 L20 18 L20 4 L36 4" stroke={pal.wire} strokeWidth={2} fill="none" />
            <circle cx={4} cy={18} r={2.5} fill={pal.node} />
            <circle cx={36} cy={4} r={2.5} fill={pal.node} />
          </svg>
          Cable
        </button>
        {palette.map((k) => (
          <button
            key={k}
            className={tool.t === 'place' && tool.kind === k ? 'active' : ''}
            onClick={() => setTool({ t: 'place', kind: k })}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', k);
              setTool({ t: 'place', kind: k });
            }}
            title={`${KIND_INFO[k].name}: toque aquí y luego en el lienzo (o arrastre)`}
          >
            <PaletteIcon kind={k} color={pal.el} />
            {PALETTE_NAMES[k]}
          </button>
        ))}
        <button className={tool.t === 'name' ? 'active' : ''} onClick={() => setTool({ t: 'name' })} title="Nombrar un nodo: toque el nodo">
          <svg viewBox="0 0 40 22">
            <circle cx={20} cy={11} r={4} fill={pal.node} />
            <text x={26} y={9} fontSize={9} fill={pal.el}>
              a
            </text>
          </svg>
          Nombrar
        </button>
      </div>
      <div className="toolbar no-print">
        <button onClick={doc.undo} disabled={!doc.canUndo} title="Deshacer (Ctrl+Z)">↶ Deshacer</button>
        <button onClick={doc.redo} disabled={!doc.canRedo} title="Rehacer (Ctrl+Y)">↷ Rehacer</button>
        <button onClick={rotate} disabled={!selectedEl || selectedEl.kind === 'GND'} title="Rotar (R)">⟳ Rotar</button>
        <button onClick={flip} disabled={!selectedEl || selectedEl.kind === 'GND'} title="Voltear: invierte la polaridad (F)">⇄ Voltear</button>
        <button onClick={duplicate} disabled={!selectedEl}>⧉ Duplicar</button>
        <button onClick={del} disabled={!sel?.el && !sel?.wire} title="Borrar (Supr)">🗑 Borrar</button>
        <button onClick={() => zoomAt({ x: (view.x + view.w / 2) / U, y: (view.y + view.h / 2) / U }, 1 / 1.25)}>＋</button>
        <button onClick={() => zoomAt({ x: (view.x + view.w / 2) / U, y: (view.y + view.h / 2) / U }, 1.25)}>－</button>
        <button onClick={() => setView(fitView(c))} title="Encuadrar el circuito">⤢ Encuadrar</button>
        <label className="row" style={{ gap: 3 }} title="Qué valores mostrar sobre el dibujo">
          valores
          <select value={valMode} onChange={(e) => setValMode(e.target.value as 'resumen' | 'completo' | 'ninguno')} aria-label="valores sobre el dibujo">
            <option value="resumen">I y P</option>
            <option value="completo">I, V y P</option>
            <option value="ninguno">ocultar</option>
          </select>
        </label>
        <details className="row" style={{ display: 'inline-block' }}>
          <summary style={{ fontWeight: 400, fontSize: 12.5 }}>Archivo ▾</summary>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <button onClick={() => downloadText('circuito.json', JSON.stringify(c, null, 1))}>💾 Guardar JSON</button>
            <button onClick={() => fileRef.current?.click()}>📂 Cargar JSON</button>
            <button onClick={exportPNG}>🖼 PNG</button>
            <button onClick={exportSVG}>✒ SVG</button>
            <button onClick={share}>🔗 Compartir enlace</button>
            <button onClick={clearAll}>✖ Borrar todo</button>
          </div>
        </details>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && loadJSON(e.target.files[0])} />
        {props.toolbarExtra}
      </div>
      {(
        <div className="hint no-print" role="status" style={{ minHeight: 36 }}>
          {props.pick
            ? `${props.pick.prompt} (${picked.length}/${props.pick.count})`
            : tool.t === 'wire'
              ? wireStart
                ? 'Toque el punto final. Si cae sobre un terminal o cable, el cable termina; si no, sigue desde ese punto (toque el mismo punto o Esc para terminar).'
                : 'Toque el punto de inicio del cable (un terminal o un punto de la grilla).'
              : tool.t === 'place'
                ? `Toque en el lienzo para colocar: ${KIND_INFO[tool.kind].name}.`
                : tool.t === 'name'
                  ? 'Toque un nodo para ponerle nombre (a, b, c…).'
                  : 'Toque un componente de la paleta y luego el lienzo. Seleccione un elemento para editar su valor.'}
        </div>
      )}
      <div
        className="canvas-wrap"
        style={props.height ? { height: props.height } : undefined}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const k = e.dataTransfer.getData('text/plain') as Kind;
          if (k && KIND_INFO[k]) placeAt(k, toWorld(e));
        }}
      >
        <svg ref={svgRef} viewBox={vb} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)} onWheel={onWheel} role="img" aria-label="Lienzo del circuito">
          <rect className="hit" x={view.x} y={view.y} width={view.w} height={view.h} fill={pal.bg} />
          <g className="hit">{gridLines}</g>
          {/* cables */}
          {c.wires.map((w) => {
            const isSel = sel?.wire === w.id;
            return (
              <g key={w.id}>
                <line x1={w.a.x * U} y1={w.a.y * U} x2={w.b.x * U} y2={w.b.y * U} stroke={isSel ? pal.sel : pal.wire} strokeWidth={2} strokeLinecap="round" />
                <line
                  className="hit"
                  x1={w.a.x * U}
                  y1={w.a.y * U}
                  x2={w.b.x * U}
                  y2={w.b.y * U}
                  stroke="transparent"
                  strokeWidth={12}
                  onPointerDown={(ev) => {
                    if (tool.t === 'select') {
                      ev.stopPropagation();
                      setSel({ wire: w.id });
                    }
                  }}
                />
              </g>
            );
          })}
          {/* elementos */}
          {c.elements.map((e) => (
            <ElementView
              key={e.id}
              e={e}
              pal={pal}
              selected={sel?.el === e.id || picked.includes(e.id)}
              error={errIds.has(e.id)}
              highlight={hiIds.has(e.id)}
              res={showVals ? values?.get(e.id) ?? null : null}
              compact={valMode === 'resumen'}
              ctrlLabel={isDependent(e.kind) ? elName(e.ctrlRef) : undefined}
              showSwitchBefore={props.showSwitchBefore}
              onPointerDown={(ev) => startMove(ev, e)}
            />
          ))}
          {/* nodos */}
          {junctions.map((p) => (
            <circle key={key(p)} cx={p.x * U} cy={p.y * U} r={4} fill={pal.node} />
          ))}
          {net &&
            [...nodeLabelPos.entries()].map(([n, p]) => {
              const isErr = props.errorNodes?.includes(n);
              const isHi = props.highlightNodes?.includes(n) || (props.pick?.kind === 'node' && picked.includes(n)) || sel?.node === n;
              const v = nodeV?.[n];
              const name = net.nodeNames[n];
              return (
                <g
                  key={`n${n}`}
                  onPointerDown={(ev) => {
                    // al colocar un componente o un cable, el toque sobre el nodo cuenta como toque en la grilla
                    if ((tool.t === 'place' || tool.t === 'wire') && props.pick?.kind !== 'node') return;
                    ev.stopPropagation();
                    if (props.pick?.kind === 'node') handlePick(n);
                    else if (tool.t === 'name') {
                      const nm = prompt(`Nombre del nodo (actual: ${name}). Deje vacío para numeración automática:`, name === String(n) ? '' : name);
                      if (nm !== null)
                        update((cc) => {
                          cc.nodeNames = (cc.nodeNames ?? []).filter((x) => nodeAt.get(key(x)) !== n);
                          if (nm.trim()) cc.nodeNames.push({ x: p.x, y: p.y, name: nm.trim() });
                          return cc;
                        });
                      setTool({ t: 'select' });
                    } else if (tool.t === 'select') setSel({ node: n });
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={p.x * U} cy={p.y * U} r={props.pick?.kind === 'node' ? 15 : 6} fill={isErr ? pal.err : isHi ? pal.sel : 'transparent'} stroke={isErr ? pal.err : isHi ? pal.sel : pal.node} strokeWidth={1.5} opacity={0.85} />
                  <text x={p.x * U + 6} y={p.y * U - 8} fontSize={11.5} fill={isErr ? pal.err : pal.node} fontWeight={600}>
                    {n === 0 ? '⏚ ref' : `(${name})`}
                    {showVals && v !== undefined && n !== 0 ? ` ${fmtEng(v, 'V', 4)}` : ''}
                  </text>
                </g>
              );
            })}
          {/* mallas */}
          {props.showMeshes &&
            analysis?.topo.meshes.map((m) => {
              const cx = m.center.x * U;
              const cy = m.center.y * U;
              const hi = props.highlightMesh === m.index || (props.pick?.kind === 'mesh' && picked.includes(m.index));
              return (
                <g key={`m${m.index}`} onPointerDown={(ev) => { if (props.pick?.kind === 'mesh') { ev.stopPropagation(); handlePick(m.index); } }} style={{ cursor: props.pick?.kind === 'mesh' ? 'pointer' : 'default' }}>
                  <path d={`M ${cx - 14} ${cy - 6} A 16 16 0 1 1 ${cx - 6} ${cy + 14}`} fill="none" stroke={hi ? pal.sel : pal.mesh} strokeWidth={hi ? 3 : 2} />
                  <path d={`M ${cx - 6} ${cy + 14} l -1 -8 m 1 8 l -8 -1`} stroke={hi ? pal.sel : pal.mesh} strokeWidth={2} fill="none" />
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={hi ? pal.sel : pal.mesh}>
                    I{toSub(m.index)}
                  </text>
                  {props.pick?.kind === 'mesh' && <circle cx={cx} cy={cy} r={22} fill="transparent" />}
                </g>
              );
            })}
          {/* vista previa */}
          {hover && tool.t === 'place' && (
            <g opacity={0.45} pointerEvents="none">
              <ElementView e={{ id: 'ghost', kind: tool.kind, label: '', value: '', x: hover.x, y: hover.y, rot: tool.kind === 'V' || tool.kind === 'VCVS' || tool.kind === 'CCVS' ? 1 : tool.kind === 'I' || tool.kind === 'VCCS' || tool.kind === 'CCCS' ? 3 : 0 }} pal={pal} res={null} />
            </g>
          )}
          {hover && tool.t === 'wire' && wireStart && (
            <path d={`M ${wireStart.x * U} ${wireStart.y * U} L ${hover.x * U} ${wireStart.y * U} L ${hover.x * U} ${hover.y * U}`} stroke={pal.accent} strokeDasharray="4 3" fill="none" strokeWidth={2} pointerEvents="none" />
          )}
          {hover && tool.t === 'wire' && <circle cx={hover.x * U} cy={hover.y * U} r={4} fill="none" stroke={pal.accent} pointerEvents="none" />}
        </svg>
      </div>
      {selectedEl && <PropsEditor e={selectedEl} c={c} onChange={(ne) => update((cc) => ({ ...cc, elements: cc.elements.map((x) => (x.id === ne.id ? ne : x)) }))} />}
    </div>
  );
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
export const toSub = (n: number) => String(n).split('').map((d) => SUBS[Number(d)] ?? d).join('');

export function fitView(c: Circuit) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of c.elements) {
    const { a, b } = pinsOf(e);
    xs.push(a.x, b.x);
    ys.push(a.y, b.y);
  }
  for (const w of c.wires) {
    xs.push(w.a.x, w.b.x);
    ys.push(w.a.y, w.b.y);
  }
  if (!xs.length) return { x: -2 * U, y: -6 * U, w: 30 * U, h: 18 * U };
  const minX = Math.min(...xs) - 6;
  const maxX = Math.max(...xs) + 4;
  const minY = Math.min(...ys) - 3;
  const maxY = Math.max(...ys) + 3;
  let w = (maxX - minX) * U;
  let h = (maxY - minY) * U;
  // proporción aproximada del lienzo
  const ratio = 1.45;
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  const cx = ((minX + maxX) / 2) * U;
  const cy = ((minY + maxY) / 2) * U;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function serializeSVG(svg: SVGSVGElement, bg: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('.hit').forEach((n) => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(svg.clientWidth));
  clone.setAttribute('height', String(svg.clientHeight));
  const vb = svg.getAttribute('viewBox')!.split(' ').map(Number);
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('x', String(vb[0]));
  r.setAttribute('y', String(vb[1]));
  r.setAttribute('width', String(vb[2]));
  r.setAttribute('height', String(vb[3]));
  r.setAttribute('fill', bg);
  clone.insertBefore(r, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

// ---------------- vista de un elemento ----------------
export function ElementView({ e, pal, selected, error, highlight, res, ctrlLabel, showSwitchBefore, onPointerDown, compact = true }: { e: CElement; pal: ReturnType<typeof usePalette>; selected?: boolean; error?: boolean; highlight?: boolean; res: ElementResult | null; ctrlLabel?: string; showSwitchBefore?: boolean; onPointerDown?: (ev: React.PointerEvent) => void; compact?: boolean }) {
  const color = error ? pal.err : selected ? pal.sel : highlight ? pal.accent : pal.el;
  if (e.kind === 'GND') {
    return (
      <g transform={`translate(${e.x * U},${e.y * U})`} onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <SymbolShape kind="GND" color={color} />
        <rect className="hit" x={-14} y={-4} width={28} height={28} fill="transparent" />
      </g>
    );
  }
  const { a, b } = pinsOf(e);
  // dibujar desde el pin físico (x,y) con la rotación; el volteo invierte qué extremo es a
  const ang = e.rot * 90;
  const tx = e.x * U;
  const ty = e.y * U;
  const flipped = !!e.flip;
  // coordenadas absolutas de un punto local (lx a lo largo, ly perpendicular)
  const d = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ][e.rot];
  const at = (lx: number, ly: number) => ({ x: tx + d[0] * lx - d[1] * ly, y: ty + d[1] * lx + d[0] * ly });
  const closedShown = e.kind === 'SW' ? (showSwitchBefore ? (e.swMode ?? 'close') === 'open' : (e.swMode ?? 'close') === 'close') : false;
  // polaridad: a es + ; si está volteado, a está en el extremo lejano
  const plusL = flipped ? 66 : 14;
  const minusL = flipped ? 14 : 66;
  const vertical = e.rot % 2 === 1;
  const lab = vertical ? { x: at(40, 0).x + 24, y: at(40, 0).y - 2 } : at(40, -22);
  const valTxt = valueText(e, ctrlLabel);
  const showPol = e.kind === 'V' || e.kind === 'VCVS' || e.kind === 'CCVS' || e.kind === 'VM' || e.kind === 'AM';
  // flecha de fuente de corriente según volteo: la forma dibuja a→b local (0→80); si está volteado, invertimos
  const arrowFlip = flipped && (e.kind === 'I' || e.kind === 'VCCS' || e.kind === 'CCCS');
  const i = res?.i ?? 0;
  const absI = Math.abs(i);
  const flowDur = absI > 1e-12 ? Math.max(0.35, Math.min(6, 2.2 - Math.log10(absI + 1e-9) * 0.6)) : 0;
  // dirección del flujo en coordenadas absolutas: de a a b si i > 0
  const from = i >= 0 ? a : b;
  const to = i >= 0 ? b : a;
  const off = vertical ? { x: -11, y: 0 } : { x: 0, y: 13 };
  const mid = at(40, 0);
  const p = res?.p ?? 0;
  const absorbs = p > 1e-12;
  // signo + del elemento pasivo donde entra la corriente
  const passivePlus = res && (e.kind === 'R' || e.kind === 'G' || e.kind === 'L' || e.kind === 'C') && absI > 1e-12 ? (i >= 0 ? a : b) : null;
  const passiveMinus = passivePlus ? (passivePlus === a ? b : a) : null;
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
      <g transform={`translate(${tx},${ty}) rotate(${ang})`}>
        {arrowFlip ? (
          <g transform="translate(80,0) scale(-1,1)">
            <SymbolShape kind={e.kind} color={color} swMode={e.swMode} closed={closedShown} upright={-ang} />
          </g>
        ) : (
          <SymbolShape kind={e.kind} color={color} swMode={e.swMode} closed={closedShown} upright={-ang} />
        )}
        <rect className="hit" x={-2} y={-18} width={LEN + 4} height={36} fill="transparent" />
      </g>
      {showPol && (
        <>
          <text {...xy(at(e.kind === 'V' ? (flipped ? 49 : 31) : plusL, e.kind === 'V' ? 4 : -9))} fontSize={13} fontWeight={700} fill={color} textAnchor="middle">
            +
          </text>
          <text {...xy(at(e.kind === 'V' ? (flipped ? 31 : 49) : minusL, e.kind === 'V' ? 4 : -9))} fontSize={14} fontWeight={700} fill={color} textAnchor="middle">
            −
          </text>
        </>
      )}
      {passivePlus && (
        <>
          <text {...xy(towards(passivePlus, passiveMinus!, 10, off, -1))} fontSize={12} fill={pal.muted} textAnchor="middle">
            +
          </text>
          <text {...xy(towards(passiveMinus!, passivePlus, 10, off, -1))} fontSize={13} fill={pal.muted} textAnchor="middle">
            −
          </text>
        </>
      )}
      <text pointerEvents="none" x={lab.x} y={lab.y} fontSize={11.5} fill={color} textAnchor={vertical ? 'start' : 'middle'} fontWeight={600}>
        {e.label}
        {e.varName ? ` (${e.varName})` : ''}
      </text>
      {valTxt && (
        <text pointerEvents="none" x={lab.x} y={lab.y + (vertical ? 0 : -12)} dy={vertical ? 13 : 0} fontSize={11} fill={pal.muted} textAnchor={vertical ? 'start' : 'middle'}>
          {valTxt}
        </text>
      )}
      {res && (e.kind === 'AM' || e.kind === 'VM') && (
        <text {...(vertical ? { x: mid.x - 18, y: mid.y + 4 } : xy(at(40, 30)))} fontSize={11.5} fontWeight={700} textAnchor={vertical ? 'end' : 'middle'} fill={pal.accent} pointerEvents="none">
          {e.kind === 'AM' ? fmtEng(res.i, 'A', 4) : fmtEng(res.v, 'V', 4)}
        </text>
      )}
      {res && e.kind !== 'AM' && e.kind !== 'VM' && (
        <g pointerEvents="none">
          {absI > 1e-12 && (
            <>
              <line x1={from.x * U + off.x} y1={from.y * U + off.y} x2={to.x * U + off.x} y2={to.y * U + off.y} stroke={pal.flow} strokeWidth={2} strokeDasharray="6 6" className="flow" style={{ animationDuration: `${flowDur}s` }} />
              <path d={arrowHead(from, to, off)} fill={pal.flow} />
            </>
          )}
          <text {...(vertical ? { x: mid.x - 18, y: mid.y - 2 } : xy(at(40, 30)))} fontSize={10.5} textAnchor={vertical ? 'end' : 'middle'} fill={absorbs ? pal.abs : p < -1e-12 ? pal.ent : pal.muted}>
            {compact ? `${fmtEng(Math.abs(i), 'A', 3)} · ${Math.abs(p) > 1e-12 ? `${fmtEng(Math.abs(p), 'W', 3)} ${absorbs ? 'abs.' : 'ent.'}` : '0 W'}` : `${fmtEng(Math.abs(i), 'A', 3)} · ${fmtEng(Math.abs(res.v), 'V', 3)}`}
          </text>
          {!compact && <text {...(vertical ? { x: mid.x - 18, y: mid.y + 11 } : xy(at(40, 42)))} fontSize={10.5} textAnchor={vertical ? 'end' : 'middle'} fill={absorbs ? pal.abs : p < -1e-12 ? pal.ent : pal.muted}>
            {Math.abs(p) > 1e-12 ? `${fmtEng(Math.abs(p), 'W', 3)} ${absorbs ? 'absorbe' : 'entrega'}` : '0 W'}
          </text>}
        </g>
      )}
    </g>
  );
}

const xy = (p: Pt) => ({ x: p.x, y: p.y + 4 });
function towards(p: Pt, q: Pt, dist: number, off: Pt, side: number): Pt {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const L = Math.hypot(dx, dy) || 1;
  return { x: p.x * U + (dx / L) * dist + side * off.x * 0.9, y: p.y * U + (dy / L) * dist + side * off.y * 0.9 - 2 };
}
function arrowHead(from: Pt, to: Pt, off: Pt) {
  const mx = ((from.x + to.x) / 2) * U + off.x;
  const my = ((from.y + to.y) / 2) * U + off.y;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const s = 7;
  return `M ${mx + ux * s} ${my + uy * s} L ${mx - ux * s - uy * s * 0.7} ${my - uy * s + ux * s * 0.7} L ${mx - ux * s + uy * s * 0.7} ${my - uy * s - ux * s * 0.7} Z`;
}

function valueText(e: CElement, ctrlLabel?: string): string {
  const info = KIND_INFO[e.kind];
  switch (e.kind) {
    case 'AM':
    case 'VM':
      return '';
    case 'SW':
      return `t = ${e.t0 || '0'} s ${e.swMode === 'open' ? '(abre)' : '(cierra)'}`;
    case 'VCVS':
      return `${e.value}·V(${ctrlLabel})`;
    case 'VCCS':
      return `${e.value}·V(${ctrlLabel})`;
    case 'CCVS':
      return `${e.value}·I(${ctrlLabel})`;
    case 'CCCS':
      return `${e.value}·I(${ctrlLabel})`;
    default:
      return `${e.value} ${info.unit}`;
  }
}

// ---------------- panel de propiedades ----------------
function PropsEditor({ e, c, onChange }: { e: CElement; c: Circuit; onChange: (e: CElement) => void }) {
  const info = KIND_INFO[e.kind];
  const [local, setLocal] = useState(e);
  useEffect(() => setLocal(e), [e]);
  const commit = (ne: CElement) => {
    setLocal(ne);
    onChange(ne);
  };
  if (e.kind === 'GND') return <div className="card small">Tierra (referencia, 0 V). Todos los símbolos de tierra son el mismo nodo.</div>;
  const others = c.elements.filter((x) => x.id !== e.id && x.kind !== 'GND');
  return (
    <div className="card props" aria-label="Propiedades del elemento">
      <label>Tipo</label>
      <span className="small">{info.name}</span>
      <label>Etiqueta</label>
      <input value={local.label} onChange={(ev) => setLocal({ ...local, label: ev.target.value })} onBlur={() => local.label.trim() && commit({ ...local, label: local.label.trim() })} />
      {info.valueLabel && e.kind !== 'SW' && (
        <>
          <label>{info.valueLabel} {info.unit && `[${info.unit}]`}</label>
          <ValueInput value={local.value} unit={info.unit} onCommit={(v) => commit({ ...local, value: v })} />
        </>
      )}
      {isDependent(e.kind) && (
        <>
          <label>Controlada por</label>
          <select value={local.ctrlRef ?? ''} onChange={(ev) => commit({ ...local, ctrlRef: ev.target.value || undefined })}>
            <option value="">— elegir —</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {isVoltageControlled(e.kind) ? `voltaje de ${o.label} (+ en su terminal a)` : `corriente de ${o.label} (de a → b)`}
              </option>
            ))}
          </select>
        </>
      )}
      {e.kind === 'SW' && (
        <>
          <label>Acción en t₀</label>
          <select value={local.swMode ?? 'close'} onChange={(ev) => commit({ ...local, swMode: ev.target.value as 'open' | 'close' })}>
            <option value="close">se cierra (normalmente abierto)</option>
            <option value="open">se abre (normalmente cerrado)</option>
          </select>
          <label>t₀ [s]</label>
          <ValueInput value={local.t0 ?? '0'} unit="s" onCommit={(v) => commit({ ...local, t0: v })} />
        </>
      )}
      {(e.kind === 'L' || e.kind === 'C') && (
        <>
          <label>Condición inicial</label>
          <select value={local.icMode ?? 'dc'} onChange={(ev) => commit({ ...local, icMode: ev.target.value as 'dc' | 'given' })}>
            <option value="dc">régimen permanente antes de t₀</option>
            <option value="given">dada: {e.kind === 'L' ? 'i(t₀)' : 'v(t₀)'}</option>
          </select>
          {local.icMode === 'given' && (
            <>
              <label>{e.kind === 'L' ? 'i(t₀) [A]' : 'v(t₀) [V]'}</label>
              <ValueInput value={local.ic ?? '0'} unit={e.kind === 'L' ? 'A' : 'V'} onCommit={(v) => commit({ ...local, ic: v })} />
            </>
          )}
        </>
      )}
      <label title="Nombre de la variable de este elemento, p. ej. Iₓ o V_Δ">Variable (opcional)</label>
      <input value={local.varName ?? ''} placeholder="Iₓ, V_Δ, Vo…" onChange={(ev) => setLocal({ ...local, varName: ev.target.value })} onBlur={() => commit({ ...local, varName: local.varName?.trim() || undefined })} />
      <span />
      <span className="hint">Polaridad: el terminal a es «+» (para fuentes de corriente la flecha va de a → b). Use «Voltear» para invertirla.</span>
    </div>
  );
}

function ValueInput({ value, unit, onCommit }: { value: string; unit?: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onCommit(e.target.value);
      }}
      inputMode="decimal"
      aria-label={`valor ${unit ?? ''}`}
    />
  );
}
