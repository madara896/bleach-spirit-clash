/**
 * ai.ts — bot o'yinchi.
 *
 * Oddiy, ammo tushunarli arxitektura: har bir "qaror"da bitta harakatni
 * tanlaydi, tanlagan harakatni bajarib bo'lgach keyin yangisini o'ylaydi.
 * Qiyinlik darajasi reaksiya kechikishini va xato qilish ehtimolini o'zgartiradi.
 */

import { Rng } from "./physics";
import { BTN } from "./types";
import type { Fighter } from "./fighter";
import type { ButtonMask } from "./types";

export type AiLevel = "easy" | "normal" | "hard" | "expert";

interface AiCfg {
  /** qaror qabul qilish orasidagi minimal kadr */
  thinkDelay: number;
  /** qaror kechikishining tasodifiy qo'shimchasi (kadr) */
  jitter: number;
  /** dushman zarbasidan keyin "ko'rish" kechikish (kadr) */
  reaction: number;
  /** bloklash ehtimoli */
  blockChance: number;
  /** urishni tanlash ehtimoli (yaqin masofada) */
  attackChance: number;
  /** maxsus harakatni tanlash ehtimoli */
  specialChance: number;
  /** Bankai ishlatish ehtimoli */
  superChance: number;
  /** tez-tez urish ehtimoli (agresivlikka bog'liq) */
  aggression: number;
}

export const AI_LEVELS: Record<AiLevel, AiCfg> = {
  easy: {
    thinkDelay: 26, jitter: 18, reaction: 20, blockChance: 0.18,
    attackChance: 0.30, specialChance: 0.06, superChance: 0.25, aggression: 0.35,
  },
  normal: {
    thinkDelay: 16, jitter: 10, reaction: 12, blockChance: 0.42,
    attackChance: 0.52, specialChance: 0.14, superChance: 0.55, aggression: 0.55,
  },
  hard: {
    thinkDelay: 10, jitter: 6, reaction: 7, blockChance: 0.66,
    attackChance: 0.68, specialChance: 0.22, superChance: 0.80, aggression: 0.75,
  },
  expert: {
    thinkDelay: 6, jitter: 3, reaction: 4, blockChance: 0.82,
    attackChance: 0.78, specialChance: 0.30, superChance: 0.95, aggression: 0.90,
  },
};

type Intent =
  | "idle"
  | "approach"
  | "retreat"
  | "light"
  | "heavy"
  | "launcher"
  | "special1"
  | "special2"
  | "block"
  | "crouchBlock"
  | "jump"
  | "dash"
  | "backdash"
  | "airLight";

export class Ai {
  private rng: Rng;
  private cfg: AiCfg;
  private thinkIn = 0;
  private intent: Intent = "idle";
  private intentFor = 0;
  private lastReaction = 0;
  private wasHurt = false;
  private name: string;

  constructor(level: AiLevel, seed: number, name = "BOT") {
    this.cfg = AI_LEVELS[level];
    this.rng = new Rng(seed >>> 0 || 12345);
    this.thinkIn = this.cfg.thinkDelay;
    this.name = name;
  }

  get label() { return this.name; }

  reset() {
    this.thinkIn = this.cfg.thinkDelay;
    this.intent = "idle";
    this.intentFor = 0;
    this.wasHurt = false;
  }

  /** Bot uchun kiritish maskasini hisoblaydi. */
  think(me: Fighter, foe: Fighter, tick: number): ButtonMask {
    const c = this.cfg;
    let m = 0;

    const dx = foe.x - me.x;
    const dist = Math.abs(dx);
    const dir = dx > 0 ? 1 : -1;
    const fwd = dir === 1 ? BTN.RIGHT : BTN.LEFT;
    const back = dir === 1 ? BTN.LEFT : BTN.RIGHT;

    // --- dushman holati kuzatuvi (bloklashga intilish uchun) ---
    if (foe.state === "knockdown" || foe.state === "getup") this.wasHurt = true;

    if (this.thinkIn > 0) this.thinkIn--;
    if (this.thinkIn <= 0) {
      this.thinkIn = c.thinkDelay + this.rng.int(0, c.jitter);
      this.intent = this.decide(me, foe, dist);
      this.intentFor = this.intentTicks();
    }
    if (this.intentFor > 0) this.intentFor--;

    // --- kiritishni yig'ish ---
    switch (this.intent) {
      case "approach": if (this.intentFor > 0) m |= fwd; break;
      case "retreat": if (this.intentFor > 0) m |= back; break;
      case "block": if (this.intentFor > 0) m |= back; break;
      case "crouchBlock": if (this.intentFor > 0) m |= back | BTN.DOWN; break;
      case "light": if (this.intentFor > 0) m |= fwd | BTN.LP; break;
      case "heavy": if (this.intentFor > 0) m |= fwd | BTN.HP; break;
      case "launcher": if (this.intentFor > 0) m |= fwd | BTN.LP; break;
      case "special1": if (this.intentFor > 0) m |= fwd | BTN.SP; break;
      case "special2": if (this.intentFor > 0) m |= fwd | BTN.SP; break;
      case "jump": if (this.intentFor > 0) m |= fwd | BTN.UP; break;
      case "dash": if (this.intentFor > 0) m |= fwd; break;
      case "backdash": if (this.intentFor > 0) m |= back; break;
      case "airLight": if (!me.grounded && this.intentFor > 0) m |= fwd | BTN.HP; break;
      case "idle": break;
    }
    void tick; void this.lastReaction; void this.wasHurt;
    return m;
  }

  /** Foydalanilmaydigan, kelajakda kengaytirish uchun. */
  private intentTicks(): number {
    switch (this.intent) {
      case "block":
      case "crouchBlock": return 14 + this.rng.int(0, 10);
      case "light": return 5;
      case "heavy": return 7;
      case "launcher": return 6;
      case "special1": return 8;
      case "special2": return 8;
      case "jump": return 3;
      case "approach": return 12 + this.rng.int(0, 16);
      case "retreat": return 10 + this.rng.int(0, 12);
      case "dash": return 10;
      case "backdash": return 8;
      case "airLight": return 6;
      default: return 6;
    }
  }

  private decide(me: Fighter, foe: Fighter, dist: number): Intent {
    const c = this.cfg;
    const r = this.rng.next();
    const foeDown = foe.state === "knockdown" || foe.state === "getup";
    const foeThreat = foe.move !== null && !foeDown;

    // 1) Bankai
    if (me.meter >= 100 && dist < 200 && r < c.superChance) return "special2";

    // 2) dushman nishoni oldida bo'lsa — bloklash
    if (foeThreat && dist < 220 && r < c.blockChance) {
      return this.rng.next() < 0.4 ? "crouchBlock" : "block";
    }

    // 3) maxsus harakatlar
    if (dist > 150 && r < c.specialChance + 0.10) return "special1";
    if (dist < 190 && r < c.specialChance * 0.7) return "special2";

    // 4) yaqin masofada — urish
    if (dist < 175) {
      if (r < c.attackChance) {
        const u = this.rng.next();
        if (u < 0.5) return "light";
        if (u < 0.86) return "heavy";
        return "launcher";
      }
      if (this.rng.next() < c.aggression) return "approach";
      return "retreat";
    }

    // 5) uzoqda — yaqinlashish yoki maxsus
    if (dist > 520) {
      if (this.rng.next() < 0.35) return "special1";
      if (this.rng.next() < 0.12) return "jump";
      return "approach";
    }
    if (this.rng.next() < 0.6) return "approach";
    if (this.rng.next() < 0.2) return "dash";
    return "retreat";
  }
}
