# ⚔️ BLEACH Spirit Clash

**Ichigo** va **Aizen** orasidagi 2D fight o'yin — Mortal Kombat uslubidagi
mexanikalar, Next.js + HTML5 Canvas, va to'liq **kod bilan chizilgan** grafika.

![Ichigo va Aizen](https://img.shields.io/badge/grafika-100%25-kod%20bilan%20chizilgan-F2802A)

---

## 🎮 Nimaga qodir?

| Mexanika | Holati |
|---|---|
| Yurish / sakrash / o'tirish / orqaga yurish | ✅ |
| Yengil, og'ir, tizaklash zarbalari | ✅ |
| Blok (orqaga qarama-tarifa), blok-stun, chip damage | ✅ |
| Kombinatsiyalar: `J → K → J` (3 zarba) | ✅ |
| Maxsus harakat + Projectile (Getsuga, Shakkahō, Sōkatsui) | ✅ |
| **Bankai** (100% meter) — Ichigo: Tensa Zangetsu, Aizen: Zenshin | ✅ |
| Yiqilish (knockdown) / turib qolish (get-up) | ✅ |
| Hit-stun, knockback, kombinatsiya hisoblagichi | ✅ |
| 2 raund, 99 soniya, taymer, K.O. / TIME UP | ✅ |
| AI bot — 4 ta qiyinlik darajasi | ✅ |
| 2 o'yinchi (bir klaviatura) | ✅ |
| **Online 1v1** (WebSocket orqali) | ✅ |
| Ekran titrashi, zarba effektlari, parallax arena | ✅ |

---

## 🕹️ Bosqaruv

### 1-o'yinchi
| Harakat | Tugma |
|---|---|
| Yurish | `A` / `D` |
| Sakrash | `W` |
| O'tirish | `S` |
| Yengil zarba | `J` |
| Og'ir zarba | `K` |
| Maxsus (turboq) | `L` |
| **BANKAI** | `I` |
| Blok | `A` yoki `D` (raqamni dushmanga qarama-tarifa ushlang) |

### 2-o'yinchi
| Harakat | Tugma |
|---|---|
| Yurish | `←` / `→` |
| Sakrash / o'tirish | `↑` / `↓` |
| Yengil | `Num 1` yoki `,` |
| Og'ir | `Num 2` yoki `.` |
| Maxsus | `Num 3` yoki `/` |
| **BANKAI** | `Num 4` yoki `;` |

> Pauza — `Esc` yoki `P`

---

## 🗡️ Belgilar

### ICHIGO (tez, yaqin masofa)
| Harakat | Nomi |
|---|---|
| `J` | Tez gorizontal kesim |
| `K` | Yuqoridan og'ir zarba |
| `J` → `J` | Tizaklash (havoga uring) |
| `L` | **Getsuga Tenshō** — chap qo'l bilan qizil to'lqin to'proq |
| `L` (ikki marta) | **Kessetsu: Shiba-Ori** — oldinga sakrab chuqur kesim |
| `I` (100%) | **TENSA ZANGETSU** — qora-gold aura, 3 zarbadan iborat combo |

### AIZEN (masofaviy, sekin)
| Harakat | Nomi |
|---|---|
| `J` | Ko'rsatkich nishoni |
| `K` | Kaft bilan to'qirash |
| `L` | **Hadō #31 Shakkahō** — tez, kichik portlab chiqadigan nishon |
| `L` (ikki marta) | **Hadō #33 Sōkatsui** — keng ko'lamli to'lqin, 3 marta uradi |
| `I` (100%) | **ZENSHTIN** — to'liq ekron to'lqin |

---

## 🏗️ Texnik jihat

### Grafika — 100% kod bilan
Hech qanday tashqi rasm ishlatilmagan. Barcha sprite'lar **Python + Pillow**
bilan generator skriptlarida chiziladi:

```
tools/rig.py        skelet (toshak) + rendering dvigateli
tools/gen_sprites.py  animatsiyalar, hitbox/hurtbox, sprite lentalari
tools/gen_stage.py    arena fonlari (parallax qatlamlari)
```

**Render texnologiyasi:**
1. **Skeletal animatsiya** — 20+ burchakli pozlar, kalit kadrlar orasida
   smoothstep interpolyatsiya
2. **3x supersampling** — SS=3 da chizilib LANCZOS bilan kichiklashtiriladi
   (chiziqlar tekis chiqadi)
3. **Cel-shading** — siluet siljitmasidan yorug'lik/soqirt chetlari
4. **Kontur (ink)** — siluetni kengaytirib ichkarisini olib tashlash
5. **Avtomatik yerga tushirish** — oyoq va tana yadrosi hisobga olinadi,
   shuning uchun yotgan belgi ham yerga tegadi
6. **PNG8 siqilish (256 rang)** — fayl hajmi 5 barobar kamayadi

Jami: **2 ta belgi × 24 animatsiya × ~128 kadr = 256 kadr**, 1.7 MB.

### Dvigatel
- **Fixed timestep 60 Hz** — barcha o'yinchi bir kadrga mos keladi
- **Kapsula-kapsula to'qnashuvi** (og'irlik) va kapsula-to'qnashuv (zarba)
- **Kiritish bufferi (9 kadr)** — kombinatsiyalar sezgir bo'ladi
- **Vaqt generator tomonidan hisoblanadi** — `startup`/`active`/`recovery`
  animatsiya kadrlaridan avtomatik chiqadi, shuning uchun zarba oynasi
  chizilgan animatsiya bilan **hech qachon mos kelmay qolmaydi**
