import React from 'react';
import { Shell } from './core/ui/basic';
import { sendTemplate } from './core/ui/DCMode';
import { LearnView, PracticeView } from './core/ui/Practice';
import { CircuitPreview } from './core/ui/CircuitPreview';
import { FormulaMode, TransientMode } from './sim/modes';
import { GENS, GLOSSARY, LEARN, TEMPLATES } from './sim/content';

export default function App() {
  return (
    <Shell
      number={6}
      title="Respuesta Natural y a un Escalón de Circuitos RL y RC"
      modes={[
        { id: 'transitorio', title: 'Armar y simular (6.1–6.5)', render: () => <TransientMode /> },
        { id: 'formula', title: 'Calculadora RL / RC', render: () => <FormulaMode /> },
      ]}
      learn={<LearnView sections={LEARN} glossary={GLOSSARY} />}
      practice={<PracticeView gens={GENS} storageKey="sim6" />}
      templates={() => (
        <div className="grid2">
          {TEMPLATES.map((t, i) => (
            <div key={i} className="card">
              <b>{t.name}</b>
              <p className="small">{t.desc}</p>
              <CircuitPreview circuit={t.circuit()} height={150} showNodes={false} />
              <button className="primary" onClick={() => sendTemplate('u6-transitorio', t.circuit(), 'transitorio')}>
                Cargar en la ventanilla 1
              </button>
            </div>
          ))}
        </div>
      )}
    />
  );
}
