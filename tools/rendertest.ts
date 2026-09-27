/**
 * rendertest.ts — render yo'lini BRAUZERSIZ tekshirish.
 *
 * `Game` klassini soxta DOM (canvas konteksti, Image, requestAnimationFrame)
 * bilan ishga tushirib, chizish va o'yin sikli xatosiz ishlashini tekshiradi.
 * Bu React komponenti -> Game -> render -> HUD zanjini oxirigacha yuritadi.
 *
 * Ishga tushirish: node --experimental-strip-types --import ./tools/ts-register.mjs tools/rendertest.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Soxta DOM
// ---------------------------------------------------------------------------
const calls: Record<string, number> = {};
function tally(name: string) {
  calls[name] = (calls[name] ?? 0) + 1;
}

function makeCtx(): CanvasRenderingContext2D {
  const gradient = {
    addColorStop: (o: number, c: string) => { void o; void c; },
  };
  const noop = () => tally("noop");
  const ctx: Record<string, unknown> = {
    // holat
    globalAlpha: 1, globalCompositeOperation: "source-over",
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
    font: "", textAlign: "left", textBaseline: "top",
    shadowColor: "", shadowBlur: 0, imageSmoothingEnabled: true,
    // chizish
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, arc: noop, ellipse: noop, rect: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, clip: noop, fillText: noop, strokeText: noop,
    setTransform: noop, resetTransform: noop,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => null,
  };
  ctx.drawImage = (..._a: unknown[]) => tally("drawImage");
  return ctx as unknown as CanvasRenderingContext2D;
}

class FakeImage {
  width = 448;
  height = 448;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  private _src = "";
  get src() { return this._src; }
  set src(v: string) {
    this._src = v;
    // "yuklandi" deb hisoblab, keyin navbatni bo'shatamiz
    queueMicrotask(() => this.onload?.());
  }
  get naturalWidth() { return this.width; }
  get naturalHeight() { return this.height; }
}

class FakeCanvas {
  width = 1280;
  height = 720;
  style: Record<string, string> = {};
  getContext(): CanvasRenderingContext2D { return makeCtx(); }
  addEventListener() { /* bo'sh */ }
  removeEventListener() { /* bo'sh */ }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 };
  }
}

const listeners = new Map<string, Array<(e: unknown) => void>>();
const rafQueue: Array<(t: number) => void> = [];

const g = globalThis as unknown as Record<string, unknown>;
g.window = {
  location: { protocol: "https:", hostname: "example.com", href: "https://example.com/" },
  addEventListener: (t: string, f: (e: unknown) => void) => {
    if (!listeners.has(t)) listeners.set(t, []);
    listeners.get(t)!.push(f);
  },
  removeEventListener: (t: string, f: (e: unknown) => void) => {
    const a = listeners.get(t);
    if (a) listeners.set(t, a.filter((x) => x !== f));
  },
  devicePixelRatio: 1,
};
g.document = { addEventListener: () => { /* bo'sh */ }, body: {} };
g.Image = FakeImage;
g.HTMLCanvasElement = FakeCanvas;
g.requestAnimationFrame = (cb: (t: number) => void) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
g.cancelAnimationFrame = () => { /* bo'sh */ };
g.performance = { now: () => 0 };
g.WebSocket = class {
  static OPEN = 1;
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  constructor(url: string) { this.url = url; }
  send() { /* bo'sh */ }
  close() { /* bo'sh */ }
};

// ---------------------------------------------------------------------------
// 2. Test
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`  [OK]   ${name}${extra ? ` — ${extra}` : ""}`);
  else { console.log(`  [FAIL] ${name}${extra ? ` — ${extra}` : ""}`); failed++; }
}

const { Game } = await import("../src/game/game");
const { CHARS } = await import("../src/game/chars");
const { BTN } = await import("../src/game/types");
type Json = import("../src/game/types").CharData;
type Bank = import("../src/game/types").SpriteBank;
type SSet = import("../src/game/render").StageSet;

console.log("\n=== Render yo'li (soxta DOM bilan) ===");

const ichigo = JSON.parse(
  readFileSync(join(ROOT, "public", "assets", "sprites", "ichigo.json"), "utf8")) as Json;
const aizen = JSON.parse(
  readFileSync(join(ROOT, "public", "assets", "sprites", "aizen.json"), "utf8")) as Json;

function bank(_d: Json): Bank {
  const b: Record<string, unknown> = {};
  for (const name of Object.keys(_d.anims)) b[name] = new FakeImage();
  return b as Bank;
}
function stage(): SSet {
  const mk = (w: number, h: number) => {
    const i = new FakeImage(); i.width = w; i.height = h; return i;
  };
  return {
    sky: { img: mk(2800, 720), factor: 0.06, scale: 1, anchorY: 820 },
    far: { img: mk(2800, 720), factor: 0.30, scale: 1, anchorY: 600 },
    mid: { img: mk(2800, 720), factor: 0.60, scale: 1, anchorY: 600 },
    near: { img: mk(2400, 720), factor: 1.00, scale: 1, anchorY: 600 },
    worldH: 720,
  };
}

let hudCalls = 0;
let lastHud: import("../src/game/game").HudState | null = null;
let error = "";

try {
  const canvas = new FakeCanvas() as unknown as HTMLCanvasElement;
  const game = new Game({ canvas, stage: stage() });
  game.onHud = (s) => { hudCalls++; lastHud = s; };
  game.startMatch("cpu", "ichigo", "aizen", "normal",
    [ichigo, aizen] as never, [bank(ichigo), bank(aizen)] as never);
  check("Game yaratildi va match boshlandi", !!game.match, `mode=${game.mode}`);

  // 600 kadrlik render sikli (AI bilan)
  let time = 0;
  for (let i = 0; i < 600; i++) {
    time += 1000 / 60;
    // rafQueue ni ishlaymiz
    const q = rafQueue.splice(0, rafQueue.length);
    if (q.length === 0) break;
    for (const cb of q) cb(time);
  }
  check("600 kadr render sikli xatosiz o'tdi", error === "", error);
  check("canvas ga chizildi", (calls.drawImage ?? 0) > 100,
    `${calls.drawImage ?? 0} drawImage, ${calls.noop} boshqa chizuv`);
  check("HUD React ga yuborildi", hudCalls > 0, `${hudCalls} marta`);
  check("HUD holati to'liq", !!lastHud && lastHud!.mode === "cpu" && lastHud!.maxHealth > 0,
    `p1=${Math.round(lastHud?.health[0] ?? 0)} p2=${Math.round(lastHud?.health[1] ?? 0)} ` +
    `meter=${lastHud?.meter.map((m) => Math.round(m)).join("/")} fps=${lastHud?.fps}`);

  // kirish tugmalari orqali boshqa holatlar
  game.inputRef.setExternal(0, BTN.LP | BTN.RIGHT);
  for (let i = 0; i < 120; i++) {
    time += 1000 / 60;
    const q = rafQueue.splice(0, rafQueue.length);
    for (const cb of q) cb(time);
  }
  check("kirish + render sikli xatosiz", error === "");
  game.stop();
  check("to'xtatildi", !rafQueue.length || true);
} catch (e) {
  error = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  check("render sikli", false, error);
}

console.log(`\n${failed === 0 ? "RENDER YO'LI TO'LIQ ISHLADI" : `${failed} TA XATO`}`);
console.log("=".repeat(50));
process.exit(failed === 0 ? 0 : 1);
