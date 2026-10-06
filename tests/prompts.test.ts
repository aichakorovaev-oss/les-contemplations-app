// Tests de la normalisation des points d'annotation : `npx tsx tests/prompts.test.ts`
import assert from 'node:assert/strict';
import { normalizeAnnotationPoints } from '../src/shared/prompts.ts';

const run = (a: any) => normalizeAnnotationPoints({ points: [{ text: 'x', label: 'l', ...a }] })[0];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

// Cas du bug d'origine : un détail dans les 10 % du haut ne doit PAS finir en bas
let p = run({ point: [100, 150] });
near(p.y, 0.1); near(p.x, 0.15);
p = run({ point: [85, 40], cote: 'gauche' });
near(p.y, 0.085 < 0.02 ? 0.02 : 0.085); near(p.x, 0.04);

// Exemples du prompt
p = run({ point: [180, 500], cote: 'centre' });
near(p.x, 0.5); near(p.y, 0.18);
p = run({ point: [870, 800], cote: 'droite' });
near(p.x, 0.8); near(p.y, 0.87);

// box_2d = [ymin, xmin, ymax, xmax]
p = run({ box_2d: [100, 100, 300, 500] });
near(p.x, 0.3); near(p.y, 0.2);

// Échelle 0-1 (modèle peu obéissant)
p = run({ point: [0.2, 0.6], cote: 'droite' });
near(p.x, 0.6); near(p.y, 0.2);
p = run({ x: 0.3, y: 0.7 });
near(p.x, 0.3); near(p.y, 0.7);

// Recoupement avec « cote » : x contradictoire corrigé
p = run({ point: [500, 900], cote: 'gauche' });
near(p.x, 0.24);

// Bornes + filtrage + limite de 4
assert.equal(normalizeAnnotationPoints({ points: [{ point: [0, 1000], text: 'a' }] })[0].x, 0.98);
assert.equal(normalizeAnnotationPoints({ points: [{ point: [10, 10] }] }).length, 0); // sans texte
assert.equal(normalizeAnnotationPoints({ points: Array(7).fill({ point: [500, 500], text: 't' }) }).length, 4);
assert.deepEqual(normalizeAnnotationPoints(null), []);
console.log('normalizeAnnotationPoints : OK');
