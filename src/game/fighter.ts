/**
 * fighter.ts - bitta o'yinchi borasining to'liq logikasi.
 *
 * Har bir kadrda `update(input)` chaqiladi. Ichida:
 *   1. kiritish bufferi
 *   2. holat mashinasi (nima qilmoqda?)
 *   3. harakatni boshlash / davom ettirish
 *   4. fizika (tezlik, gravitatsiya, yerga tegish)
 *   5. animatsiya va kadr ma'lumotlari (hitbox/hurtbox/muzzle)
 */

import { CHARS, SUPER_COST } from "./chars";
import { clamp } from "./physics";
import {
  ANIM, BTN, SCALE, SPR_GROUND_Y, SPR_PELVIS_X, STAGE_W,
} from "./types";
import type {
  ButtonMask, CharData, CharDef, FighterState, MoveDef, MoveTiming, SpriteBank,
} from "./types";

/** Animatsiya ma'lumoti topilmasa ishlatiladigan zaxira vaqt. */
const FALLBACK_TIMING: MoveTiming = {
  startup: 2, active: 2, recovery: 6, total: 10, windows: [], spawn: -1,
};

/** Kiritish bufferi uzunligi (kadr) - kombinatsiyalar uchun. */
const BUFFER_LEN = 9;

export interface ActiveHit {
  /** sprite kadridagi kapsula (o'ngga qaragan holda) */
  cap: [number, number, number, number, number];
  move: MoveDef;
  /** bu oyna allaqachon ulanganmi */
  connected: boolean;
  id: number;
  /** zarba oynasi indeksi (ko'p urishli super uchun) */
  window: number;
}

export class Fighter {
  // --- koordinatalar ---
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;

  // --- holat ---
  state: FighterState = "idle";
  anim = "idle";
  animFrame = 0;
  animTick = 0;
  animDone = false;
  stateTick = 0;

  // --- o'lchovlar ---
  health: number;
  maxHealth: number;
  meter = 0;

  // --- jarohat / reaktsiya ---
  hitstun = 0;
  blockstun = 0;
  knockdownTicks = 0;
  invuln = 0;
  stunLock = false;

  // --- kiritish ---
  private buffer: ButtonMask[] = [];
  private held: ButtonMask = 0;
  private prev: ButtonMask = 0;

  // --- harakat ---
  move: MoveDef | null = null;
  moveName = "";
  moveTick = 0;
  /** qaysi zarba oynalari allaqachon ulangan (ko'p urishli super uchun) */
  private hitWindows = new Set<number>();
  chainIndex = -1;
  canCancel = false;

  // --- kombinatsiya ---
  comboHits = 0;
  comboDamage = 0;
  comboTimer = 0;

  // --- maxsus effektlar ---
  projectileSpawned = false;
  phaseSpawned = false;
  bankaiActive = false;

  // --- tasma / to'qnashuv ---
  pushboxW = 78;
  pushboxH = 300;

  // --- tashqi ma'lumot ---
  readonly def: CharDef;
  readonly data: CharData;
  readonly sprites: SpriteBank;
  /** tarmoq rejimida mi (bo'lsa, tasodifiy son ishlatilmaydi) */
  readonly index: 0 | 1;

  /** har kadrda renderer uchun */
  hitboxWorld: ActiveHit | null = null;
  lastFrameHit: number[] | null = null;
  lastFrameHurt: number[][] = [];

  constructor(
    def: CharDef, data: CharData, sprites: SpriteBank, index: 0 | 1,
  ) {
    this.def = def;
    this.data = data;
    this.sprites = sprites;
    this.index = index;
    this.health = def.health;
    this.maxHealth = def.health;
  }

  /** Uchdan-bir zarba oynasi allaqachon ulanganmi? */
  hasHitWindow(i: number): boolean {
    return this.hitWindows.has(i);
  }
  markHitWindow(i: number): void {
    this.hitWindows.add(i);
  }
  clearHitWindows(): void {
    this.hitWindows.clear();
  }

  // -------------------------------------------------------------------------
  // Yordamchilar
  // -------------------------------------------------------------------------
  get alive(): boolean {
    return this.health > 0;
  }

  get busy(): boolean {
    return this.move !== null || this.hitstun > 0 || this.blockstun > 0 ||
      this.state === "knockdown" || this.state === "getup" ||
      this.state === "bankai" || this.state === "ko" ||
      this.state === "intro" || this.state === "dash" ||
      this.state === "backdash";
  }

