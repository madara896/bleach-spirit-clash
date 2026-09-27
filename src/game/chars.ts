/**
 * chars.ts — belgilar va ularning harakatlari (moveset).
 *
 * DIQQAT: harakatning `startup` / `active` / `recovery` vaqtlari bu yerda
 * YO'Q — ular Python generatori tomonidan animatsiya kadrlaridan avtomatik
 * hisoblanadi va `ichigo.json` / `aizen.json` ichida saqlanadi. Shu sababli
 * chizilgan animatsiya bilan zarba oynasi hech qachon mos kelmay qolmaydi.
 *
 * Bu yerda faqat o'yin hisobi (zarar, stun, meter) bor.
 */

import type { CharDef, MoveDef } from "./types";

const ichigo: CharDef = {
  key: "ichigo",
  name: "ICHIGO",
  subtitle: "Kurosaki · Bankai",
  color: "#F2802A",
  color2: "#FFD08A",
  health: 1000,
  walkSpeed: 4.6,
  backSpeed: 3.6,
  jumpVel: 15.4,
  gravity: 0.62,
  weight: 1.0,
  ai: { aggression: 0.72, preferredRange: 165 },
  moves: {
    // --- oddiy zarbalar ---
    light: {
      anim: "atk1", damage: 42, pushback: 3.2, hitstun: 13, blockstun: 8,
      kind: "normal", meterGain: 5, launch: 0,
      reach: 118, height: 1, from: "stand",
    },
    heavy: {
      anim: "atk2", damage: 84, pushback: 7.5, hitstun: 20, blockstun: 12,
      kind: "normal", meterGain: 8, launch: 0,
      reach: 142, height: 2, from: "stand", chains: true,
    },
    launcher: {
      anim: "atk3", damage: 76, pushback: 2.0, hitstun: 24, blockstun: 10,
      kind: "normal", meterGain: 7, launch: 11,
      reach: 128, height: 2, from: "stand", chains: true,
    },
    crouchLight: {
      anim: "crouch_atk", damage: 32, pushback: 2.2, hitstun: 11, blockstun: 7,
      kind: "normal", meterGain: 4, launch: 0,
      reach: 108, height: 0, from: "crouch",
    },
    crouchHeavy: {
      anim: "crouch_atk", damage: 46, pushback: 4.0, hitstun: 18, blockstun: 10,
      kind: "normal", meterGain: 5, launch: 0,
      reach: 108, height: 0, from: "crouch",
    },
    airLight: {
      anim: "air_atk", damage: 38, pushback: 2.0, hitstun: 14, blockstun: 8,
      kind: "normal", meterGain: 4, launch: 0,
      reach: 124, height: 1, from: "air",
    },
    airHeavy: {
      anim: "air_atk", damage: 56, pushback: 3.4, hitstun: 18, blockstun: 9,
      kind: "normal", meterGain: 5, launch: 0,
      reach: 124, height: 1, from: "air",
    },
    // --- maxsus harakatlar ---
    special1: {
      // GETSUGA TENSHŌ — chap qo'l bilan qizil to'lqin to'proq
      anim: "special1", damage: 78, pushback: 6.0, hitstun: 22, blockstun: 12,
      kind: "special", meterGain: 8, launch: 0,
      reach: 0, height: 1, from: "stand", projectile: "getsuga",
    },
    special2: {
      // KESSETSU: SHIBA-ORI — oldinga sakrab chuqur kesim
      anim: "special2", damage: 96, pushback: 7.0, hitstun: 26, blockstun: 12,
      kind: "special", meterGain: 9, launch: 0,
      reach: 132, height: 1, from: "stand",
    },
    // --- super ---
    bankai: {
      // TENSA ZANGETSU — 3 ta alohida zarba (windows[0..2])
      anim: "bankai", damage: 96, pushback: 8.0, hitstun: 26, blockstun: 13,
      kind: "super", meterGain: 0, launch: 0,
      reach: 146, height: 1, from: "stand", maxHits: 3,
    },
  },
};