- **Multi-hit super** — Bankai uchta alohida zarba oynasiga ega
- Determinik emas, lekin tarmoqlanishda **p1 = host** bo'lib butun
  simulyatsiyani yuritadi, shuning uchun desync bo'lmaydi

### Fayl tuzilmasi
```
src/
├─ app/
│  ├─ page.tsx          sahifa
│  ├─ GameScreen.tsx    menyu, belgi tanlash, HUD, tarmoq UI
│  ├─ layout.tsx        metadata
│  └─ globals.css
└─ game/
   ├─ types.ts          tiplar, o'lchamlar, tugmalar
   ├─ chars.ts          belgilar va ularning zarar/stun hisoblari
   ├─ fighter.ts        holat mashinasi + fizika + animatsiya
   ├─ match.ts          o'yin qoidalari, to'qnashuv, raundlar
   ├─ ai.ts             bot (4 qiyinlik)
   ├─ render.ts         canvas chizish (belgi, effekt, HUD, sahna)
   ├─ effects.ts        zarba/chang/to'lqin effektlari
   ├─ projectile.ts     turboqlar
   ├─ physics.ts        kapsula geometriyasi
   ├─ input.ts          klaviatura
   ├─ assets.ts         sprite/JSON yuklash
   └─ net/client.ts     WebSocket mijoz
server/                 onlayn 1v1 relay serveri (alohida npm paket)
tools/                  generator va tekshiruv skriptlari
```

---

## 🚀 Ishga tushirish

```bash
npm install
npm run dev          # http://localhost:3000
```

Sprite'lar allaqachon `public/assets` da tayyor. Qayta yaratish uchun
(Python 3.10+ va Pillow kerak):

```bash
npm run sprites      # barcha belgi animatsiyalari + hitbox
npm run stage        # arena fonlari
```

### Tekshiruvlar

```bash
npm test             # dvigatel testlari (25 ta, boshqarsiz)
npm run lint
npx tsc --noEmit
npm run check:render # brauzersiz render tekshiruvi -> preview/
```

`npm test` quyidagilarni tekshiradi: NaN/Infinity yo'qligi, zarba yetib
borishi, bloklash, projectile, Bankai, AI qarorlari, pushbox, raund/KO
mantiqi.

---

## 🌐 Online 1v1

Online o'yin uchun **relay server** kerak (Vercel serverless funksiyalarida
WebSocket ishlamaydi). Server `server/` papkasida alohida npm paket sifatida
yozilgan.

### Mahalliy / LAN
```bash
cd server
npm install
npm run dev            # ws://localhost:8787
```
Keyin o'yinda **ONLINE 1v1 → Xona yaratish**, do'stingiz esa shu kompyuterning
IP si bilan **Xona kiritish** (`ws://192.168.x.x:8787`).

### Render.com (bepul, 1 klik)
Repodagi `render.yaml` fayli mavjud:
1. Render'ga kirish → **New + Blueprint**
2. Repodani tanlash — Render `render.yaml` ni avtomatik o'qiydi
3. Deploy tugmasi

Deploy qilingandan keyin Vercel'da o'zgaruvchini qo'ying:
```
NEXT_PUBLIC_WS_URL=wss://<sizning-serviringiz>.onrender.com
```

> Render bepul rejasida 15 daqiqa harakatsizlikdan keyin "uxlaydi" —
> ulanish uzilishi mumkin. Do'stlar bilan tez-tez o'ynash uchun yetarli,
> barqarorlik uchun Render'da `$7/oy` to'lanadigan reja tavsiya qilinadi.

---

## 🔌 Netcode arxitekturasi

```
O'yinchi A (p1, host)          Relay server          O'yinchi B (p2)
   |                                |                     |
   |-- t:"create" ----------------->|                     |
   |<-- t:"joined" role:"p1" -------|                     |
   |                                |<-- t:"join" --------|
   |                                |-- t:"joined" ------->|
   |                                |<-- t:"peer" --------|
   |                                |                     |
   |  (p1 to'liq simulyatsiya)      |                     |
   |--- d:{k:"in", i:0, m:..} ----->|---- d:{k:"in"} --->|
   |--- d:{k:"snap", s:...} ------->|---- d:{k:"snap"} -->|
   |                                |                     |
```

Xabarlar server orqali **ko'chiriladi** (relay), server o'yin holatini
tushunmaydi — faqat xonalarni boshqaradi. p1 har 2 kadrda holatni yuboradi,
p2 esa kelgan holatni chizadi va o'z kiritishini yuboradi.

---

## 📄 Litsenziya

MIT. Barcha grafika, sprite'lar va arena kod bilan yaratilgan —
anime kadrlaridan hech qanday foydalanilmagan, shuning uchun mualliflik
huquqi muammosi yo'q.
