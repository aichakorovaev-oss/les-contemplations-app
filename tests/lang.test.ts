// `npx tsx tests/lang.test.ts`
import assert from 'node:assert/strict';
import { languageMismatch } from '../src/shared/lang.ts';

const FR = "Respire doucement devant cette œuvre et laisse venir ce que tu ressens, sans te presser. Le ciel est avec toi.";
const EN = 'Breathe slowly in front of this work and let whatever you feel come to you, without rushing. The sky is with you.';

assert.equal(languageMismatch(FR, 'en'), true);   // méditation française alors que le visiteur est en anglais
assert.equal(languageMismatch(EN, 'fr'), true);
assert.equal(languageMismatch(EN, 'en'), false);
assert.equal(languageMismatch(FR, 'fr'), false);
assert.equal(languageMismatch('Le Déjeuner des canotiers', 'en'), false); // titre d'œuvre : trop court
assert.equal(languageMismatch('A quiet river, the sky and the boats of the harbour', 'en'), false);
assert.equal(languageMismatch('', 'en'), false);
assert.equal(languageMismatch(undefined, 'fr'), false);
console.log('lang : OK');