const aizen: CharDef = {
  key: "aizen",
  name: "AIZEN",
  subtitle: "Sōsuke · Hadō",
  color: "#7C6BE8",
  color2: "#C9BFFF",
  health: 950,
  walkSpeed: 4.2,
  backSpeed: 3.9,
  jumpVel: 14.6,
  gravity: 0.62,
  weight: 0.92,
  ai: { aggression: 0.48, preferredRange: 300 },
  moves: {
    light: {
      anim: "atk1", damage: 30, pushback: 2.0, hitstun: 12, blockstun: 8,
      kind: "normal", meterGain: 5, launch: 0,
      reach: 62, height: 1, from: "stand",
    },
    heavy: {
      anim: "atk2", damage: 72, pushback: 6.0, hitstun: 19, blockstun: 12,
      kind: "normal", meterGain: 8, launch: 0,
      reach: 78, height: 1, from: "stand", chains: true,
    },
    launcher: {
      anim: "atk3", damage: 68, pushback: 1.6, hitstun: 22, blockstun: 10,
      kind: "normal", meterGain: 7, launch: 10,
      reach: 68, height: 2, from: "stand", chains: true,
    },
    crouchLight: {
      anim: "crouch_atk", damage: 26, pushback: 1.6, hitstun: 10, blockstun: 7,
      kind: "normal", meterGain: 4, launch: 0,
      reach: 60, height: 0, from: "crouch",
    },
    crouchHeavy: {
      anim: "crouch_atk", damage: 38, pushback: 3.0, hitstun: 16, blockstun: 10,
      kind: "normal", meterGain: 5, launch: 0,
      reach: 60, height: 0, from: "crouch",
    },
    airLight: {
      anim: "air_atk", damage: 32, pushback: 1.8, hitstun: 13, blockstun: 8,
      kind: "normal", meterGain: 4, launch: 0,
      reach: 70, height: 1, from: "air",
    },
    airHeavy: {
      anim: "air_atk", damage: 48, pushback: 3.0, hitstun: 17, blockstun: 9,
      kind: "normal", meterGain: 5, launch: 0,
      reach: 70, height: 1, from: "air",
    },
    // --- maxsus harakatlar ---
    special1: {
      // HADŌ #31 SHAKKAHŌ — tez, kichik, portlab chiqadigan nishon
      anim: "special1", damage: 54, pushback: 3.0, hitstun: 18, blockstun: 9,
      kind: "special", meterGain: 7, launch: 0,
      reach: 0, height: 1, from: "stand", projectile: "shakaho",
    },
    special2: {
      // HADŌ #33 SŌKATSU — keng ko'lamli sekin to'lqin (3 marta uradi)
      anim: "special2", damage: 62, pushback: 5.0, hitstun: 20, blockstun: 11,
      kind: "special", meterGain: 8, launch: 0,
      reach: 0, height: 1, from: "stand", projectile: "sokatsui",
    },
    // --- super ---
    bankai: {
      // ZENSHTIN — to'liq ekron to'lqin
      anim: "bankai", damage: 132, pushback: 10.0, hitstun: 34, blockstun: 16,
      kind: "super", meterGain: 0, launch: 0,
      reach: 0, height: 1, from: "stand", projectile: "sokatsui",
    },
  },
};

export const CHARS: Record<string, CharDef> = { ichigo, aizen };

export const CHAR_LIST = [ichigo, aizen];

/** Bankai (super) uchun kerakli meter. */
export const SUPER_COST = 100;

/** Combo ichidagi zarar ko'payishining kamayishi. */
export function comboScale(hits: number): number {
  if (hits <= 1) return 1;
  if (hits === 2) return 0.9;
  if (hits === 3) return 0.8;
  if (hits === 4) return 0.7;
  return 0.6;
}

export type { MoveDef };
