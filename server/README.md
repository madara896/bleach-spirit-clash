# Bleach Fight — WebSocket relay server

2D urush o'yini uchun yengil **relay (o'zgartirish yetkazish) serveri**. Server o'yin
mantiqini bilmaydi: u faqat **xonalarni (room) boshqaradi** va o'yinchi xabarlarini
ikkinchi o'yinchiga yetkazib beradi.

- **1 ta runtime dependency:** `ws` (Express yo'q — HTTP uchun `node:http`).
- **Node 24**, **ESM** (`"type": "module"`), **TypeScript** (strict).
- Bu papka **alohida npm package**. U katta Next.js ilovasidan hech narsa import
  qilmaydi va uning `package.json`'iga tegilmaydi.

---

## 1. Nima qiladi?

| Server mas'uliyati | Mijoz (klient) mas'uliyati |
| --- | --- |
| Xona kodi yaratadi (`ABCD`) va `seed` beradi | O'yin simulyatsiyasini yuritadi |
| Ikki o'yinchi slotini boshqaradi | `p1` — **mualliflik (authoritative) host** |
| `relay` xabarlarini ikkinchisiga yetkazadi | `p2` — o'z kiritmalarini yuboradi |
| `peer` / `info` / `pong` xabarlarini yuboradi | Har bir kadr holatini `relay` orqali yuboradi |

> **Qoida:** `role: "p1"` — o'yin holatini yagona hisoblaydigan tomon. U har bir
> kadr holatini `relay` orqali yuboradi. `role: "p2"` — faqat o'z kiritmalarini
> (`relay`) yuboradi va `p1` holatini chizadi. Server hech qanday holatni
> tekshirmaydi, saqlamaydi va talqin qilmaydi — faqat yetkazadi.

---

## 2. Lokal ishga tushirish

```bash
cd server
npm install
npm run dev
```

Server `0.0.0.0:8787` manzilida ishga tushadi (`PORT` berilgan bo'lsa o'shandan
ishlatadi). Terminalda quyidagilar chiqadi:

```
listening :8787 rooms=0
ws connect id=1 clients=1
room KXPT created rooms=1
```

### Boshqa buyruqlar

| Buyruq | Vazifasi |
| --- | --- |
| `npm run dev` | `tsx watch` bilan ishlash (avtomatik reload) |
| `npm run build` | `tsc` orqali `dist/` ga kompilyatsiya qilish |
| `npm start` | `node dist/index.js` (production) |
| `npm run typecheck` | `tsc --noEmit` — faqat tekshirish |

### Tez tekshirish (2 ta terminal)

```bash
# Terminal 1 — server
npm run dev
```

```bash
# Terminal 2 — health check
curl http://localhost:8787/health
# {"ok":true,"rooms":0}
```

### Docker bilan

```bash
docker build -t bleach-fight-server ./server
docker run -e PORT=8787 -p 8787:8787 bleach-fight-server
```

---

## 3. Render ga bir tushish bilan deploy qilish

Loyihaning ildizida `render.yaml` fayli mavjud. U **free tier** web service'ini
to'liq tavsiflaydi.

1. Repozitoriyni GitHub'ga (yoki GitLab) yuklang.
2. Render ochiladi va shu havola kiritiladi:
   `https://render.com/deploy?repo=<SIZNING_REPO_URL>`
3. **Apply** bosing — Render xizmati avtomatik yaratiladi va o'rnatiladi.

Deploy tugagandan keyin:

| Nima | Manzil |
| --- | --- |
| Health check | `https://bleach-fight-server.onrender.com/health` |
| WebSocket | `wss://bleach-fight-server.onrender.com/` |
| Local (http) | `http://localhost:8787/` |
| Local (ws) | `ws://localhost:8787/` |

`render.yaml` qanday sozlanish:

| Kalit | Qiymat | Sababi |
| --- | --- | --- |
| `type` | `web` | Render'ning web-service turi |
| `runtime` | `node` | Node.js |
| `plan` | `free` | Bepul reja |
| `rootDir` | `server` | Server — alohida package |
| `buildCommand` | `npm install && npm run build` | `dist/` ga build |
| `startCommand` | `node dist/index.js` | Production ishga tushishi |
| `healthCheckPath` | `/health` | Render har bir deploy'dan keyin tekshiradi |
| `autoDeployTrigger` | `commit` | Har bir push'da avtomatik deploy |

### Muhit o'zgaruvchilari (env vars)

| O'zgaruvchi | Majburiy? | Tushuntirish |
| --- | --- | --- |
| `PORT` | Render beradi | Render web service'ga `PORT` ni **o'zi** beradi (masalan 10000) va uni band qiladi. `render.yaml` da faqat hujjat uchun ko'rsatilgan. Qo'lda o'zgartirmang. **Qo'yilmasa yoki bo'sh bo'lsa — server 8787-portni ishlatadi.** |
| `NODE_VERSION` | Render beradi | `24.19.0` — Node 24 versiyasini majburlaydi. |

Server `PORT` ni `Number.parseInt(...)` bilan o'qiydi; qiymat butun son bo'lmasa
yoki bo'lsa — `8787` ga qaytadi.

> ⚠️ **Free tier cheklovi:** Render'ning bepul rejasida xizmat 15 daqiqa
> jarayonlik faollikdan keyin **"uyquga" o'tadi** va keyin qayta ishga tushishi
> uchun ~1 daqiqa kerak bo'ladi. Bu vaqt ichida WebSocket uziladi. Klient
> **`{t:"ping",id}` → `{t:"pong",id}`** orqali uzilishni aniqlashi va
> qayta ulanishini (`reconnect`) talab qilishi mumkin.

---

## 4. Protokol

Barcha xabarlar — **JSON text frame** (`ws` orqali `JSON.stringify` natijasi).
Binary frame'lar server tomondan **jimgina tashlab yuboriladi**.

### Klient → Server

| Xabar | Toliq ko'rinishi | Izoh |
| --- | --- | --- |
| `create` | `{t:"create"}` | Xona yaratadi. Bu klient `p1` bo'ladi. |
| `join` | `{t:"join",room:"ABCD"}` | Xonaga qo'shiladi. Kod avtomatik `UPPER` qilinadi. |
| `leave` | `{t:"leave"}` | Joriy xonani tark etadi. |
| `relay` | `{t:"relay",d:{...}}` | `d` — **ixtiyoriy** JSON. Ikkinchi o'yinchiga yetkaziladi. |
| `ping` | `{t:"ping",id:1}` | `id` — son. RTT o'lchash uchun. |

### Server → Klient (javoblar)

| Xabar | Toliq ko'rinishi | Qachon |
| --- | --- | --- |
| `joined` | `{t:"joined",room:"ABCD",role:"p1",seed:123456}` | `create` yoki muvaffaqiyatli `join` dan keyin |
| `error` | `{t:"error",msg:"Xona topilmadi"}` | `join` xatosi |
| `relay` | `{t:"relay",from:"p1",d:{...}}` | Ikkinchi o'yinchi `relay` yuborganda |
| `pong` | `{t:"pong",id:1}` | `ping` ga javob (faqat yuborgan klientga) |
| `peer` | `{t:"peer",connected:true}` | Ikkinchi o'yinchi qo'shildi/chiqdi |
| `info` | `{t:"info",rooms:2}` | `join` da, xonada har 10 soniyada, xona yaratilganda/yo'q qilinganda |

> `joined` **har doim `room` maydonini** oladi. `error` xabari faqat `join`
> muvaffaqiyatsiz bo'lganda yuboriladi.
>
> `info` — **idempotent** holat xabari. Xona yaratilganda ham, `join` da ham
> yuborilishi mumkin, shuning uchun bir xil `{t:"info"}` bir necha marta
> kelishi mumkin. Klient uni har doim `rooms` ni to'liq qiymat bilan
> qabul qilishi kerak (increment emas).

#### `peer` xabari qachon yuboriladi?

- `{t:"peer",connected:true}` — ikkinchi o'yinchi xonaga **qo'shildi** da.
  Bu xabar **ikkalasiga** ham yuboriladi (ham yangi qo'shilgan, ham mavjud o'yinchi).
- `{t:"peer",connected:false}` — ikkinchi o'yinchi xonadan **chiqdi** da.
  Faqat qolgan o'yinchiga yuboriladi.
- Xona bo'sh holatda yaratilganda (`create`) `peer` xabari **yuborilmaydi**.
  Ya'ni `joined` dan keyin `peer:false` kutishingiz shart emas.

### Xatoliklar (`{t:"error",msg}`)

| `msg` | Sabab |
| --- | --- |
| `Xona topilmadi` | Xona kodi mavjud emas (yoki kod formati noto'g'ri: 4 ta `A–Z`, `I`/`O`siz). |
| `Xona to'ldi` | Xonada allaqachon 2 ta o'yinchi bor. |

### Oqim (p1/p2)

```
p1: {"t":"create"}                 ──▶  {"t":"joined","room":"KXPT","role":"p1","seed":...}
p2: {"t":"join","room":"KXPT"}     ──▶  {"t":"joined","room":"KXPT","role":"p2","seed":...}   (seed bir xil!)
                                   ◀── {"t":"peer","connected":true}   (p1 ga)
p2: {"t":"relay","d":{"x":1,"y":2}} ─▶  p1 ga: {"t":"relay","from":"p2","d":{"x":1,"y":2}}
p1: {"t":"relay","d":{"tick":60}}  ──▶  p2 ga: {"t":"relay","from":"p1","d":{"tick":60}}
p1: {"t":"ping","id":7}            ──▶  {"t":"pong","id":7}   (faqat p1 ga)
p2 uchlanadi / ketadi              ──▶  {"t":"peer","connected":false}  (p1 ga)
```

### Xonalar

| Qoida | Qiymat |
| --- | --- |
| Kod uzunligi | Aniq **4** ta katta `A–Z` harfi (`I` va `O` yo'q — `1`/`0` bilan aralashmasligi uchun; `0` va `1` harf bo'ligi uchun ishlatilmaydi) |
| Sig'imi | **2** ta klient. Uchinchi `join` → `Xona to'ldi` |
| `seed` | Xona yaratilganda **bir marta** `uint32` sifatida tanlanadi; ikkala o'yinchiga ham **bir xil** yuboriladi |
| Bo'sholgan xona | Oxirgi klient chiqqandan **10 daqiqa** keyin yo'q qilinadi (qayta ulanish imkoniyati uchun). Xonaga biror kirsa, timer bekor qilinadi |
| Xona tugashi | Ikkalasi ham chiqib ketgach darhol bo'sholgan holatga o'tadi va 10 daqiqa qolganida `destroy` qilinadi |

### Cheklovlar va himoya

| Himoya | Qiymat |
| --- | --- |
| Bitta kiruvchi xabar hajmi | **64 KB** dan katta bo'lsa — tashlanadi. Chegara `ws` darajasida qo'yilgan, shuning uchun bunday klient uzatiladi (close code `1009`) |
| `relay` chastotasi | **200 ta/soniya**, *suriluvchi oynada* (sliding window): istalgan 1 soniya ichida ko'pi bilan 200 ta. Ortig'i jimgina tashlanadi (klient xabar olmaydi) |
| Heartbeat | Har **20 soniyada** `ping`. Ikki marta javob bermasa — `terminate` |
| Xatoliklar | Har bir handler `try/catch` ichida; `uncaughtException` / `unhandledRejection` jarayonni o'ldirmaydi |
| Log | Har bir hodisa uchun **bitta qisqa qator** |

> **Rate limit haqida muhim:** bu *suriluvchi* oyna, ya'ni chegaradan keyingi
> 1 sekunda avvalgi 200 tadan qolgan xabarlar oynadan chiqadi va o'rniga yangi
> xabarlar o'tadi. Shuning uchun chegarani hech qachon "2 baravar oshish" hodisasi
> bo'lmaydi. O'yin uchun bu to'g'ri: `p1` bir sekundada 200 kadr holatini
> yetkazishi mumkin (60 FPS uchun juda yetarli).

### HTTP

Faqat bitta endpoint bor (CORS header'lari yo'q):

```http
GET /health
→ 200 {"ok":true,"rooms":2}
```

Boshqa barcha HTTP so'rovlar `404 {"ok":false,"error":"not_found"}` qaytaradi.
Qolgan barcha trafik — sof WebSocket.

---

## 5. Testlar uchun import qilish

`index.ts` fayli **faqat ishga tushirilgandagina** `listen()` chaqiradi, shuning
uchun uni xavfsiz import qilish mumkin:

```ts
import { createServer, ERRORS } from './index.js';

const relay = createServer({ log: () => {}, roomTtlMs: 50 });
const port = await relay.listen(0, '127.0.0.1'); // 0 = bo'sh port
console.log(relay.roomCount(), ERRORS.roomFull); // "Xona to'ldi"
await relay.close();
```

Mavjud imkoniyatlar: `createServer()`, `relay.listen(port?, host?)`,
`relay.close()`, `relay.roomCount()`, `relay.clientCount()`, `resolvePort()`,
`installProcessGuards()`, `ERRORS`, `Role`, `ClientMessage`, `ServerMessage`.
