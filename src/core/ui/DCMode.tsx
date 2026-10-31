import React, { ReactNode, useMemo, useState } from 'react';
import { analyze, Analysis } from '../engine/analyze';
import { SolveMethod } from '../engine/methods/symbolic';
import { Circuit, Kind } from '../engine/types';
import { betterWayDC, DCMethod, dcSolution, METHOD_NAMES } from '../solutions/dc';
import { ThreePanels, useLocal } from './basic';
import { CircuitEditor, EditorProps, PickMode } from './CircuitEditor';
import { BalancePanel, BetterDoc, BetterView, IssuesPanel, NeedsFix, ResultsTable, StepDoc, StepsView } from './panels';
import { CircuitDoc, useCircuitDoc } from './useCircuitDoc';

export interface Template {
  name: string;
  desc: string;
  circuit: Circuit;
  /** modo de herramienta sugerido al cargar */
  mode?: string;
}

export interface DCModeProps {
  storageKey: string;
  palette: Kind[];
  initial: Circuit;
  methods?: DCMethod[];
  defaultMethod?: DCMethod;
  /** contenido extra en la ventanilla 1 (debajo del editor) */
  p1Extra?: (a: Analysis, doc: CircuitDoc) => ReactNode;
  /** reemplaza el contenido de la ventanilla 2 */
  p2?: (a: Analysis, doc: CircuitDoc, method: DCMethod, sys: SolveMethod) => ReactNode;
  /** documento de solución personalizado */
  solution?: (a: Analysis, method: DCMethod, sys: SolveMethod) => StepDoc;
  better?: (a: Analysis) => BetterDoc;
  p3Extra?: (a: Analysis) => ReactNode;
  pick?: PickMode;
  editorProps?: Partial<EditorProps>;
  wantsMesh?: boolean;
  /** recibe el documento del circuito (para que el simulador cargue plantillas) */
  docRef?: (doc: CircuitDoc) => void;
  showResults?: boolean;
}

// plantillas pendientes de cargar (el modo puede montarse después de elegir la plantilla)
const pending = new Map<string, Circuit>();
export function sendTemplate(storageKey: string, c: Circuit, modeId?: string) {
  pending.set(storageKey, JSON.parse(JSON.stringify(c)));
  window.dispatchEvent(new CustomEvent('plantilla', { detail: { storageKey, modeId } }));
}
export function usePendingTemplate(storageKey: string, load: (c: Circuit) => void) {
  React.useEffect(() => {
    const check = () => {
      const c = pending.get(storageKey);
      if (c) {
        pending.delete(storageKey);
        load(c);
      }
    };
    check();
    window.addEventListener('plantilla', check);
    return () => window.removeEventListener('plantilla', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
}

export function DCMode(p: DCModeProps) {
  const doc = useCircuitDoc(p.storageKey, p.initial);
  p.docRef?.(doc);
  usePendingTemplate(p.storageKey, doc.load);
  const methods = p.methods ?? ['ramas', 'nodos', 'mallas'];
  const [method, setMethod] = useLocal<DCMethod>(`metodo-${p.storageKey}`, p.defaultMethod ?? methods[0]);
  const [sys, setSys] = useLocal<SolveMethod>(`sistema-${p.storageKey}`, 'gauss');
  const curMethod = methods.includes(method) ? method : methods[0];
  const a = useMemo(() => analyze(doc.circuit, { wantsMesh: curMethod === 'mallas' || p.wantsMesh }), [doc.circuit, curMethod, p.wantsMesh]);
  const errorIds = useMemo(() => new Set(a.issues.filter((i) => i.severity === 'error').flatMap((i) => i.elements)), [a]);
  const errorNodes = useMemo(() => a.issues.filter((i) => i.severity === 'error').flatMap((i) => i.nodes), [a]);
  const sol = useMemo(() => (a.ok ? (p.solution ?? dcSolution)(a, curMethod, sys) : null), [a, curMethod, sys, p.solution]);
  const better = useMemo(() => (a.ok ? (p.better ?? betterWayDC)(a) : null), [a, p.better]);
  const p1 = (
    <div className="col">
      <CircuitEditor doc={doc} palette={p.palette} analysis={a} errorIds={errorIds} errorNodes={errorNodes} pick={p.pick} showMeshes={curMethod === 'mallas'} {...p.editorProps} />
      {p.p1Extra?.(a, doc)}
      <h4 style={{ marginTop: 6 }}>Panel de errores</h4>
      <IssuesPanel issues={a.issues} />
      {a.ok && p.showResults !== false && (
        <>
          <h4>Simulación en vivo</h4>
          <ResultsTable results={a.dc!.el} V={a.dc!.V} nodeNames={a.net.nodeNames} />
          <BalancePanel a={a} />
        </>
      )}
    </div>
  );
  const p2 = !a.ok ? (
    <NeedsFix issues={a.issues} />
  ) : p.p2 ? (
    p.p2(a, doc, curMethod, sys)
  ) : (
    <div>
      <div className="row no-print" style={{ marginBottom: 6 }}>
        {methods.length > 1 && (
          <label className="row">
            Método:
            <select value={curMethod} onChange={(e) => setMethod(e.target.value as DCMethod)}>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_NAMES[m]}
                </option>
              ))}
            </select>
          </label>
        )}
        {curMethod !== 'reduccion' && <label className="row">
          Resolver el sistema por:
          <select value={sys} onChange={(e) => setSys(e.target.value as SolveMethod)}>
            <option value="gauss">Gauss</option>
            <option value="cramer">Cramer (determinantes)</option>
            <option value="sustitucion">Sustitución</option>
          </select>
        </label>}
      </div>
      {sol && <StepsView doc={sol} />}
    </div>
  );
  const p3 = !a.ok ? (
    <div className="muted">Cuando el circuito sea válido aquí verá la estrategia más corta para resolverlo.</div>
  ) : (
    <>
      {better && <BetterView doc={better} />}
      {p.p3Extra?.(a)}
    </>
  );
  return <ThreePanels p1={p1} p2={p2} p3={p3} />;
}

export function TemplatesList({ templates, onLoad }: { templates: Template[]; onLoad: (t: Template) => void }) {
  return (
    <div className="grid2">
      {templates.map((t, i) => (
        <div key={i} className="card">
          <b>{t.name}</b>
          <p className="small">{t.desc}</p>
          <button className="primary" onClick={() => onLoad(t)}>
            Cargar en la ventanilla 1
          </button>
        </div>
      ))}
    </div>
  );
}

/** Pequeño selector de pestañas para herramientas dentro de una ventanilla */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} className={value === it.id ? 'active' : ''} onClick={() => onChange(it.id)} role="tab" aria-selected={value === it.id}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function useStateReset<T>(init: T): [T, (v: T) => void] {
  const [v, setV] = useState(init);
  return [v, setV];
}
