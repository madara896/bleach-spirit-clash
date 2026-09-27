/**
 * simtest.ts — o'yin dvigatelining boshqarsiz (headless) sinovi.
 *
 * Ishga tushirish:  node tools/simtest.ts
 *
 * Tekshiriladiganlar:
 *   1. Modul yuklanadi, belgilar yaratiladi
 *   2. 60 soniya davomida turli kiritishlar bilan simulyatsiya
 *   3. NaN/ Infinity yo'qligi, sog'liq pasayishi, raundlar almashishi
 *   4. AI qarorlari va maxsus harakatlar ishlashi
 *   5. Ikkita belgi bir-biriga to'qnashganda pushback
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Match } from "../src/game/match";
import { Ai } from "../src/game/ai";
import { CHARS } from "../src/game/chars";
import { BTN } from "../src/game/types";
import type { CharData, SpriteBank } from "../src/game/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function loadData(key: string): CharData {
  return JSON.parse(
    readFileSync(join(ROOT, "public", "assets", "sprites", `${key}.json`), "utf8"),
  ) as CharData;
}

/** Sprite rasmi kerak emas — faqat o'lcham. */
const STUB: SpriteBank = {} as SpriteBank;

// ---------------------------------------------------------------------------
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  [OK]   ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    console.log(`  [FAIL] ${name}${extra ? ` — ${extra}` : ""}`);
    failed++;
  }
}

function isFiniteNum(n: number) {
  return Number.isFinite(n);
}

// ---------------------------------------------------------------------------
console.log("\n=== 1. Modul va ma'lumotlar ===");
const ichigoData = loadData("ichigo");
const aizenData = loadData("aizen");
check("ichigo.json yuklandi", ichigoData.anims.idle.n > 0, `${Object.keys(ichigoData.anims).length} animatsiya`);
check("aizen.json yuklandi", aizenData.anims.idle.n > 0);
check("hitbox ma'lumotlari bor", Array.isArray(ichigoData.anims.atk1.frames[2].a));
check("hurtbox ma'lumotlari bor", ichigoData.anims.idle.frames[0].h.length > 5,
  `${ichigoData.anims.idle.frames[0].h.length} kapsula`);
check("muzzle nuqtasi bor", ichigoData.anims.special1.frames[5].m.length === 2);

// ---------------------------------------------------------------------------
console.log("\n=== 2. Oddiy match: 60 soniya tasodifiy kiritish ===");
const m = new Match(
  [CHARS.ichigo, CHARS.aizen],
  [ichigoData, aizenData],
  [STUB, STUB],
);
m.startMatch();

let tick = 0;
let nanSeen = "";
let inputs: [number, number] = [0, 0];
const buttons = [BTN.LP, BTN.HP, BTN.SP, BTN.BK, BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN];

// kirish generatori (tasodifiy lekin qisqa "urish - qaytish" sikli)
let seq = 0x2f6e;
const rnd = () => {
  seq ^= seq << 13; seq >>>= 0;
  seq ^= seq >>> 17;
  seq ^= seq << 5; seq >>>= 0;
  return seq / 0x100000000;
};

for (let i = 0; i < 60 * 60; i++) {
  // har 12 kadrda yangi qaror
  if (i % 12 === 0) {
    const pick = () => {
      if (rnd() < 0.35) return 0;
      return buttons[Math.floor(rnd() * buttons.length)] | (rnd() < 0.3 ? buttons[Math.floor(rnd() * buttons.length)] : 0);
    };
    inputs = [pick(), pick()];
  }
  m.step(inputs);
  tick++;

  for (const f of m.fighters) {
    if (!isFiniteNum(f.x) || !isFiniteNum(f.y) || !isFiniteNum(f.vx) || !isFiniteNum(f.vy)) {
      nanSeen = `fighter#${f.index} x=${f.x} y=${f.y} vx=${f.vx} vy=${f.vy}`;
      break;
    }
    if (f.health < 0 || f.health > f.maxHealth) {
      nanSeen = `fighter#${f.index} health=${f.health}`;
      break;
    }
  }
  for (const p of m.projectiles) {
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) { nanSeen = `projectile x=${p.x} y=${p.y}`; break; }
  }
  if (nanSeen) break;
  // o'yin tugab ketsa qayta boshlaymiz
  if (m.phase === "matchEnd") { m.startMatch(); }
}

