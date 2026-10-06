export type Lang = 'fr' | 'en';

export type RoomKey = 'peach' | 'blue' | 'green' | 'yellow';

export interface AnnotationPoint {
  x: number;
  y: number;
  label: string;
  text: string;
}

export interface Painting {
  id: string;
  title: string;
  artist: string;
  year: string;
  medium: string;
  dimensions: string;
  location: string;
  room_hint: RoomKey;
  room?: RoomKey;
  wall?: 'N' | 'S' | 'E' | 'W';
  pos?: number;
  width: number;
  height: number;
  src?: string;
  wikiFile?: string;
  searchTitle?: string;
  desc: string;
  nudity?: boolean;
  graphic?: boolean;
  url?: string;
  detailUrl?: string;
  details?: string[];
  meditation?: string;
  raison?: string;
  anecdote?: string;
  questions?: string[];
  annotations?: AnnotationPoint[];
}

export interface WallSlot {
  room: RoomKey;
  wall: 'N' | 'S' | 'E' | 'W';
  pos: number;
}

export interface ParcoursResult {
  paintings: Painting[];
  introText: string;
  perPainting: Record<string, {
    meditation?: string;
    raison?: string;
    anecdote?: string;
    questions?: string[];
  }>;
}

export interface TweakSettings {
  lightingDrama: number;
  walkSpeed: number;
  fov: number;
  audioVolume: number;
  narration: boolean;
  lookSensitivity: number;
}

export interface CrisisResource {
  name: string;
  detail: string;
  tel?: string;
  url?: string;
}

export interface ReportPayload {
  painting_id: string | null;
  painting_title: string | null;
  reason_category: string;
  reason_text: string;
  mood_tags: string[];
  lang: Lang;
  nonce: string;
}

export interface FeedbackPayload {
  rating: number | null;
  empty_frame_seen: boolean | null;
  resonated: boolean | null;
  surprised: boolean | null;
  would_recommend: boolean | null;
  why_not: string;
  comment: string;
  mood_tags: string[];
  painting_count: number | null;
  lang: Lang;
  nonce: string;
}
