import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { Lang, Painting, RoomKey, TweakSettings, ParcoursResult } from './types/gallery';
import { getLocalizedCatalogue, assignSlots } from './data/catalogue';
import { t, ROOM_NAMES } from './i18n/strings';
import { buildGallery, populatePaintings, GalleryBuildResult } from './three/builder';
import { FirstPersonRig } from './three/controls';
import { galleryAudio } from './services/audio';
import { fetchImageUrl } from './services/imageResolver';
import { buildMoodParcours, fetchAnnotations, fetchTexts } from './services/gemini';
import {
  speakEdgeTTS,
  stopNarration,
  buildNarrationText,
  haltSpeech,
  prefetchNarration,
  unlockAudio,
} from './services/tts';

// Components
import { DigitalLandscape } from './components/DigitalLandscape';
import { LanguageSwitch } from './components/LanguageSwitch';
import { LandingStage } from './components/LandingStage';
import { LoadingScreen } from './components/LoadingScreen';
import { StartScreen } from './components/StartScreen';
import { GalleryHUD } from './components/GalleryHUD';
import { FocusOverlay } from './components/FocusOverlay';
import { GuidedAnnotations } from './components/GuidedAnnotations';
import { DetailZoomView } from './components/DetailZoomView';
import { TweaksPanel } from './components/TweaksPanel';
import {
  HomeConfirmModal,
  CrisisModal,
  NudityGateModal,
  ReportModal,
  FeedbackModal,
} from './components/SafetyModals';

// Safety distress detection regex patterns
const CRISIS_PATTERNS = [
  /\bje\s+(veux|voudrais|vais)\s+(me\s+)?(suicider|tuer|mourir)\b/,
  /\benvie\s+de\s+(mourir|me\s+tuer)\b/,
  /\ben\s+finir\s+avec\s+(la\s+vie|tout|ma\s+vie)\b/,
  /\bje\s+vais\s+en\s+finir\b/,
  /\bje\s+ne\s+veux\s+plus\s+vivre\b/,
  /\bplus\s+(du\s+tout\s+)?envie\s+de\s+vivre\b/,
  /\bje\s+veux\s+disparaitre\b/,
  /\bmettre\s+fin\s+a\s+(mes\s+jours|ma\s+vie)\b/,
  /\bme\s+faire\s+du\s+mal\b/,
  /\bme\s+scarifier\b/,
  /\bme\s+tuer\b/,
  /\bpersonne\s+ne\s+me\s+manquerait\b/,
  /\bje\s+ne\s+vois\s+plus\s+d.?issue\b/,
  /\bplus\s+la\s+force\s+de\s+continuer\b/,
  /\bi\s+want\s+to\s+(kill\s+myself|die)\b/,
  /\bi\s+wanna\s+(kill\s+myself|die)\b/,
  /\bi.?m\s+going\s+to\s+kill\s+myself\b/,
  /\bkill\s+myself\b/,
  /\bend\s+my\s+life\b/,
  /\bself[\s-]?harm\b/,
  /\bdon.?t\s+want\s+to\s+live\b/,
  /\bwant\s+to\s+die\b/,
  /\bno\s+reason\s+to\s+live\b/,
  /\bmourir\b/,
  /\bsuicide[rs]?\b/,
  /\bsuicidaire\b/,
  /\bsuicidal\b/,
];

function detectCrisisSignal(text: string): boolean {
  const n = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!n) return false;
  return CRISIS_PATTERNS.some(re => re.test(n));
}

/**
 * Distance caméra + décalage du point visé pour cadrer un tableau.
 * - Écran large : comportement d'origine (le tableau occupe ~43 % de la hauteur).
 * - Portrait (téléphone / tablette) : le tableau remplit ~88 % de la largeur et se place
 *   au-dessus de la zone basse réservée à la légende, à la navigation et aux annotations.
 * - Paysage court (téléphone couché) : le tableau remplit ~80 % de la hauteur, avec de la
 *   place de chaque côté pour les bulles d'annotation.
 */
export function computeFocusFit(pw: number, ph: number, vfov: number, hfov: number, W: number, H: number) {
  const tanV = Math.tan(vfov / 2);
  const tanH = Math.tan(hfov / 2);
  const aspect = W / H;
  let fillW: number, fillH: number, reserveTop = 0, reserveBottom = 0;

  if (aspect < 1) {
    reserveTop = Math.min(72, H * 0.09);
    reserveBottom = Math.min(190, H * 0.24);
    fillW = 0.8;
    fillH = Math.max(0.3, (H - reserveTop - reserveBottom) / H - 0.04);
  } else if (H < 520) {
    fillW = 0.62;
    fillH = 0.8;
  } else {
    // comportement d'origine : distance = hauteur/(2·tan) × 2.35
    const distH = ph / 2 / tanV;
    const distW = pw / 2 / tanH;
    return { dist: Math.max(distH, distW) * 2.35, lookDown: 0 };
  }

  const dist = Math.max(pw / (fillW * 2 * tanH), ph / (fillH * 2 * tanV));
  // décalage vertical (en pixels écran) → mètres à la distance du mur
  const shiftPx = (reserveBottom - reserveTop) / 2;
  const lookDown = (shiftPx / (H / 2)) * dist * tanV;
  return { dist, lookDown };
}