  get grounded(): boolean {
    return this.y <= 0.01;
  }

  get crouching(): boolean {
    return this.state === "crouch" || this.state === "block_crouch";
  }

  /** Sprite'ni qaysi joyga chizamiz (o'ng yuqori burchak, canvas px). */
  spriteOriginX(x: number): number {
    return x - SPR_PELVIS_X * SCALE;
  }
  spriteOriginY(y: number): number {
    return y - SPR_GROUND_Y * SCALE;
  }

  /**
   * Sprite kadridagi nuqtani o'yin o'zgartirilgan koordinataga o'tkazadi.
   *
   * O'yin o'qida `y` manfiy = tepa. Sprite o'qida esa 404 = yerga tegish.
   * Shuning uchun `+(sy - 404)` kerak: sprite 404 dan yuqorida bo'lsa
   * (sy < 404) natija manfiy bo'ladi - ya'ni tepa.
   */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.x + (sx - SPR_PELVIS_X) * SCALE * this.facing,
      y: this.y + (sy - SPR_GROUND_Y) * SCALE,
    };
  }

  /**
   * Joriy harakatning vaqti - animatsiya ma'lumotidan.
   * Generator shuni kadr davomiyliklaridan hisoblagan, shuning uchun
   * zarba oynasi chizilgan animatsiya bilan DOIM mos keladi.
   */
  get timing(): MoveTiming {
    const name = this.move?.anim ?? this.anim;
    const ad = this.data.anims[name];
    if (!ad) return FALLBACK_TIMING;
    return {
      startup: ad.startup,
      active: ad.active,
      recovery: ad.recovery,
      total: ad.total,
      windows: ad.windows ?? [],
      spawn: ad.spawn ?? -1,
    };
  }

  /** Kadr ma'lumotlari (hozirgi animatsiya + kadr). */
  get frame() {
    const a = this.data.anims[this.anim];
    if (!a) return null;
    const i = clamp(this.animFrame, 0, a.frames.length - 1);
    return a.frames[i];
  }

  get animData() {
    return this.data.anims[this.anim] ?? null;
  }

  /** Aniqlash uchun qulaylik. */
  private setAnim(name: string, reset = true) {
    if (this.anim === name && !reset) return;
    this.anim = name;
    this.animFrame = 0;
    this.animTick = 0;
    this.animDone = false;
  }

  private setState(s: FighterState, resetAnim = true) {
    this.state = s;
    this.stateTick = 0;
    const a = ANIM[s];
    if (a) this.setAnim(a, resetAnim);
  }

  // -------------------------------------------------------------------------
  // Kiritish
  // -------------------------------------------------------------------------
  /** Tarmoqlanish uchun: kiritishni tashqi tomondan berish. */
  setInput(mask: ButtonMask) {
    this.held = mask;
  }

  private push(mask: ButtonMask) {
    this.buffer.push(mask);
    if (this.buffer.length > BUFFER_LEN) this.buffer.shift();
  }

  /**
   * Hozirgi yoki yaqin o'tgan kadrlarda bosilgan tugma (kombinatsiya uchun).
   * `justPressed` faqat shu kadrni ko'radi; bu esa "bosildi va darhol
   * urishga kirish" o'rniga "bir-ikki kadr kechiktirilgan urish" imkonini beradi.
   */
  private pressedRecently(btn: number): number {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i] & btn) return this.buffer.length - 1 - i;
    }
    return -1;
  }

  /** Hozirgi kadrdagi "yangi bosilgan" tugmalar (bosib yuborilgan). */
  private justPressed(): ButtonMask {
    return this.held & ~this.prev;
  }

  // -------------------------------------------------------------------------
  // Harakatni boshlash
  // -------------------------------------------------------------------------
  private canStartMove(name: string): boolean {
    const m = this.def.moves[name];
    if (!m) return false;
    if (m.kind === "super" && this.meter < SUPER_COST) return false;
    if (m.from === "air" && this.grounded) return false;
    if (m.from !== "air" && !this.grounded) return false;
    return true;
  }

  startMove(name: string): boolean {
    if (!this.canStartMove(name)) return false;
    const m = this.def.moves[name];
    this.move = m;
    this.moveName = name;
    this.moveTick = 0;
    this.clearHitWindows();
    this.canCancel = false;
    this.projectileSpawned = false;
    this.phaseSpawned = false;
    this.chainIndex = name === "light" || name === "crouchLight" ? 0
      : name === "heavy" || name === "crouchHeavy" ? 1
        : name === "launcher" ? 2 : -1;
    if (m.kind === "super") {
      this.meter = 0;
      // super paytida dastlabki kadrlar himoyalangan
      this.invuln = Math.max(this.invuln, this.timing.startup + 3);
    }
    this.setAnim(m.anim);
    this.state = m.kind === "super" ? "bankai"
      : m.from === "air" ? "jump_fall" : "attack";
    this.stateTick = 0;
    return true;
  }

  /** Kombinatsiyani davom ettirish (LP/HP bosilganda). */
  private tryChain(): boolean {
    if (!this.move) return false;
    const m = this.move;
    if (!m.chains) return false;
    const t = this.timing;
    if (this.moveTick < t.startup + t.active + 2) return false;
    const jp = this.justPressed() | this.recentAttackBits();
    if (jp & BTN.HP) {
      if (this.startMove("heavy")) return true;
    }
    if (jp & BTN.LP) {
      if (this.startMove("launcher")) return true;
    }
    return false;
  }

  private canCancelChain(input: number): boolean {
    const jp = this.justPressed() | this.recentAttackBits();
    if (jp & BTN.SP) { this.startMove("special1"); return true; }
    if (jp & BTN.LP) { this.startMove("light"); return true; }
    if (input & BTN.UP && this.grounded) { this.jump(); return true; }
    return false;
  }

  /** So'nggi 2 kadr ichida bosilgan zarba tugmalari (kombinatsiya uchun). */
  private recentAttackBits(): ButtonMask {
    let m = 0;
    const win = 2;
    for (const b of [BTN.LP, BTN.HP, BTN.SP, BTN.BK]) {
      if (this.pressedRecently(b) >= 0 && this.pressedRecently(b) <= win) m |= b;
    }
    return m;
  }

  // -------------------------------------------------------------------------
  // Asosiy yangilanish
  // -------------------------------------------------------------------------
  update(input: number, opponent: Fighter) {
    // DIQQAT: `prev` o'tgan kadr kiritishini saqlaydi va `justPressed()`
    // shu bilan ishlaydi - shuning uchun u oxirida yangilanadi.
    this.held = input;
    this.push(input);
    this.stateTick++;

    // --- taymerlar ---
    if (this.hitstun > 0) this.hitstun--;
    if (this.blockstun > 0) this.blockstun--;
    if (this.invuln > 0) this.invuln--;
    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer === 0) { this.comboHits = 0; this.comboDamage = 0; }
    }

    // --- animatsiyani oldinga surish ---
    this.advanceAnim();

    // --- KO ---
    if (!this.alive) {
      if (this.state !== "ko" && this.state !== "victory") {
        this.move = null;
        this.setState("ko");
        this.vy = -6;
      }
    }

    switch (this.state) {
      case "intro": this.updateIntro(); break;
      case "ko": this.updateKO(); break;
      case "knockdown": this.updateKnockdown(); break;
      case "getup": this.updateGetup(input, opponent); break;
      case "hit_stand":
      case "hit_crouch": this.updateHit(input, opponent); break;
      case "block_stand":
      case "block_crouch": this.updateBlock(input, opponent); break;
      case "dash": this.updateDash(); break;
      case "backdash": this.updateBackdash(); break;
      case "bankai": this.updateMove(input, opponent); break;
      case "attack": this.updateMove(input, opponent); break;
      default: this.updateFree(input, opponent); break;
    }

    // --- fizika ---
    this.applyPhysics();

    // --- kadr ma'lumotlarini olish ---
    const f = this.frame;
    this.lastFrameHurt = f ? f.h : [];
    const hit = f?.a ?? null;
    this.lastFrameHit = hit;

    // Zarba faolligini ANIMATSIYA oynalari belgilaydi (generator hisoblagan).
    // Ko'p urishli superda har bir oyna alohida bir marta ishlaydi.
    this.hitboxWorld = null;
    this.hitWindowIndex = -1;
    if (this.move && hit) {
      const t = this.timing;
      for (let w = 0; w < t.windows.length; w++) {
        const [s, e] = t.windows[w];
        if (this.moveTick >= s && this.moveTick <= e) {
          if (this.hitWindows.has(w)) continue; // bu oyna allaqachon ulangan
          this.hitboxWorld = {
            cap: [hit[0], hit[1], hit[2], hit[3], hit[4]],
            move: this.move,
            connected: false,
            id: w,
            window: w,
          };
          this.hitWindowIndex = w;
          break;
        }
      }
    }

    // --- oxirida o'tgan kadrni eslab qolamiz ---
    this.prev = input;
  }

  /** Joriy kadrda faol bo'lgan zarba oynasi indeksi (-1 = yo'q). */
  hitWindowIndex = -1;

  private advanceAnim() {
    const a = this.animData;
    if (!a) return;
    const fr = a.frames[clamp(this.animFrame, 0, a.frames.length - 1)];
    this.animTick++;
    if (this.animTick >= (fr?.d ?? 6)) {
      this.animTick = 0;
      if (this.animFrame + 1 >= a.n) {
        if (a.loop) this.animFrame = 0;
        else { this.animFrame = a.n - 1; this.animDone = true; }
      } else {
        this.animFrame++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Holatlar
  // -------------------------------------------------------------------------
  private updateIntro() {
    this.vx *= 0.8;
  }

  private updateFree(input: number, opponent: Fighter) {
    if (this.move) { this.updateMove(input, opponent); return; }
    const air = !this.grounded;

    // --- blok (raqamni orqaga ushlab turish) ---
    const away = this.facing === 1 ? BTN.LEFT : BTN.RIGHT;
    if (!air && (input & away) && !(input & (BTN.LP | BTN.HP | BTN.SP | BTN.BK))) {
      this.setState("block_stand");
    }

    if (this.tryAction(input, opponent, air)) return;

    if (air) {
      // havoda
      this.setState(this.vy < 0 ? "jump_rise" : "jump_fall", false);
      this.vx += (input & BTN.RIGHT ? 1 : 0) * 0.22 - (input & BTN.LEFT ? 1 : 0) * 0.22;
      return;
    }

    if (this.state === "block_stand") {
      // blokdan chiqish
      if (!(input & away)) { this.move = null; this.setState("idle"); }
      return;
    }

    if (input & BTN.DOWN) { this.setState("crouch", false); this.vx *= 0.6; return; }
    if (this.state === "crouch" && !(input & BTN.DOWN)) { this.setState("idle"); }

    if (input & BTN.UP) { this.jump(); return; }

    const fwd = this.facing === 1 ? BTN.RIGHT : BTN.LEFT;
    const back = this.facing === 1 ? BTN.LEFT : BTN.RIGHT;
    if (input & fwd) {
      this.setState("walk_f", false);
      this.vx = this.def.walkSpeed * this.facing;
    } else if (input & back) {
      this.setState("walk_b", false);
      this.vx = -this.def.backSpeed * this.facing;
    } else {
      this.setState("idle", false);
      this.vx *= 0.72;
    }
  }

  private tryAction(input: number, opponent: Fighter, air: boolean): boolean {
    const jp = this.justPressed() |
      // buffer bilan: agar joriy kadrda ushlanib tursa, yaqinda bosilgan deb hisobla
      (this.pressedRecently(BTN.LP) >= 0 && this.pressedRecently(BTN.LP) <= 2 ? BTN.LP : 0) |
      (this.pressedRecently(BTN.HP) >= 0 && this.pressedRecently(BTN.HP) <= 2 ? BTN.HP : 0) |
      (this.pressedRecently(BTN.SP) >= 0 && this.pressedRecently(BTN.SP) <= 2 ? BTN.SP : 0) |
      (this.pressedRecently(BTN.BK) >= 0 && this.pressedRecently(BTN.BK) <= 2 ? BTN.BK : 0);
    if (!jp) return false;
    const chainable = !this.move;
    if (jp & BTN.BK) {
      if (this.startMove("bankai")) return true;
    }
    if (jp & BTN.SP) {
      const name = air ? "airHeavy" : "special1";
      if (this.startMove(name)) return true;
    }
    if (jp & BTN.HP) {
      if (air && this.startMove("airHeavy")) return true;
      if (!air && (input & BTN.DOWN) && this.startMove("crouchHeavy")) return true;
      if (!air && this.startMove("heavy")) return true;
    }
    if (jp & BTN.LP) {
      if (air && this.startMove("airLight")) return true;
      if (!air && (input & BTN.DOWN) && this.startMove("crouchLight")) return true;
      if (!air && chainable && this.startMove("light")) return true;
    }
    return false;
  }

  private updateMove(input: number, _opponent: Fighter) {
    if (!this.move) { this.setState(this.grounded ? "idle" : "jump_fall"); return; }
    const m = this.move;
    const t = this.timing;
    this.moveTick++;
    const dmgEnd = t.startup + t.active; // zarba faolligi tugagan nuqta

    // maxsus harakatning o'z tezligi
    if (this.grounded) {
      if (m.anim === "special2") {
        this.vx = 9.5 * this.facing;
      } else if (m.anim === "special1") {
        this.vx = 1.2 * this.facing;
      } else if (m.anim === "bankai") {
        // Bankai: 1-zarba oldinga, keyin kichik surish
        this.vx = this.moveTick < t.startup ? 0.8 * this.facing
          : this.moveTick < t.startup + 5 ? 7.5 * this.facing : 0.8 * this.facing;
      } else {
        this.vx *= 0.86;
      }
    }

    // projectile yaratish (aniq kadrda)
    if (m.projectile && !this.projectileSpawned && t.spawn >= 0 &&
        this.moveTick >= t.spawn) {
      this.projectileSpawned = true;
    }

    // kombinatsiya davom ettirish / bekor qilish
    if (this.moveTick >= dmgEnd) {
      if (this.tryChain()) return;
      if (this.canCancelChain(input)) return;
    }

    // tugash
    if (this.moveTick >= t.total) {
      this.move = null;
      if (!this.grounded) this.setState("jump_fall");
      else this.setState("idle");
    }
  }

  private updateBlock(input: number, opponent: Fighter) {
    if (this.tryAction(input, opponent, false)) return;
    const away = this.facing === 1 ? BTN.LEFT : BTN.RIGHT;
    if (!(input & away)) { this.setState("idle"); return; }
    if (input & BTN.DOWN) { this.setState("block_crouch", false); }
    else { this.setState("block_stand", false); }
    this.vx *= 0.7;
  }

  private updateHit(input: number, opponent: Fighter) {
    this.vx *= 0.86;
    const air = !this.grounded;
    // jarohat paytida kombinatsiya uchun urishga tayyorlik
    if (this.hitstun <= 0 && this.blockstun <= 0) {
      this.setState(this.grounded ? "idle" : "jump_fall");
      if (this.tryAction(input, opponent, air)) return;
    }
  }

  private updateKnockdown() {
    this.vx *= 0.9;
    if (this.grounded && this.vy <= 0) {
      this.knockdownTicks--;
      if (this.knockdownTicks <= 0) { this.setState("getup"); this.invuln = 6; }
    }
  }

  private updateGetup(input: number, opponent: Fighter) {
    this.vx *= 0.8;
    if (this.animDone) {
      this.invuln = Math.max(this.invuln, 4);
      this.setState("idle");
      this.tryAction(input, opponent, false);
    }
  }

  private updateKO() {
    this.vx *= 0.88;
    this.vy -= this.def.gravity;
    this.y += this.vy;
    if (this.y < 0) { this.y = 0; this.vy = 0; }
  }

  private updateDash() {
    this.vx = 13.5 * this.facing;
    if (this.animDone) { this.setState("idle"); this.vx *= 0.4; }
  }

  private updateBackdash() {
    this.vx = -11.0 * this.facing;
    this.invuln = Math.max(this.invuln, 4);
    if (this.animDone) { this.setState("idle"); this.vx *= 0.3; }
  }

  // -------------------------------------------------------------------------
  // Harakatlar
  // -------------------------------------------------------------------------
  jump() {
    if (!this.grounded) return;
    this.vy = this.def.jumpVel;
    this.y = 0.1;
    this.setState("jump_rise");
    this.move = null;
  }

  dash() {
    if (this.busy || !this.grounded) return;
    this.setState("dash");
    this.vx = 13.5 * this.facing;
  }

  backdash() {
    if (this.busy || !this.grounded) return;
    this.setState("backdash");
    this.vx = -11.0 * this.facing;
  }

  startSuper(): boolean {
    return this.startMove("bankai");
  }

  // -------------------------------------------------------------------------
  // Fizika
  // -------------------------------------------------------------------------
  private applyPhysics() {
    if (this.state === "ko" || this.state === "knockdown") {
      this.vy -= this.def.gravity;
      this.y += this.vy;
      if (this.y <= 0) {
        this.y = 0;
        if (this.vy < -1) { this.vy = 0; } else this.vy = 0;
      }
    } else if (this.state === "intro" || this.state === "victory") {
      this.vx *= 0.8;
    } else {
      if (!this.grounded) {
        this.vy -= this.def.gravity;
        this.y += this.vy;
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          if (this.state === "jump_fall" || this.state === "jump_rise") {
            this.setState("idle");
          }
        }
      }
      this.x += this.vx;
      // ziddiyat kuchini sekinlik
      if (this.grounded && this.state !== "walk_f" && this.state !== "walk_b" &&
          this.state !== "dash" && this.state !== "backdash") {
        this.vx *= 0.90;
      }
    }
    // sahifa chegarasi
    const half = this.pushboxW / 2;
    this.x = clamp(this.x, half, STAGE_W - half);
  }

  // -------------------------------------------------------------------------
  // Jarohat
  // -------------------------------------------------------------------------
  /** Zarba urildi. `blocked` - qarshi tomon bloklaganmi. */
  takeHit(
    dmg: number, hitstun: number, pushback: number, blocked: boolean,
    fromDir: number, launch: number, scale: number,
  ) {
    if (this.invuln > 0) return "miss";
    if (!blocked && this.state === "bankai" && this.invuln > 0) return "miss";
    const real = dmg * scale;
    this.health = Math.max(0, this.health - real);

    if (blocked) {
      this.blockstun = hitstun;
      this.vx = fromDir * pushback * 0.32;
      this.meter = clamp(this.meter + real * 0.10, 0, 100);
      this.move = null;
      this.setState(this.crouching || this.y < -20 ? "block_crouch" : "block_stand");
      return "block";
    }

    this.hitstun = hitstun;
    this.vx = fromDir * pushback;
    this.meter = clamp(this.meter + real * 0.14, 0, 100);
    this.move = null;
    this.comboHits = 0;
    this.comboDamage = 0;

    if (launch > 0) {
      this.vy = launch;
      this.y = Math.min(this.y, 0.1);
      this.setState("hit_stand");
    } else if (this.y < -30) {
      this.setState("hit_stand");
    } else {
      const low = (this.state as string) === "crouch" ||
        (this.state as string) === "block_crouch";
      this.setState(low ? "hit_crouch" : "hit_stand");
    }
    return "hit";
  }

  /** Yerda yiqilib ketish. */
  knockdown_(fromDir: number) {
    this.move = null;
    this.setState("knockdown");
    this.vy = -7.5;
    this.y = Math.max(this.y, 0.1);
    this.vx = fromDir * 6.5;
    this.hitstun = 0;
    this.knockdownTicks = 34;
    this.invuln = 0;
  }

  /** O'yin boshlanishida tiklash. */
  reset(x: number, facing: 1 | -1) {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.health = this.maxHealth;
    this.meter = 0;
    this.hitstun = 0;
    this.blockstun = 0;
    this.invuln = 0;
    this.move = null;
    this.comboHits = 0;
    this.comboDamage = 0;
    this.comboTimer = 0;
    this.buffer.length = 0;
    this.held = 0;
    this.prev = 0;
    this.setState("idle");
  }

  /** Tur boshlanishidan keyin "intro" holati. */
  setIntro() {
    this.setState("intro");
  }

  /** Match "FIGHT!" deb e'lon qilganda chaqiriladi. */
  releaseIntro() {
    if (this.state !== "intro") return;
    this.setState("idle");
  }

  /** Yutqan belgi uchun. */
  setVictory() {
    this.move = null;
    this.setState("victory");
  }

  /** Kameraga qarab yuzlanish (faqat erkin holatda). */
  faceTowards(ox: number) {
    if (this.hitstun > 0 || this.blockstun > 0) return;
    if (!this.grounded) return;
    const want: 1 | -1 = ox > this.x ? 1 : -1;
    if (want !== this.facing) this.facing = want;
  }
}

export { CHARS };