check("3600 kadr davomida NaN/Infinity yo'q", nanSeen === "", nanSeen || `${tick} kadr o'tdi`);
check("sog'liq pasaydi (zarba ishlaydi)",
  m.p1.health < m.p1.maxHealth || m.p2.health < m.p2.maxHealth,
  `p1=${Math.round(m.p1.health)} p2=${Math.round(m.p2.health)}`);
check("belgilar sahifada ushlab turibdi",
  m.p1.x > 0 && m.p1.x < 2400 && m.p2.x > 0 && m.p2.x < 2400,
  `p1=${Math.round(m.p1.x)} p2=${Math.round(m.p2.x)}`);

// ---------------------------------------------------------------------------
console.log("\n=== 3. To'qnashuv (bir-boriga yaqinlashtirish) ===");
const m2 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m2.startMatch();
// "FIGHT!" bosqichini o'tkazish
for (let i = 0; i < 100; i++) m2.step([0, 0]);
m2.p1.x = 1200; m2.p2.x = 1260;
// Ichigo yengil zarba beradi (BTN.LP)
m2.step([BTN.LP, 0]);
for (let i = 0; i < 14; i++) m2.step([0, 0]);
check("bloklashsiz urishda sog'liq kamaydi", m2.p2.health < m2.p2.maxHealth,
  `p2 = ${Math.round(m2.p2.health)}/${m2.p2.maxHealth}`);
check("kombinatsiya hisoblagichi ishladi", m2.p1.comboHits >= 1, `${m2.p1.comboHits} zarba`);
check("dushman jarohat holatiga o'tdi",
  m2.p2.hitstun > 0 || m2.p2.state.startsWith("hit") || m2.p2.state === "knockdown",
  `state=${m2.p2.state} hitstun=${m2.p2.hitstun}`);

// ---------------------------------------------------------------------------
console.log("\n=== 4. Bloklash ===");
const m3 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m3.startMatch();
for (let i = 0; i < 100; i++) m3.step([0, 0]);
m3.p1.x = 1200; m3.p2.x = 1250;
// p2 o'ng tomonda turib, ichkariga (LEFTga) qaragan -> orqasiga = RIGHT
for (let i = 0; i < 3; i++) m3.step([0, 0]);
m3.step([BTN.LP, BTN.RIGHT]);
for (let i = 0; i < 20; i++) m3.step([0, BTN.RIGHT]);
check("bloklanganda sog'liq kamroq kamayadi",
  m3.p2.health > m3.p2.maxHealth * 0.75,
  `p2 = ${Math.round(m3.p2.health)} (blok chip)`);
check("blok holati kirishdi",
  m3.p2.state === "block_stand" || m3.p2.state === "block_crouch" || m3.p2.blockstun > 0,
  `state=${m3.p2.state} facing=${m3.p2.facing}`);

// ---------------------------------------------------------------------------
console.log("\n=== 5. Maxsus harakat va projectile ===");
const m4 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m4.startMatch();
for (let i = 0; i < 100; i++) m4.step([0, 0]);
m4.p1.x = 1000; m4.p2.x = 1500;
m4.step([BTN.SP, 0]);
let projSeen = false;
for (let i = 0; i < 40; i++) {
  m4.step([0, 0]);
  if (m4.projectiles.length > 0) projSeen = true;
}
check("Getsuga Tenshō to'proq yaratildi", projSeen, `${m4.projectiles.length} ta to'proq qoldi`);

const m5 = new Match(
  [CHARS.aizen, CHARS.ichigo], [aizenData, ichigoData], [STUB, STUB],
);
m5.startMatch();
for (let i = 0; i < 100; i++) m5.step([0, 0]);
m5.p1.x = 1000; m5.p2.x = 1500;
m5.step([BTN.SP, 0]);
let sokaSeen = false;
for (let i = 0; i < 40; i++) { m5.step([0, 0]); if (m5.projectiles.length > 0) sokaSeen = true; }
check("Hadō to'proqi yaratildi", sokaSeen);

// ---------------------------------------------------------------------------
console.log("\n=== 6. Bankai (super) ===");
const m6 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m6.startMatch();
for (let i = 0; i < 100; i++) m6.step([0, 0]);
m6.p1.meter = 100;
m6.p1.x = 1000; m6.p2.x = 1200;
m6.step([BTN.BK, 0]);
check("Bankai boshlandi", m6.p1.state === "bankai", `state=${m6.p1.state}`);
check("Bankai meterni sarfladi", m6.p1.meter === 0, `meter=${m6.p1.meter}`);
let bankaiDamage = 0;
const hpBefore = m6.p2.health;
for (let i = 0; i < 60; i++) m6.step([0, 0]);
bankaiDamage = hpBefore - m6.p2.health;
check("Bankai zarar yetkazdi", bankaiDamage > 0, `${Math.round(bankaiDamage)} zarar`);

