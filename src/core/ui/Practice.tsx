import React, { ReactNode, useMemo, useState } from 'react';
import { analyze } from '../engine/analyze';
import { mulberry32, Rng } from '../engine/generate';
import { Circuit } from '../engine/types';
import { parseSI, fmtEng, fmtNum } from '../engine/units';
import { Tex, TexText, useLocal } from './basic';
import { CircuitPreview } from './CircuitPreview';
import { Block, Blocks } from './panels';

export type Level = 'basico' | 'intermedio' | 'examen';
export const LEVEL_NAMES: Record<Level, string> = { basico: 'Básico', intermedio: 'Intermedio', examen: 'Examen' };

export interface Answer {
  /** nombre en LaTeX */
  label: string;
  value: number;
  unit: string;
  /** tolerancia relativa (por defecto 1 %) */
  tol?: number;
}
export interface Exercise {
  prompt: string;
  circuit?: Circuit;
  extra?: ReactNode;
  answers: Answer[];
  hints: string[];
  solution: Block[];
}
export interface ExerciseGen {
  id: string;
  subtopic: string;
  gen: (rng: Rng, level: Level) => Exercise;
}

export function PracticeView({ gens, storageKey }: { gens: ExerciseGen[]; storageKey: string }) {
  const [gid, setGid] = useState(gens[0].id);
  const [level, setLevel] = useState<Level>('basico');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [progress, setProgress] = useLocal<Record<string, { tries: number; ok: number }>>(`progreso-${storageKey}`, {});
  const gen = gens.find((g) => g.id === gid) ?? gens[0];
  const ex = useMemo(() => {
    try {
      const rng = mulberry32(seed);
      for (let k = 0; k < 30; k++) {
        const ex = gen.gen(rng, level);
        if (ex.answers.every((a) => isFinite(a.value))) return ex;
      }
      return gen.gen(rng, level);
    } catch (e) {
      return { prompt: 'No se pudo generar el ejercicio, pruebe con «Nuevo ejercicio».', answers: [], hints: [], solution: [] } as Exercise;
    }
  }, [gen, level, seed]);
  // el generador garantiza circuitos válidos; se verifica de nuevo aquí
  const valid = useMemo(() => (ex.circuit ? analyze(ex.circuit).ok : true), [ex]);
  const [inputs, setInputs] = useState<string[]>([]);
  const [checked, setChecked] = useState<(boolean | 'mal')[] | null>(null);
  const [hints, setHints] = useState(0);
  const [showSol, setShowSol] = useState(false);
  const reset = () => {
    setInputs([]);
    setChecked(null);
    setHints(0);
    setShowSol(false);
  };
  const check = () => {
    const res = ex.answers.map((a, i) => {
      const r = parseSI(inputs[i] ?? '');
      if (!r.ok) return 'mal' as const;
      const tol = a.tol ?? 0.01;
      return Math.abs(r.value! - a.value) <= tol * Math.max(Math.abs(a.value), 1e-12) + 1e-12;
    });
    setChecked(res);
    const all = res.every((x) => x === true);
    setProgress((p) => {
      const cur = p[gid] ?? { tries: 0, ok: 0 };
      return { ...p, [gid]: { tries: cur.tries + 1, ok: cur.ok + (all ? 1 : 0) } };
    });
  };
  const subtopics = [...new Set(gens.map((g) => g.subtopic))];
  return (
    <div className="col">
      <div className="row">
        <label className="row">
          Subtema:
          <select value={gid} onChange={(e) => { setGid(e.target.value); reset(); }}>
            {subtopics.map((s) => (
              <optgroup key={s} label={s}>
                {gens.filter((g) => g.subtopic === s).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="row">
          Dificultad:
          <select value={level} onChange={(e) => { setLevel(e.target.value as Level); reset(); }}>
            {(Object.keys(LEVEL_NAMES) as Level[]).map((l) => (
              <option key={l} value={l}>
                {LEVEL_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={() => { setSeed(Math.floor(Math.random() * 1e9)); reset(); }}>
          🎲 Nuevo ejercicio
        </button>
      </div>
      <div className="card">
        <p>
          <TexText text={ex.prompt} />
        </p>
        {ex.circuit && valid && <CircuitPreview circuit={ex.circuit} height={240} />}
        {ex.extra}
      </div>
      {ex.answers.map((a, i) => (
        <div key={i} className="row">
          <Tex tex={`${a.label} =`} />
          <input value={inputs[i] ?? ''} onChange={(e) => setInputs((v) => { const n = v.slice(); n[i] = e.target.value; return n; })} style={{ width: 130 }} inputMode="decimal" aria-label={`respuesta ${i + 1}`} />
          <span className="muted">[{a.unit}]</span>
          {checked && (checked[i] === true ? <span className="badge ok">✓ correcto</span> : checked[i] === 'mal' ? <span className="badge err">✗ valor mal escrito</span> : <span className="badge err">✗ revise el resultado</span>)}
        </div>
      ))}
      <div className="row">
        <button className="primary" onClick={check} disabled={!ex.answers.length}>
          Comprobar
        </button>
        <button onClick={() => setHints((h) => Math.min(ex.hints.length, h + 1))} disabled={hints >= ex.hints.length}>
          💡 Pista ({hints}/{ex.hints.length})
        </button>
        <button onClick={() => setShowSol((s) => !s)}>{showSol ? 'Ocultar' : 'Ver'} solución</button>
      </div>
      {hints > 0 && (
        <ol className="card box-info">
          {ex.hints.slice(0, hints).map((h, i) => (
            <li key={i}>
              <TexText text={h} />
            </li>
          ))}
        </ol>
      )}
      {showSol && (
        <div className="card">
          <Blocks blocks={ex.solution} />
          <p className="small muted">Respuestas: {ex.answers.map((a) => `${a.label.replace(/[\\{}]/g, '')} = ${/^[pnµmkMGT][A-ZΩa-z]/.test(a.unit) ? `${fmtNum(a.value, 6)} ${a.unit}` : fmtEng(a.value, a.unit, 5)}`).join(' · ')}</p>
        </div>
      )}
      <details>
        <summary>Mi progreso (guardado en este navegador)</summary>
        <table className="data">
          <tbody>
            {gens.map((g) => (
              <tr key={g.id}>
                <td>{g.id}</td>
                <td>{progress[g.id]?.ok ?? 0} correctos de {progress[g.id]?.tries ?? 0} intentos</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setProgress({})}>Reiniciar progreso</button>
      </details>
    </div>
  );
}

export interface LearnSection {
  title: string;
  body: ReactNode;
}
export function LearnView({ sections, glossary }: { sections: LearnSection[]; glossary?: { term: string; def: string }[] }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="col">
      <div className="tabs">
        {sections.map((s, i) => (
          <button key={i} className={open === i ? 'active' : ''} onClick={() => setOpen(i)}>
            {s.title}
          </button>
        ))}
        {glossary && (
          <button className={open === -1 ? 'active' : ''} onClick={() => setOpen(-1)}>
            Glosario
          </button>
        )}
      </div>
      {open >= 0 ? (
        <div>
          <h3>{sections[open].title}</h3>
          {sections[open].body}
          <div className="row" style={{ marginTop: 12 }}>
            <button disabled={open === 0} onClick={() => setOpen(open - 1)}>
              ◀ Anterior
            </button>
            <button disabled={open === sections.length - 1} onClick={() => setOpen(open + 1)}>
              Siguiente ▶
            </button>
          </div>
        </div>
      ) : (
        <dl>
          {glossary!.map((g) => (
            <React.Fragment key={g.term}>
              <dt>
                <b>{g.term}</b>
              </dt>
              <dd style={{ marginBottom: 6 }}>
                <TexText text={g.def} />
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
