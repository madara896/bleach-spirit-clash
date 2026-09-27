/**
 * types.ts — o'yin ichidagi barcha tiplar va doimiy o'lchamlar.
 *
 * KOORDINATA TIZIMI:
 *   x — o'yin dunyosida (0 dan STAGE_W gacha), o'ngga qaraydi
 *   y — balandlik: 0 = yer, manfiy = tepa
 *   Sprite kadrlari esa `py` bilan chizilgan (404 = yerga tegish chizig'i),
 *   shuning uchun sprite koordinatlarini `SpriteFrame.toWorld()` aylantiradi.
 */

export const VIEW_W = 1280;
export const VIEW_H = 720;
export const STAGE_W = 2400;
export const GROUND_Y = 0; // y o'qi allaqachon "yer = 0" deb

/** Sprite kadrining ichki o'lchamlari (rig.py bilan mos kelishi SHART). */
export const SPR_FRAME_W = 560;
export const SPR_FRAME_H = 448;
export const SPR_GROUND_Y = 404;
export const SPR_PELVIS_X = 280;

/**
 * O'yin dunyosidagi o'lchov (1.0 = sprite o'lchamidagi 1:1).
 */
export const SCALE = 1.0;

/**
 * Kamera masshtabi: sprite 560x448 kadr, belgi ~300px baland.
 * 0.95 da belgi ekran balandligining ~40%ini egallaydi (Mortal Kombat uslubi).
 */
export const CAMERA_SCALE = 0.95;

export const TICK = 1000 / 60; // bir kadr = 16.67ms

// ---------------------------------------------------------------------------
// Kiritish tugmalari
// ---------------------------------------------------------------------------
export const BTN = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  UP: 1 << 2,
  DOWN: 1 << 3,
  LP: 1 << 4, // yengil zarba
  HP: 1 << 5, // og'ir zarba
  SP: 1 << 6, // maxsus harakat
  BK: 1 << 7, // Bankai (super)
} as const;

export type ButtonMask = number;

export const ATTACK_BUTTONS = BTN.LP | BTN.HP | BTN.SP | BTN.BK;

// ---------------------------------------------------------------------------
// Holatlar
// ---------------------------------------------------------------------------
export type FighterState =
  | "intro"
  | "idle"
  | "walk_f"
  | "walk_b"
  | "crouch"
  | "jump_rise"
  | "jump_fall"
  | "dash"
  | "backdash"
  | "attack"
  | "block_stand"
  | "block_crouch"
  | "hit_stand"
  | "hit_crouch"
  | "knockdown"
  | "getup"
  | "bankai"
  | "ko"
  | "victory";

/** Holat -> animatsiya nomi. */
export const ANIM: Partial<Record<FighterState, string>> = {
  idle: "idle",
  walk_f: "walk_f",
  walk_b: "walk_b",
  crouch: "crouch",
  jump_rise: "jump_rise",
  jump_fall: "jump_fall",
  dash: "dash",
  backdash: "backdash",
  block_stand: "block_stand",
  block_crouch: "block_crouch",
  hit_stand: "hit_stand",
  hit_crouch: "hit_crouch",
  knockdown: "knockdown",
  getup: "getup",
  ko: "ko",
  victory: "victory",
};

// ---------------------------------------------------------------------------
// Kapsula (kengaytirilgan chiziq + radius) — kapsula/kapsula to'qnashuvi uchun
// ---------------------------------------------------------------------------
export interface Capsule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}

/** JSON'dan keladigan sprite kadr ma'lumotlari. */
export interface FrameData {
  /** kadr davomiyligi (60-dan bir birlikda) */
  d: number;
  /** og'irlik kapsulalari (sprite px, o'ngga qaragan) */
  h: number[][];
  /** zarba kapsulasi yoki null */
  a: number[] | null;
  /** nishon/toplama chiqadigan nuqta */
  m: number[];
  /** ko'z holati: 0 oddiy, 1 yopiq, 2 yorqin */
  e: number;
}

export interface AnimData {
  n: number;
  dur: number;
  loop: boolean;
  frames: FrameData[];
  file: string;
  /**
   * Sprite lentasi KONTENT BO'YICHA qirqilgan, shuning uchun kadr to'liq
   * 560x448 emas. `cw`/`ch` — lentadagi bitta kadr o'lchami, `ox`/`oy` —
   * shu kadrning to'liq kadr ichidagi joyi.
   */
  cw: number;
  ch: number;
  ox: number;
  oy: number;
  /** harakat vaqti — Python generatori animatsiya kadrlaridan HISOBLAYDI */
  startup: number;
  active: number;
  recovery: number;
  total: number;
  /** zarba faollik oynalari: [[boshlanish, tugash], ...] (moveTick bo'yicha) */
  windows: number[][];
  /** projectile chiqadigan moveTick, yoki -1 */
  spawn: number;
  projectile?: boolean;
  dash?: boolean;
  aura?: boolean;
  bankai?: boolean;
  super_move?: boolean;
}

export interface CharData {
  frameW: number;
  frameH: number;
  groundY: number;
  /** sprite o'qida belgining markaziy nuqtasi (dvigatel shuni ishlitadi) */
  pelvisX: number;
  anims: Record<string, AnimData>;
}

export type SpriteBank = Record<string, HTMLImageElement>;

// ---------------------------------------------------------------------------
// Harakatlar (move) ta'riflari
// ---------------------------------------------------------------------------
export type MoveKind = "normal" | "command" | "special" | "super";

export interface MoveDef {
  /** animatsiya nomi */
  anim: string;
  damage: number;
  /** qarshi tomonga surilish (daraja/2 = o'rtacha) */
  pushback: number;
  /** qarshi tomon uchun "hitstun" (kadr) */
  hitstun: number;
  /** o'z tarafimiz uchun "blockstun" */
  blockstun: number;
  kind: MoveKind;
  /** meter qo'shish (o'zimiz bergan zarar) */
  meterGain: number;
  /** boshqa tomonga urilish (knockback balandligi) */
  launch: number;
  /** o'ziga tegimli (yaqin masofa) */
  reach: number;
  /** zarba balandligi: 0 = past, 1 = o'rta, 2 = baland */
  height: 0 | 1 | 2;
  /** qaysi holatdan bajarilishi mumkin */
  from: "stand" | "crouch" | "air";
  /** projectile yaratadimi */
  projectile?: "getsuga" | "shakaho" | "sokatsui";
  /** takrorlash mumkinmi (chain) */
  chains?: boolean;
  /** necha urishdan keyin ham urish mumkin (ko'p urishli super uchun) */
  maxHits?: number;
}

/** Harakat vaqti — animatsiyadan olinadi. */
export interface MoveTiming {
  startup: number;
  active: number;
  recovery: number;
  total: number;
  windows: number[][];
  spawn: number;
}

export interface CharDef {
  key: string;
  name: string;
  subtitle: string;
  /** o'yin ichidagi asosiy rang (HUD uchun) */
  color: string;
  color2: string;
  health: number;
  walkSpeed: number;
  backSpeed: number;
  jumpVel: number;
  gravity: number;
  /** zarba egilishi (dushman tomon) */
  weight: number;
  moves: Record<string, MoveDef>;
  /** AI uchun xususiyatlar */
  ai: { aggression: number; preferredRange: number };
}