export default function App() {
  // Navigation screen
  const [screen, setScreen] = useState<'landing' | 'loading' | 'start' | 'gallery'>('landing');
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const s = localStorage.getItem('ml-lang');
      if (s === 'en' || s === 'fr') return s;
    } catch (_) {}
    return 'fr';
  });

  // Settings
  const [tweaks, setTweaks] = useState<TweakSettings>({
    lightingDrama: 3,
    walkSpeed: 3.0,
    fov: 70,
    audioVolume: 0.55,
    narration: true,
    lookSensitivity: 0.0022,
  });

  // Curation & State
  const [userMoodText, setUserMoodText] = useState('');
  const [currentMoodTags, setCurrentMoodTags] = useState<string[]>([]);
  const [parcoursResult, setParcoursResult] = useState<ParcoursResult | null>(null);
  const [paintings, setPaintings] = useState<Painting[]>([]);
  const [activePaintingIdx, setActivePaintingIdx] = useState<number>(-1);
  const [proximityPainting, setProximityPainting] = useState<Painting | null>(null);
  const [currentRoomKey, setCurrentRoomKey] = useState<RoomKey | null>(null);
  const [roomPaintingCounts, setRoomPaintingCounts] = useState<Record<RoomKey, number>>({
    peach: 0,
    blue: 0,
    green: 0,
    yellow: 0,
  });

  // Loading progress
  const [progressPct, setProgressPct] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingPreviewUrl, setLoadingPreviewUrl] = useState<string | undefined>();
  const [loadingPreviewTitle, setLoadingPreviewTitle] = useState<string | undefined>();

  // Overlays
  const [infoOpen, setInfoOpen] = useState(false);
  const [detailMode, setDetailMode] = useState(false);
  const [isGuiding, setIsGuiding] = useState(false);
  const [isGuideLoading, setIsGuideLoading] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [nudityConsent, setNudityConsent] = useState<boolean | null>(null);

  // Modals
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const [showCrisisModal, setShowCrisisModal] = useState(false);
  const [pendingActionAfterCrisis, setPendingActionAfterCrisis] = useState<(() => void) | null>(null);
  const [showNudityGate, setShowNudityGate] = useState(false);
  const [pendingConsentResolve, setPendingConsentResolve] = useState<((accepted: boolean) => void) | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showTweaks, setShowTweaks] = useState(false);
  const [roomNudgeText, setRoomNudgeText] = useState<string | null>(null);

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
  );
  const visitedPaintingIdsRef = useRef<Set<string>>(new Set());
  const roomGuidanceRef = useRef<{ roomKey: RoomKey | null; since: number; nudgedFor: RoomKey | null }>({
    roomKey: null,
    since: 0,
    nudgedFor: null,
  });

  // Three.js References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const rigRef = useRef<FirstPersonRig | null>(null);
  const builtRef = useRef<GalleryBuildResult | null>(null);
  const homePoseRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; yaw: number; pitch: number } | null>(null);
  const tweenGenRef = useRef(0);
  const savedCamRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; yaw: number; pitch: number } | null>(null);
  const detailImgRef = useRef<HTMLImageElement | null>(null);
  const [currentYaw, setCurrentYaw] = useState(0);

  // Mutable refs to prevent stale closure bugs in Three.js event loop
  const paintingsRef = useRef<Painting[]>([]);
  paintingsRef.current = paintings;
  const activePaintingIdxRef = useRef<number>(-1);
  activePaintingIdxRef.current = activePaintingIdx;
  const focusOnRef = useRef<((index: number, isInitial: boolean, refit?: boolean) => void) | null>(null);
  const nudityConsentRef = useRef<boolean | null>(null);
  nudityConsentRef.current = nudityConsent;
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  const moodTagsRef = useRef<string[]>([]);
  moodTagsRef.current = currentMoodTags;
  const moodTextRef = useRef('');
  moodTextRef.current = userMoodText;
  const langSwitchTokenRef = useRef(0);

  // Changement de langue : on retraduit le catalogue ET les textes générés par l'IA
  // (méditation, raison, anecdote, questions, annotations, accueil), sinon on mélange les langues.
  const handleSelectLang = useCallback((newLang: Lang) => {
    if (newLang === langRef.current) return;
    setLang(newLang);
    try {
      localStorage.setItem('ml-lang', newLang);
    } catch (_) {}
    document.title = t('title_doc', newLang);
    document.documentElement.lang = newLang;

    // Visite guidée / narration en cours dans l'ancienne langue : on les arrête
    setIsGuiding(false);
    haltSpeech();
    stopNarration(setIsNarrating);

    const localized = getLocalizedCatalogue(newLang);
    const hadAI = paintingsRef.current.some(
      p => p.meditation || p.raison || p.anecdote || (p.questions && p.questions.length > 0)
    );

    setPaintings(prev =>
      prev.map(p => {
        const found = localized.find(c => c.id === p.id);
        if (!found) return p;
        return {
          ...p,
          title: found.title,
          artist: found.artist,
          medium: found.medium,
          dimensions: found.dimensions,
          location: found.location,
          desc: found.desc,
          // Textes générés dans l'ancienne langue : retirés, puis régénérés ci-dessous
          ...(hadAI ? { meditation: '', raison: '', anecdote: '', questions: [] } : {}),
          annotations: undefined,
        };
      })
    );
    setParcoursResult(prev => (prev ? { ...prev, introText: t('fallback_intro', newLang) } : prev));

    if (hadAI) {
      const token = ++langSwitchTokenRef.current;
      fetchTexts(
        paintingsRef.current.map(p => p.id),
        moodTagsRef.current,
        moodTextRef.current,
        newLang
      ).then(texts => {
        // abandonné si le visiteur a rechangé de langue entre-temps
        if (!texts || token !== langSwitchTokenRef.current || langRef.current !== newLang) return;
        setPaintings(prev =>
          prev.map(p => {
            const x = texts[p.id];
            return x
              ? { ...p, meditation: x.meditation || p.desc, raison: x.raison, anecdote: x.anecdote, questions: x.questions }
              : p;
          })
        );
      });
    }
  }, []);


  // Update light dimming
  const applyDimming = useCallback((tval: number) => {
    if (!builtRef.current) return;
    const { hemi, amb, roomFills, wallLights } = builtRef.current;
    const drama = (tweaks.lightingDrama / 10) * 0.55;
    const k = 1 - tval * drama;
    hemi.intensity = 0.85 * k;
    amb.intensity = 0.25 * k;
    for (const key of Object.keys(roomFills)) {
      roomFills[key].intensity = 1.8 * k;
    }
    for (const w of wallLights) {
      if (
        activePaintingIdxRef.current >= 0 &&
        paintingsRef.current[activePaintingIdxRef.current] &&
        w.painting.id === paintingsRef.current[activePaintingIdxRef.current].id
      ) {
        continue;
      }
      w.spot.intensity = w.spot.userData.baseIntensity * (1 - tval * 0.4);
      (w.halo.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }, [tweaks.lightingDrama]);

  // Focus Camera onto a painting
  const focusOn = useCallback((index: number, isInitial: boolean, refit = false) => {
    const currentList = paintingsRef.current;
    if (index < 0 || index >= currentList.length || !cameraRef.current || !builtRef.current || !rigRef.current) return;
    const newP = currentList[index];
    const newMesh = builtRef.current.paintingObjects.find(m => m.userData.painting.id === newP.id);
    if (!newMesh) return;

    visitedPaintingIdsRef.current.add(newP.id);
    if (!refit) setActivePaintingIdx(index);
    setProximityPainting(null);

    // Compute target position
    const vfov = THREE.MathUtils.degToRad(cameraRef.current.fov);
    const aspect = cameraRef.current.aspect;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fit = computeFocusFit(newP.width, newP.height, vfov, hfov, window.innerWidth, window.innerHeight);

    const normal = (newMesh.userData.normal as THREE.Vector3).clone();
    const target = (newMesh.userData.worldPos as THREE.Vector3).clone();
    const camTarget = target.clone().add(normal.multiplyScalar(fit.dist));
    // Pour remonter le tableau à l'écran (zone basse réservée à la légende / aux annotations),
    // on descend la caméra au lieu de l'incliner : le regard reste horizontal, sans déformation du cadre.
    camTarget.y = target.y - fit.lookDown;
    const lookTarget = target.clone();
    lookTarget.y = camTarget.y;

    const startPos = cameraRef.current.position.clone();
    const startQuat = cameraRef.current.quaternion.clone();
    const m = new THREE.Matrix4().lookAt(camTarget, lookTarget, new THREE.Vector3(0, 1, 0));
    const endQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    const prevActive = activePaintingIdxRef.current;
    const newSpot = builtRef.current.wallLights.find(w => w.painting.id === newP.id);
    const prevW = prevActive >= 0 && currentList[prevActive] ? builtRef.current.wallLights.find(w => w.painting.id === currentList[prevActive].id) : null;

    if (isInitial && !refit) {
      rigRef.current.enabled = false;
      rigRef.current.cancelTeleport();
      savedCamRef.current = {
        pos: cameraRef.current.position.clone(),
        quat: cameraRef.current.quaternion.clone(),
        yaw: rigRef.current.yaw,
        pitch: rigRef.current.pitch,
      };
    }

    // Œuvre sensible : pas de narration tant que le visiteur n'a pas consenti (comme l'original).
    const gated = !!(newP.nudity || newP.graphic) && nudityConsentRef.current !== true;
    if (!gated && !refit && tweaks.narration) {
      prefetchNarration(newP, lang); // réchauffe l'audio pendant que la caméra glisse
      // Le tableau suivant : seulement le 1er morceau (titre + artiste) pour qu'il démarre instantanément
      const list = paintingsRef.current;
      const nextP = list.length > 1 ? list[(index + 1) % list.length] : null;
      if (nextP && !nextP.nudity && !nextP.graphic) prefetchNarration(nextP, lang, true);
    }
    if (tweaks.narration && !gated && !refit) {
      stopNarration(setIsNarrating);
      speakEdgeTTS(buildNarrationText(newP, lang), newP, lang, setIsNarrating);
    }

    const dur = refit ? 350 : isInitial ? 1100 : 850;
    const startDim = isInitial && !refit ? 0 : 1;
    const gen = ++tweenGenRef.current;
    const t0 = performance.now();

    function step(now: number) {
      if (gen !== tweenGenRef.current || !cameraRef.current) return;
      const progress = Math.min(1, (now - t0) / dur);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      cameraRef.current.position.lerpVectors(startPos, camTarget, ease);
      cameraRef.current.quaternion.slerpQuaternions(startQuat, endQuat, ease);
      applyDimming(startDim + (1 - startDim) * ease);

      if (newSpot) {
        newSpot.spot.intensity = 2.4 + 2.0 * ease;
        (newSpot.halo.material as THREE.MeshBasicMaterial).opacity = 0.22 * ease;
      }
      if (prevW && prevW !== newSpot) {
        prevW.spot.intensity = 2.4 * (1 - ease);
        (prevW.halo.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - ease);
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }, [applyDimming, lang, tweaks.narration]);

  focusOnRef.current = focusOn;

  // Exit Focus mode
  const exitFocus = useCallback(() => {
    if (activePaintingIdxRef.current < 0 || !cameraRef.current || !savedCamRef.current || !builtRef.current || !rigRef.current) return;
    setDetailMode(false);
    setIsGuiding(false);
    setInfoOpen(false);
    stopNarration(setIsNarrating);
    haltSpeech();

    const startPos = cameraRef.current.position.clone();
    const startQuat = cameraRef.current.quaternion.clone();
    const endPos = savedCamRef.current.pos.clone();
    const endQuat = savedCamRef.current.quat.clone();
    const active = builtRef.current.wallLights.find(
      w => paintingsRef.current[activePaintingIdxRef.current] && w.painting.id === paintingsRef.current[activePaintingIdxRef.current].id
    );

    setActivePaintingIdx(-1);
    const gen = ++tweenGenRef.current;
    const t0 = performance.now();

    function step(now: number) {
      if (gen !== tweenGenRef.current || !cameraRef.current) return;
      const progress = Math.min(1, (now - t0) / 800);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      cameraRef.current.position.lerpVectors(startPos, endPos, ease);
      cameraRef.current.quaternion.slerpQuaternions(startQuat, endQuat, ease);
      applyDimming(1 - ease);

      if (active) {
        active.spot.intensity = 4.4 - 2.0 * ease;
        (active.halo.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - ease);
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        if (rigRef.current && savedCamRef.current) {
          rigRef.current.enabled = true;
          rigRef.current.yaw = savedCamRef.current.yaw;
          rigRef.current.pitch = savedCamRef.current.pitch;
        }
      }
    }

    requestAnimationFrame(step);
  }, [applyDimming]);

  // Return to Entrance & reset
  const returnToMood = useCallback(() => {
    tweenGenRef.current++;
    setDetailMode(false);
    setIsGuiding(false);
    setInfoOpen(false);
    setActivePaintingIdx(-1);
    stopNarration(setIsNarrating);
    haltSpeech();
    galleryAudio.suspend();

    if (homePoseRef.current && cameraRef.current && rigRef.current) {
      rigRef.current.cancelTeleport();
      cameraRef.current.position.copy(homePoseRef.current.pos);
      cameraRef.current.quaternion.copy(homePoseRef.current.quat);
      rigRef.current.yaw = homePoseRef.current.yaw;
      rigRef.current.pitch = homePoseRef.current.pitch;
      rigRef.current.enabled = true;
    }

    setScreen('landing');
  }, []);

  // Request sensitive content age confirmation
  const requestNudityConsent = useCallback((): Promise<boolean> => {
    return new Promise(resolve => {
      setPendingConsentResolve(() => (accepted: boolean) => {
        setNudityConsent(accepted);
        if (builtRef.current) {
          for (const m of builtRef.current.paintingObjects) {
            if (m.userData && typeof m.userData.applyGateState === 'function') {
              m.userData.applyGateState(accepted);
            }
          }
        }
        resolve(accepted);
      });
      setShowNudityGate(true);
    });
  }, []);

  // Check consent before showing sensitive work
  const ensureConsentFor = useCallback(
    async (p: Painting): Promise<boolean> => {
      if (!p.nudity && !p.graphic) return true;
      if (nudityConsent === true) return true;
      return await requestNudityConsent();
    },
    [nudityConsent, requestNudityConsent]
  );

  // Start Mood Curation
  const handleStartMoodJourney = useCallback(
    async (tags: string[], text: string) => {
      galleryAudio.ensure().catch(() => {});

      if (detectCrisisSignal(text)) {
        setPendingActionAfterCrisis(() => () => handleStartMoodJourney(tags, text));
        setShowCrisisModal(true);
        return;
      }

      setUserMoodText(text);
      setCurrentMoodTags(tags);
      setScreen('loading');
      setProgressPct(15);
      setLoadingStatus(t('progress_choosing', lang));

      // Show immediate candidate preview from catalogue
      const initialCat = getLocalizedCatalogue(lang);
      const cand =
        initialCat.find(p => !p.nudity && !p.graphic) ||
        initialCat[Math.floor(Math.random() * 5)];
      if (cand) {
        setLoadingPreviewTitle(cand.title);
        fetchImageUrl(cand).then(url => {
          if (url) setLoadingPreviewUrl(url);
        });
      }

      try {
        const result = await buildMoodParcours(tags, text, lang);
        setParcoursResult(result);
        setPaintings(result.paintings);
        setProgressPct(50);
        setLoadingStatus(t('progress_placing', lang));

        if (result.paintings.length > 0) {
          const firstPick = result.paintings.find(p => !p.nudity && !p.graphic) || result.paintings[0];
          setLoadingPreviewTitle(firstPick.title);
          fetchImageUrl(firstPick).then(url => {
            if (url) setLoadingPreviewUrl(url);
          });
        }

        // Parallel preload all 10 painting images for zero latency
        await Promise.all(
          result.paintings.map(async p => {
            try {
              const url = await fetchImageUrl(p);
              if (url) {
                p.url = url;
                if (!p.detailUrl) p.detailUrl = url;
              }
            } catch (_) {}
          })
        );

        setProgressPct(85);

        if (sceneRef.current && builtRef.current) {
          const counts = populatePaintings(
            sceneRef.current,
            result.paintings,
            builtRef.current.wallLights,
            builtRef.current.paintingObjects,
            nudityConsent
          );
          setRoomPaintingCounts(counts);
        }

        await new Promise(r => setTimeout(r, 600));
        setProgressPct(100);
        setLoadingStatus(t('progress_ready', lang));
        await new Promise(r => setTimeout(r, 400));

        if (result.paintings.some(p => p.nudity || p.graphic) && nudityConsent === null) {
          await requestNudityConsent();
        }

        setScreen('start');
      } catch (err: any) {
        console.error('Mood journey error:', err);
        const catalogue = getLocalizedCatalogue(lang);
        const fallback = assignSlots(catalogue.slice(0, 10));
        setPaintings(fallback);
        setParcoursResult({ paintings: fallback, introText: t('fallback_intro', lang), perPainting: {} });
        if (sceneRef.current && builtRef.current) {
          const counts = populatePaintings(
            sceneRef.current,
            fallback,
            builtRef.current.wallLights,
            builtRef.current.paintingObjects,
            nudityConsent
          );
          setRoomPaintingCounts(counts);
        }
        setScreen('start');
      }
    },
    [lang, nudityConsent, requestNudityConsent]
  );

  // Initialize Three.js scene on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    // preserveDrawingBuffer coûte cher sur mobile et n'est utilisé nulle part : on le garde seulement hors tactile.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !coarse });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0807);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(tweaks.fov, window.innerWidth / window.innerHeight, 0.05, 60);
    camera.position.set(5, 1.55, -3.0);
    camera.lookAt(5, 1.55, -9);
    cameraRef.current = camera;

    const built = buildGallery(scene);
    builtRef.current = built;

    const rig = new FirstPersonRig(camera, canvas, built.colliders);
    rig.maxSpeed = tweaks.walkSpeed;
    rig.lookSensitivity = tweaks.lookSensitivity;
    rig.setYawPitchFromCamera();
    rig.onMove = () => galleryAudio.footstep();
    rigRef.current = rig;

    homePoseRef.current = {
      pos: camera.position.clone(),
      quat: camera.quaternion.clone(),
      yaw: rig.yaw,
      pitch: rig.pitch,
    };

    // Raycaster for click handling
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    rig.onClick = (e: PointerEvent) => {
      galleryAudio.ensure().catch(() => {});
      if (activePaintingIdxRef.current >= 0) return;
      camera.updateMatrixWorld(true);
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);

      const ph = raycaster.intersectObjects(built.paintingObjects, false);
      if (ph.length && ph[0].distance < 8) {
        const clickedP = ph[0].object.userData.painting as Painting;
        const currentList = paintingsRef.current;
        const idx = currentList.findIndex(p => p.id === clickedP.id);
        if (idx >= 0 && focusOnRef.current) {
          focusOnRef.current(idx, true);
        }
        return;
      }

      const fh = raycaster.intersectObject(built.floor, false);
      if (fh.length) {
        const p = fh[0].point;
        rig.walkTo(
          new THREE.Vector3(
            Math.max(-8.4, Math.min(8.4, p.x)),
            0,
            Math.max(-8.4, Math.min(8.4, p.z))
          )
        );
      }
    };

    // Animation Loop
    const clock = new THREE.Clock();
    let animId: number;
    let lastYawSent = Infinity;

    function animate() {
      const dt = Math.min(0.05, clock.getDelta());
      rig.update(dt);
      // La boussole du HUD n'a pas besoin de 60 re-rendus React par seconde (coûteux sur mobile).
      if (Math.abs(rig.yaw - lastYawSent) > 0.012) {
        lastYawSent = rig.yaw;
        setCurrentYaw(rig.yaw);
      }

      // Detect room
      if (activePaintingIdxRef.current < 0) {
        const x = camera.position.x;
        const z = camera.position.z;
        for (const r of built.roomVolumes) {
          if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
            setCurrentRoomKey(r.key);
            break;
          }
        }

        // Detect proximity painting
        camera.updateMatrixWorld(true);
        ndc.set(0, 0);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(built.paintingObjects, false);
        if (hits.length && hits[0].distance <= 5.5) {
          setProximityPainting(hits[0].object.userData.painting as Painting);
        } else {
          setProximityPainting(null);
        }
      }

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    }

    animId = requestAnimationFrame(animate);

    let resizeTimer: number | undefined;
    const onResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      // Rotation du téléphone / de la tablette pendant la contemplation : on recadre le tableau
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const idx = activePaintingIdxRef.current;
        if (idx >= 0 && focusOnRef.current) focusOnRef.current(idx, false, true);
      }, 180);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      renderer.dispose();
    };
  }, []);

  // Débloque l'audio mobile (iOS/Android) dès le premier geste de l'utilisateur
  useEffect(() => {
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    const once = () => {
      unlockAudio();
      galleryAudio.ensure().catch(() => {});
      events.forEach(e => window.removeEventListener(e, once));
    };
    events.forEach(e => window.addEventListener(e, once, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, once));
  }, []);

  // Synchronize dynamic paintings list with 3D scene
  useEffect(() => {
    if (sceneRef.current && builtRef.current && paintings.length > 0) {
      const counts = populatePaintings(
        sceneRef.current,
        paintings,
        builtRef.current.wallLights,
        builtRef.current.paintingObjects,
        nudityConsent
      );
      setRoomPaintingCounts(counts);
    }
  }, [paintings, nudityConsent]);

  // Global Keydown shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if (e.key === 'Escape') {
        if (showReportModal) {
          setShowReportModal(false);
          return;
        }
        if (showFeedbackModal) {
          setShowFeedbackModal(false);
          return;
        }
        if (detailMode) {
          setDetailMode(false);
          return;
        }
        if (infoOpen) {
          setInfoOpen(false);
          return;
        }
        if (activePaintingIdx >= 0) {
          exitFocus();
          return;
        }
      }

      if (inField) return;

      if (activePaintingIdx >= 0) {
        if (e.key === 'ArrowRight' || e.key === ' ') {
          stopNarration(setIsNarrating);
          setIsGuiding(false);
          const nextIdx = (activePaintingIdx + 1) % paintings.length;
          focusOn(nextIdx, false);
        } else if (e.key === 'ArrowLeft') {
          stopNarration(setIsNarrating);
          setIsGuiding(false);
          const prevIdx = (activePaintingIdx - 1 + paintings.length) % paintings.length;
          focusOn(prevIdx, false);
        }
      } else {
        if (e.key === 'e' || e.key === 'E') {
          if (proximityPainting) {
            const idx = paintings.findIndex(p => p.id === proximityPainting.id);
            if (idx >= 0) focusOn(idx, true);
          }
        }
        if (e.key === 'm' || e.key === 'M') {
          setShowTweaks(prev => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activePaintingIdx,
    detailMode,
    exitFocus,
    focusOn,
    infoOpen,
    paintings,
    proximityPainting,
    showFeedbackModal,
    showReportModal,
  ]);

  // Room Exploration Guidance Nudge Check
  useEffect(() => {
    const interval = setInterval(() => {
      if (activePaintingIdx >= 0 || paintings.length === 0 || !currentRoomKey) return;
      if (showCrisisModal || showNudityGate || showReportModal || showFeedbackModal) return;

      if (roomGuidanceRef.current.roomKey !== currentRoomKey) {
        roomGuidanceRef.current = { roomKey: currentRoomKey, since: Date.now(), nudgedFor: null };
        return;
      }

      if (roomGuidanceRef.current.nudgedFor === currentRoomKey) return;
      if (Date.now() - roomGuidanceRef.current.since < 20000) return;

      const inCurrentRoom = paintings.filter(p => p.room === currentRoomKey);
      const isRoomComplete = inCurrentRoom.length > 0 && inCurrentRoom.every(p => visitedPaintingIdsRef.current.has(p.id));

      if (isRoomComplete) {
        const nextRoom = (['peach', 'blue', 'green', 'yellow'] as RoomKey[]).find(
          k => k !== currentRoomKey && paintings.filter(p => p.room === k).some(p => !visitedPaintingIdsRef.current.has(p.id))
        );
        if (nextRoom) {
          roomGuidanceRef.current.nudgedFor = currentRoomKey;
          const targetName = ROOM_NAMES[lang][nextRoom];
          setRoomNudgeText(t('room_nudge_text', lang)(targetName));
          setTimeout(() => setRoomNudgeText(null), 7000);
        }
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activePaintingIdx, currentRoomKey, lang, paintings, showCrisisModal, showFeedbackModal, showNudityGate, showReportModal]);

  // Proactive Feedback prompt after 2.5 minutes
  useEffect(() => {
    let prompted = false;
    try {
      if (sessionStorage.getItem('gallery_feedback_prompted')) prompted = true;
    } catch (_) {}

    if (!prompted && screen === 'gallery') {
      const timer = setTimeout(() => {
        try {
          sessionStorage.setItem('gallery_feedback_prompted', '1');
        } catch (_) {}
        setShowFeedbackModal(true);
      }, 150000);
      return () => clearTimeout(timer);
    }
  }, [screen]);

  // Toggle "Guider mon regard"
  const handleToggleGuide = async () => {
    if (activePaintingIdx < 0) return;
    const currentP = paintings[activePaintingIdx];
    const ok = await ensureConsentFor(currentP);
    if (!ok) return;

    if (isGuiding) {
      setIsGuiding(false);
      haltSpeech();
      return;
    }

    setInfoOpen(false);
    stopNarration(setIsNarrating);
    setIsGuideLoading(true);

    try {
      const anns = await fetchAnnotations(currentP, currentMoodTags, userMoodText, lang);
      currentP.annotations = anns;
      setIsGuiding(true);
    } finally {
      setIsGuideLoading(false);
    }
  };

  const handleToggleNarration = async () => {
    if (activePaintingIdx < 0) return;
    const currentP = paintings[activePaintingIdx];
    const ok = await ensureConsentFor(currentP);
    if (!ok) return;

    if (isNarrating) {
      stopNarration(setIsNarrating);
    } else {
      speakEdgeTTS(buildNarrationText(currentP, lang), currentP, lang, setIsNarrating);
    }
  };

  const currentActivePainting = activePaintingIdx >= 0 ? paintings[activePaintingIdx] : null;

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0a0d1a] font-sans">
      {/* 3D WebGL Canvas */}
      <canvas ref={canvasRef} id="c" />

      {/* Language Switcher */}
      <LanguageSwitch currentLang={lang} onSelect={handleSelectLang} isFocused={activePaintingIdx >= 0} />

      {/* Dynamic Digital Landscape for Night Stage */}
      <DigitalLandscape hidden={screen === 'gallery'} />

      {/* 1. LANDING & MOOD STAGE */}
      {screen === 'landing' && (
        <LandingStage
          lang={lang}
          onSubmitMood={handleStartMoodJourney}
          onShowCrisis={action => {
            setPendingActionAfterCrisis(() => action);
            setShowCrisisModal(true);
          }}
        />
      )}

      {/* 2. LOADING SCREEN */}
      {screen === 'loading' && (
        <LoadingScreen
          lang={lang}
          progressPct={progressPct}
          status={loadingStatus}
          previewUrl={loadingPreviewUrl}
          previewTitle={loadingPreviewTitle}
          introText={parcoursResult?.introText}
        />
      )}

      {/* 3. START ITINERARY SCREEN */}
      {screen === 'start' && (
        <StartScreen
          lang={lang}
          paintings={paintings}
          introText={parcoursResult?.introText || ''}
          onEnterGallery={() => {
            galleryAudio.ensure().catch(() => {});
            setScreen('gallery');
          }}
        />
      )}

      {/* 4. GALLERY HUD */}
      {screen === 'gallery' && (
        <GalleryHUD
          lang={lang}
          camera={cameraRef.current}
          yaw={currentYaw}
          wallLights={builtRef.current?.wallLights || []}
          proximityPainting={proximityPainting}
          currentRoomKey={currentRoomKey}
          roomPaintingCounts={roomPaintingCounts}
          paintings={paintings}
          activePaintingIdx={activePaintingIdx}
          isFocused={activePaintingIdx >= 0}
          onReturnHome={() => setShowHomeConfirm(true)}
          onOpenFeedback={() => setShowFeedbackModal(true)}
          roomNudgeText={roomNudgeText}
        />
      )}

      {/* 5. FOCUS OVERLAY */}
      {screen === 'gallery' && currentActivePainting && (
        <FocusOverlay
          lang={lang}
          painting={currentActivePainting}
          infoOpen={infoOpen}
          isNarrating={isNarrating}
          isGuiding={isGuiding}
          isGuideLoading={isGuideLoading}
          onToggleInfo={async () => {
            const ok = await ensureConsentFor(currentActivePainting);
            if (ok) setInfoOpen(prev => !prev);
          }}
          onCloseInfo={() => setInfoOpen(false)}
          onZoom={async () => {
            const ok = await ensureConsentFor(currentActivePainting);
            if (ok) setDetailMode(true);
          }}
          onToggleGuide={handleToggleGuide}
          onReport={() => setShowReportModal(true)}
          onExit={exitFocus}
          onPrev={() => {
            stopNarration(setIsNarrating);
            setIsGuiding(false);
            const prevIdx = (activePaintingIdx - 1 + paintings.length) % paintings.length;
            focusOn(prevIdx, false);
          }}
          onNext={() => {
            stopNarration(setIsNarrating);
            setIsGuiding(false);
            const nextIdx = (activePaintingIdx + 1) % paintings.length;
            focusOn(nextIdx, false);
          }}
          onToggleNarration={handleToggleNarration}
        />
      )}

      {/* 6. GUIDED ANNOTATIONS */}
      {isGuiding && currentActivePainting && (
        <GuidedAnnotations
          lang={lang}
          painting={currentActivePainting}
          camera={cameraRef.current}
          paintingMesh={
            builtRef.current?.paintingObjects.find(
              m => m.userData.painting.id === currentActivePainting.id
            ) || null
          }
          detailMode={detailMode}
          detailImgRef={detailImgRef}
          onClose={() => setIsGuiding(false)}
        />
      )}

      {/* 7. HIGH-RES ZOOM DETAIL VIEW */}
      {detailMode && currentActivePainting && (
        <DetailZoomView
          lang={lang}
          painting={currentActivePainting}
          isGuiding={isGuiding}
          onToggleGuide={handleToggleGuide}
          onClose={() => setDetailMode(false)}
          imgRef={detailImgRef}
        />
      )}

      {/* 8. TWEAKS & CONFIGURATION PANEL */}
      {showTweaks && (
        <TweaksPanel
          settings={tweaks}
          onChange={updated => {
            setTweaks(prev => {
              const next = { ...prev, ...updated };
              if (rigRef.current && updated.walkSpeed !== undefined) {
                rigRef.current.maxSpeed = updated.walkSpeed;
              }
              if (rigRef.current && updated.lookSensitivity !== undefined) {
                rigRef.current.lookSensitivity = updated.lookSensitivity;
              }
              if (cameraRef.current && updated.fov !== undefined) {
                cameraRef.current.fov = updated.fov;
                cameraRef.current.updateProjectionMatrix();
              }
              if (updated.audioVolume !== undefined) {
                galleryAudio.setVolume(updated.audioVolume);
              }
              return next;
            });
          }}
          onClose={() => setShowTweaks(false)}
        />
      )}

      {/* 9. SAFETY & FEEDBACK MODALS */}
      {showHomeConfirm && (
        <HomeConfirmModal
          lang={lang}
          onStay={() => setShowHomeConfirm(false)}
          onLeave={() => {
            setShowHomeConfirm(false);
            returnToMood();
          }}
        />
      )}

      {showCrisisModal && (
        <CrisisModal
          lang={lang}
          onClose={() => setShowCrisisModal(false)}
          onContinue={() => {
            setShowCrisisModal(false);
            if (pendingActionAfterCrisis) {
              pendingActionAfterCrisis();
              setPendingActionAfterCrisis(null);
            }
          }}
        />
      )}

      {showNudityGate && (
        <NudityGateModal
          lang={lang}
          onDecline={() => {
            setShowNudityGate(false);
            if (pendingConsentResolve) {
              pendingConsentResolve(false);
              setPendingConsentResolve(null);
            }
          }}
          onAccept={() => {
            setShowNudityGate(false);
            if (pendingConsentResolve) {
              pendingConsentResolve(true);
              setPendingConsentResolve(null);
            }
          }}
        />
      )}

      {showReportModal && currentActivePainting && (
        <ReportModal
          lang={lang}
          painting={currentActivePainting}
          moodTags={currentMoodTags}
          sessionId={sessionIdRef.current}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {showFeedbackModal && (
        <FeedbackModal
          lang={lang}
          moodTags={currentMoodTags}
          paintingCount={paintings.length}
          sessionId={sessionIdRef.current}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}
    </main>
  );
}
