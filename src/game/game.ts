/**
 * game.ts — o'yin sikli, kamera, effektlar, tovush va tarmoq rejimini
 * bitta joyda bog'laydi.
 *
 * Rejimlar:
 *   "cpu"  — oddiy o'yinchi vs bot
 *   "p2"   — 2 o'yinchi bitta klaviatura
 *   "net"  — onlayn: p1 (host) yoki p2 (join)
 */

import { CHARS } from "./chars";
import { Ai, type AiLevel } from "./ai";
import { FxSystem } from "./effects";
import { InputManager } from "./input";
import { Match } from "./match";
import { clamp } from "./physics";
import {
  computeCamera, drawBanner, drawFx, drawFighter, drawHud, drawProjectiles,
  drawStage, type StageSet,
} from "./render";
import { VIEW_H, VIEW_W } from "./types";
import type { ButtonMask } from "./types";
import { NetClient, type NetRole, type NetStatus } from "./net/client";

export type GameMode = "menu" | "cpu" | "p2" | "net";

export interface GameOptions {
  canvas: HTMLCanvasElement;
  stage: StageSet | null;
}

export interface HudState {
  mode: GameMode;
  p1Name: string;
  p2Name: string;
  paused: boolean;
  netStatus: NetStatus;
  netRoom: string;
  netRole: NetRole | null;
  ping: number;
  fps: number;
  round: number;
  timer: number;
  meter: [number, number];
  health: [number, number];
  maxHealth: number;
  combo: [number, number];
  comboDamage: [number, number];
}

export class Game {
  readonly ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private stage: StageSet | null;

  mode: GameMode = "menu";
  match: Match | null = null;
  private input = new InputManager();
  private ai: [Ai | null, Ai | null] = [null, null];
  private fx = new FxSystem();
  private shake = 0;
  private hitStop = 0;
  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private running = false;
  paused = false;
  private timeMs = 0;
  private tickCount = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  // --- tarmoq ---
  net: NetClient | null = null;
  netRole: NetRole | null = null;
  ping = 0;
  onHud: ((s: HudState) => void) | null = null;
  onNetMessage: ((m: string) => void) | null = null;

  constructor(opts: GameOptions) {
    this.canvas = opts.canvas;
    this.stage = opts.stage;
    const c = opts.canvas.getContext("2d", { alpha: false });
    if (!c) throw new Error("Canvas 2D konteksti topilmadi");
    this.ctx = c;
    this.setupCanvas();
    this.input.attach();
    this.input.onPausePress(() => this.togglePause());
  }

  private setupCanvas() {
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
  }

