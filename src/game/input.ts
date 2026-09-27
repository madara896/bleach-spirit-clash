/**
 * input.ts — klaviatura kiritishi.
 *
 * Ikki o'yinchi bitta klaviatura bilan o'ynaydi:
 *   P1: A/D yurish, W sakrash, S o'tirish, J yengil, K og'ir, L maxsus, I Bankai
 *   P2: Strelkalar, Numpad 1/2/3/4  (NumPad yo'q bo'lsa , . / ' bilan almashtiriladi)
 */

import { BTN } from "./types";
import type { ButtonMask } from "./types";

export type PlayerScheme = "p1" | "p2" | "ai" | "net";

interface Scheme {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  lp: string[];
  hp: string[];
  sp: string[];
  bk: string[];
}

export const KEYMAP: Record<"p1" | "p2", Scheme> = {
  p1: {
    left: ["KeyA"],
    right: ["KeyD"],
    up: ["KeyW"],
    down: ["KeyS"],
    lp: ["KeyJ"],
    hp: ["KeyK"],
    sp: ["KeyL"],
    bk: ["KeyI", "KeyU"],
  },
  p2: {
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    lp: ["Numpad1", "Comma"],
    hp: ["Numpad2", "Period"],
    sp: ["Numpad3", "Slash"],
    bk: ["Numpad4", "Semicolon", "Quote"],
  },
};

export class InputManager {
  private down = new Set<string>();
  private masks: Record<0 | 1, ButtonMask> = { 0: 0, 1: 0 };
  /** oxirgi kadrda bosilgan tugmalar (bitta marta bosishni aniqlash uchun) */
  private prev: Record<0 | 1, ButtonMask> = { 0: 0, 1: 0 };
  private attached = false;
  private onPause: (() => void) | null = null;

  attach(target: Window = window) {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.code === "Escape" || e.code === "KeyP") this.onPause?.();
    });
    target.addEventListener("keyup", (e) => {
      this.down.delete(e.code);
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    target.addEventListener("blur", () => this.down.clear());
  }

  detach() {
    this.down.clear();
  }

  onPausePress(cb: () => void) {
    this.onPause = cb;
  }

  private any(codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  private schemeMask(s: Scheme): ButtonMask {
    let m = 0;
    if (this.any(s.left)) m |= BTN.LEFT;
    if (this.any(s.right)) m |= BTN.RIGHT;
    if (this.any(s.up)) m |= BTN.UP;
    if (this.any(s.down)) m |= BTN.DOWN;
    if (this.any(s.lp)) m |= BTN.LP;
    if (this.any(s.hp)) m |= BTN.HP;
    if (this.any(s.sp)) m |= BTN.SP;
    if (this.any(s.bk)) m |= BTN.BK;
    return m;
  }

  /** Har kadrda chaqiladi — tugmalar holatini yangilaydi. */
  sample() {
    for (const i of [0, 1] as const) {
      this.prev[i] = this.masks[i];
      this.masks[i] = this.schemeMask(KEYMAP[i === 0 ? "p1" : "p2"]);
    }
  }

  /** Faqat bitta tomon uchun (AI yoki tarmoq uchun override qilish mumkin). */
  setExternal(i: 0 | 1, mask: ButtonMask) {
    this.masks[i] = mask;
  }

  mask(i: 0 | 1): ButtonMask {
    return this.masks[i];
  }

  prevMask(i: 0 | 1): ButtonMask {
    return this.prev[i];
  }
}

const PREVENT = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
  "Numpad1", "Numpad2", "Numpad3", "Numpad4",
]);

export const KEY_HELP = [
  { p: "P1", rows: [
    ["Yurish", "A / D"], ["Sakrash", "W"], ["O'tirish", "S"],
    ["Yengil", "J"], ["Og'ir", "K"], ["Maxsus", "L"], ["BANKAI", "I"],
  ] },
  { p: "P2", rows: [
    ["Yurish", "← / →"], ["Sakrash", "↑"], ["O'tirish", "↓"],
    ["Yengil", "Num1 / ,"], ["Og'ir", "Num2 / ."],
    ["Maxsus", "Num3 / /"], ["BANKAI", "Num4 / ;"],
  ] },
];