// meter yetishmasdan Bankai ishlamaydi
const m7 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m7.startMatch();
for (let i = 0; i < 100; i++) m7.step([0, 0]);
m7.p1.meter = 50;
m7.step([BTN.BK, 0]);
check("meter yetishmasdan Bankai bloklanadi", m7.p1.state !== "bankai", `state=${m7.p1.state}`);

// ---------------------------------------------------------------------------
console.log("\n=== 7. AI qarorlari ===");
const m8 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m8.startMatch();
const ai = new Ai("hard", 0xbeef, "BOT");
for (let i = 0; i < 100; i++) m8.step([0, 0]);
let aiActions = new Set<string>();
for (let i = 0; i < 60 * 30; i++) {
  const input = ai.think(m8.p2, m8.p1, i);
  m8.step([0, input]);
  if (m8.p2.move) aiActions.add(m8.p2.moveName);
  if (m8.p2.health <= 0) m8.startMatch();
}
check("AI turli harakatlarni ishlatdi", aiActions.size >= 3,
  `${aiActions.size} xil: ${[...aiActions].join(", ")}`);
check("AI o'zi ham urish olgan", m8.p1.health < m8.p1.maxHealth || m8.p2.health < m8.p2.maxHealth,
  `p1=${Math.round(m8.p1.health)} p2=${Math.round(m8.p2.health)}`);

// ---------------------------------------------------------------------------
console.log("\n=== 8. Pushbox (bir-birining ichiga kirmaslik) ===");
const m9 = new Match(
  [CHARS.ichigo, CHARS.ichigo], [ichigoData, ichigoData], [STUB, STUB],
);
m9.startMatch();
for (let i = 0; i < 100; i++) m9.step([0, 0]);
m9.p1.x = 1200; m9.p2.x = 1200;
for (let i = 0; i < 20; i++) m9.step([0, 0]);
check("belgilar ustma-ust tushmadi", Math.abs(m9.p2.x - m9.p1.x) > 40,
  `masofa = ${Math.round(Math.abs(m9.p2.x - m9.p1.x))}px`);

// devorda
m9.p1.x = 40; m9.p2.x = 40;
for (let i = 0; i < 30; i++) m9.step([0, 0]);
check("devorda chegaradan chiqilmaydi", m9.p1.x >= 0 && m9.p2.x <= 2400,
  `p1=${Math.round(m9.p1.x)} p2=${Math.round(m9.p2.x)}`);

// ---------------------------------------------------------------------------
console.log("\n=== 9. Round / KO mantiqi ===");
const m10 = new Match(
  [CHARS.ichigo, CHARS.aizen], [ichigoData, aizenData], [STUB, STUB],
);
m10.startMatch();
for (let i = 0; i < 100; i++) m10.step([0, 0]);
m10.p2.health = 1;
m10.p1.x = 1100; m10.p2.x = 1170;
m10.step([BTN.HP, 0]);
// og'ir zarbaning startup'i ~16 kadr, faollik 15 kadr
for (let i = 0; i < 45; i++) m10.step([0, 0]);
check("KO aniqlandi", m10.phase === "ko" || m10.phase === "roundEnd",
  `phase=${m10.phase} p2hp=${Math.round(m10.p2.health)}`);
check("g'oliba hisoblandi", m10.wins[0] >= 1, `wins=${m10.wins.join(":")}`);
// 2-raxmoni ham tugatamiz: har raundda p2 sog'ligini 1 ga tushiramiz
// va Ichigo og'ir zarba beradi.
for (let i = 0; i < 60 * 40; i++) {
  if (m10.phase === "fight") {
    m10.p2.health = 1;
    m10.p1.x = m10.p2.x - 120;
    m10.step([BTN.HP, 0]);
  } else {
    m10.step([0, 0]);
  }
  if (m10.phase === "matchEnd") break;
}
check("match yakunlandi (2 raund)", m10.wins[0] === 2,
  `wins=${m10.wins.join(":")} phase=${m10.phase}`);

// ---------------------------------------------------------------------------
console.log(`\n${failed === 0 ? "BARCHASI O'TDI" : `${failed} TA TEST YIQILDI`}`);
console.log("=".repeat(50));
process.exit(failed === 0 ? 0 : 1);
