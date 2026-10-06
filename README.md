<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a3df6415-930d-4d34-b550-993fe1de1e1e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## Configuration

Copier `.env.example` vers `.env.local`. Seule `GEMINI_API_KEY` est obligatoire.
Variables optionnelles : `GEMINI_MODEL` (curation + annotations), `TTS_MODEL`, `TTS_VOICE`, `TTS_VOICE_FR`, `TTS_VOICE_EN`, `TTS_STYLE`.

Production : `npm run build && npm start` (le build produit aussi `server.js`).
Tests : `npm test` (normalisation des points d'annotation) et `npm run lint` (TypeScript).

## Architecture des prompts

- `src/shared/prompts.ts` : les 3 prompts Gemini (sélection des œuvres, textes personnalisés, annotations « Guider mon regard »), le garde-fou de ton, et la normalisation des points `[y, x]`. Repris de la version mono-fichier d'origine.
- `server.ts` : `/api/curate` (2 appels : choix puis textes), `/api/annotate` (vision), `/tts` (narration), limitation de débit par IP.
- `server/tts.ts` : synthèse vocale via l'API Gemini TTS (WAV), avec cache mémoire.

## Smartphone et tablette

- Cadrage du tableau selon l'orientation (`computeFocusFit` dans `App.tsx`) : en portrait le tableau remplit ~80 % de la largeur et remonte au-dessus de la zone légende / annotations ; en paysage court il remplit ~80 % de la hauteur ; la rotation recadre automatiquement.
- Annotations (`GuidedAnnotations.tsx`) : bulles latérales quand il y a la place, sinon **une seule fiche en bas** avec pastilles numérotées sur le tableau et boutons précédent / suivant.
- Les tailles responsives se règlent en fin de `src/index.css` : ce CSS n'est pas dans une `@layer`, il prend donc le dessus sur les utilitaires Tailwind (`text-xl sm:text-2xl`…) posés dans le TSX.
- Vue zoom : pincement centré sur les doigts, double-tap, image bornée.
- Audio : un lecteur unique « déverrouillé » au premier toucher (nécessaire sur iOS / Android).

## Déploiement sur Render

1. Pousser le projet sur GitHub (le `.gitignore` exclut déjà `.env*`, `dist/` et `node_modules/`).
2. Render > **New > Blueprint** > choisir le dépôt : `render.yaml` crée le service.
3. Saisir `GEMINI_API_KEY` quand Render la demande.

Sans Blueprint : *Web Service*, Build `npm ci --include=dev && npm run build`, Start `npm start`, variable `NODE_VERSION=22`.

Plan gratuit : le service s'endort après 15 min sans visite (réveil ≈ 1 min), 750 h gratuites par mois et par espace de travail.