  // -------------------------------------------------------------------------
  // Hayot sikli
  // -------------------------------------------------------------------------
  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
  }

  togglePause() {
    if (this.mode === "menu") return;
    this.paused = !this.paused;
  }

  // -------------------------------------------------------------------------
  // O'yinni boshlash
  // -------------------------------------------------------------------------
  startMatch(
    mode: GameMode,
    p1Char: string, p2Char: string,
    aiLevel: AiLevel = "normal", chars?: [Match["p1"]["data"], Match["p2"]["data"]],
    sprites?: [Match["p1"]["sprites"], Match["p2"]["sprites"]],
  ) {
    if (!chars || !sprites) return;
    this.mode = mode;
    this.paused = false;
    this.fx.clear();
    this.shake = 0;
    this.match = new Match(
      [CHARS[p1Char], CHARS[p2Char]],
      chars as never,
      sprites as never,
    );
    this.ai = [null, null];
    if (mode === "cpu") {
      // Bot har doim 2-orbinda bo'ladi
      const i = p1Char === p2Char ? 0 : 1;
      this.ai[i] = new Ai(aiLevel, 0x1234 + i * 77, "BOT");
    }
    this.match.startMatch();
    this.start();
  }

  // -------------------------------------------------------------------------
  // Tarmoq
  // -------------------------------------------------------------------------
  netCreate(p1Char: string, p2Char: string, chars: never, sprites: never) {
    this.mode = "net";
    this.paused = false;
    this.fx.clear();
    this.match = new Match(
      [CHARS[p1Char], CHARS[p2Char]], chars, sprites,
    );
    this.ai = [null, null];
    this.net = new NetClient(
      (role, status, room, ping) => {
        this.netRole = role;
        if (status === "ready" && this.match) this.match.startMatch();
        this.pushHud();
        void ping; void room;
      },
      (kind, payload) => this.onNet(kind, payload),
    );
    this.net.connect();
  }

  netJoin(room: string, p1Char: string, p2Char: string, chars: never, sprites: never) {
    this.mode = "net";
    this.paused = false;
    this.fx.clear();
    this.match = new Match(
      [CHARS[p1Char], CHARS[p2Char]], chars, sprites,
    );
    this.ai = [null, null];
    this.net = new NetClient(
      (role, status) => {
        this.netRole = role;
        if (status === "ready" && this.match) this.match.startMatch();
        this.pushHud();
      },
      (kind, payload) => this.onNet(kind, payload),
    );
    this.net.join(room.toUpperCase());
  }

  private remoteInput: [ButtonMask, ButtonMask] = [0, 0];

  private onNet(kind: string, payload: unknown) {
    if (!this.match) return;
    if (kind === "in") {
      const p = payload as { i: 0 | 1; m: number };
      this.remoteInput[p.i] = p.m;
      return;
    }
    if (kind === "snap") {
      // faqat p2 kelgan holatni qabul qilamiz (p1 — biz autoritet)
      if (this.netRole !== "p2") return;
      this.applySnap(payload);
      return;
    }
    if (kind === "start") {
      if (this.netRole === "p1") this.match.startMatch();
      return;
    }
    if (kind === "again") {
      if (this.netRole === "p1") this.match.startMatch();
      return;
    }
    if (kind === "sys") {
      this.onNetMessage?.(String((payload as { m: string }).m));
    }
  }

  /** p2 sifatida olingan holatni belgilarga qo'yish (chizish uchun). */
  private applySnap(payload: unknown) {
    const s = payload as import("./match").MatchSnap;
    const f = this.match!.p2;
    Object.assign(f, {
      x: s.p[1].x, y: s.p[1].y, vx: s.p[1].vx, vy: s.p[1].vy,
      facing: s.p[1].f, health: s.p[1].hp, meter: s.p[1].mp,
      state: s.p[1].st, anim: s.p[1].an, animFrame: s.p[1].fr,
      animTick: s.p[1].at, hitstun: s.p[1].hs, blockstun: s.p[1].bs,
      invuln: s.p[1].iv, comboHits: s.p[1].cv, comboDamage: s.p[1].dh,
      comboTimer: s.p[1].dc,
    });
    const a = this.match!.p1;
    a.health = s.p[0].hp;
    a.meter = s.p[0].mp;
    this.match!.timer = s.timer;
    this.match!.wins = s.wins;
    this.match!.phase = s.phase;
    this.match!.winner = s.winner;
    this.match!.projectiles.length = 0;
    for (const j of s.j) {
      this.match!.projectiles.push({
        id: j.i, kind: j.k as never, owner: j.o, x: j.x, y: j.y,
        vx: 0, vy: 0, life: 999, hitMask: 0, age: j.a, seed: 1,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Asosiy sikl
  // -------------------------------------------------------------------------
  private loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(64, now - this.lastTime);
    this.lastTime = now;
    this.timeMs += dt;

    // FPS
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.fps = Math.round(1000 / (this.fpsAcc / this.fpsFrames));
      this.fpsAcc = 0; this.fpsFrames = 0;
    }

    if (this.mode === "menu" || this.paused || !this.match) {
      this.renderIdle();
      this.pushHud();
      return;
    }

    // --- kiritish ---
    this.input.sample();
    let in0: ButtonMask = this.input.mask(0);
    let in1: ButtonMask = this.input.mask(1);
    // AI ni almashtiramiz
    if (this.ai[0]) in0 = this.ai[0].think(this.match.p1, this.match.p2, this.tickCount);
    if (this.ai[1]) in1 = this.ai[1].think(this.match.p2, this.match.p1, this.tickCount);

    if (this.netRole === "p1") {
      // biz autoritetmiz: o'z kiritishimiz + p2 dan kelgan
      this.sendInput(1, in0);
      in1 = this.remoteInput[1];
      this.acc += dt;
      this.pump(0, in0, in1);
      this.net?.sendState(this.match.snapshot());
    } else if (this.netRole === "p2") {
      // faqat o'z kiritishimizni yuboramiz, holatni server orqali olamiz
      this.sendInput(0, in0);
      in0 = in1 = 0;
      this.render();
      this.pushHud();
      return;
    } else {
      this.acc += dt;
      this.pump(0, in0, in1);
    }
    void in1;
  };

  private lastSendTick = 0;

  private sendInput(who: 0 | 1, mask: ButtonMask) {
    this.tickCount++;
    if (this.tickCount - this.lastSendTick >= 1) {
      this.lastSendTick = this.tickCount;
      this.net?.sendInput(who, mask);
    }
  }

  /** 60Hz simulyatsiya (fixed timestep). */
  private pump(_p: 0, in0: ButtonMask, in1: ButtonMask) {
    const STEP = 1000 / 60;
    let guard = 0;
    while (this.acc >= STEP && guard < 6) {
      this.acc -= STEP;
      guard++;
      if (this.hitStop > 0) { this.hitStop--; continue; }
      this.stepMatch(in0, in1);
    }
    this.render();
    this.pushHud();
  }

  private stepMatch(in0: ButtonMask, in1: ButtonMask) {
    const m = this.match!;
    const before: [number, number] = [m.p1.health, m.p2.health];
    m.step([in0, in1]);
    this.handleEvents(before);
    this.fx.update();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.055);
  }

  private handleEvents(before: [number, number]) {
    const m = this.match!;
    for (const e of m.events) {
      switch (e.type) {
        case "hit": {
          this.fx.burst(e.heavy ? "hitHeavy" : "hit", e.x, e.y, e.heavy ? 7 : 4, e.color);
          this.shake = Math.min(1.2, this.shake + (e.heavy ? 0.55 : 0.28));
          if (e.heavy) this.hitStop = 3;
          // yangi raund boshlandimi
          if (before[0] <= 0 || before[1] <= 0) {
            this.fx.spawn("ko", m.fighters[e.who].x, -170, "#FFFFFF", 1.4);
          }
          break;
        }
        case "block":
          this.fx.burst("block", e.x, e.y, 3);
          this.shake = Math.min(0.8, this.shake + 0.12);
          break;
        case "special":
          this.fx.spawn(e.heavy ? "bankai" : e.color === "#FF7A2A" ? "getsuga"
            : e.color === "#6E8BFF" ? "shakaho" : "sokatsui", e.x, e.y, e.color, 1);
          this.shake = Math.min(1, this.shake + 0.3);
          break;
        case "bankai":
          this.fx.spawn("bankai", e.x, e.y, e.color, 1.4);
          this.shake = Math.max(this.shake, 1.0);
          break;
        case "ko":
          this.fx.spawn("ko", e.x, e.y, "#FFFFFF", 1.5);
          this.shake = Math.max(this.shake, 1.2);
          break;
        case "round":
          this.fx.spawn("ring", e.x, e.y, "#FFFFFF", 1.6);
          break;
        case "match":
          this.net?.send("again", {});
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Chizish
  // -------------------------------------------------------------------------
  private renderIdle() {
    const ctx = this.ctx;
    ctx.fillStyle = "#0B0912";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.stage) {
      // menyu foni sekin siljiydi
      const camX = 400 + Math.sin(this.timeMs / 6000) * 700;
      const camY = -((VIEW_H - 60) / 0.82);
      drawStage(ctx, this.stage, camX, camY);
      ctx.fillStyle = "rgba(8,6,14,0.45)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  render() {
    const m = this.match;
    if (!m) { this.renderIdle(); return; }
    const ctx = this.ctx;
    const cam = computeCamera(m, this.shake, this.timeMs);

    ctx.fillStyle = "#0B0912";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.stage) drawStage(ctx, this.stage, cam.camX, cam.camY);

    drawFx(ctx, this.fx, 0, cam.camX, cam.camY, this.timeMs);

    // p1 va p2 ni chizamiz (p1 orqada emas — oddiy)
    const order = m.p1.x <= m.p2.x ? [m.p1, m.p2] : [m.p2, m.p1];
    for (const f of order) drawFighter(ctx, f, cam.camX, cam.camY, this.timeMs);

    drawProjectiles(ctx, m.projectiles, cam.camX, cam.camY, this.timeMs);
    drawFx(ctx, this.fx, 1, cam.camX, cam.camY, this.timeMs);

    drawHud(ctx, m, this.timeMs);
    drawBanner(ctx, m);

    if (this.netRole === "p2") {
      // tarmoq oraliq tasmasi
      ctx.save();
      ctx.fillStyle = this.ping > 120 ? "rgba(255,120,80,0.85)" : "rgba(120,255,180,0.8)";
      ctx.fillRect(VIEW_W - 116, VIEW_H - 26, 104, 18);
      ctx.fillStyle = "#0B0912";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`ONLINE ${this.ping}ms`, VIEW_W - 64, VIEW_H - 13);
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Holat -> React
  // -------------------------------------------------------------------------
  private hudTick = 0;

  private pushHud() {
    if (!this.onHud) return;
    if (this.hudTick++ % 3 !== 0) return; // 20Hz yetarli
    const m = this.match;
    this.onHud({
      mode: this.mode,
      p1Name: m ? m.p1.def.name : "—",
      p2Name: m ? m.p2.def.name : "—",
      paused: this.paused,
      netStatus: this.net?.status ?? "idle",
      netRoom: this.net?.room ?? "",
      netRole: this.netRole,
      ping: this.ping,
      fps: this.fps,
      round: m ? m.roundIndex + 1 : 1,
      timer: m ? m.timer : 99,
      meter: [m?.p1.meter ?? 0, m?.p2.meter ?? 0],
      health: [m?.p1.health ?? 1, m?.p2.health ?? 1],
      maxHealth: m?.p1.maxHealth ?? 1000,
      combo: [m?.p1.comboHits ?? 0, m?.p2.comboHits ?? 0],
      comboDamage: [m?.p1.comboDamage ?? 0, m?.p2.comboDamage ?? 0],
    });
  }

  setPing(p: number) { this.ping = p; }

  get inputRef() { return this.input; }
  setStage(s: StageSet | null) { this.stage = s; }
  get time() { return this.timeMs; }
  get tick() { return this.tickCount; }
  get clamp() { return clamp; }
}
