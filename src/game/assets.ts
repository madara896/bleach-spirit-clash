/**
 * assets.ts — sprite va fon rasmlarini yuklash.
 *
 * JSON metadata ham PNG'lar kabi `public/assets` ichidan `fetch` orqali
 * olinadi. Bu Next.js bundler'iga bog'liqlik qo'shmaydi va fayl o'zgarganda
 * qayta build talab qilmaydi.
 */

import type { CharData, SpriteBank } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Rasm yuklanmadi: ${src}`));
    img.src = src;
  });
}

async function loadJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Ma'lumot yuklanmadi: ${url}`);
  return (await r.json()) as T;
}

export interface LoadedChar {
  data: CharData;
  sprites: SpriteBank;
}

const charCache = new Map<string, Promise<LoadedChar>>();

/** Bitta belgining barcha animatsiya sprite'larini yuklaydi (kesh bilan). */
export function loadChar(key: string): Promise<LoadedChar> {
  const cached = charCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    const data = await loadJson<CharData>(`/assets/sprites/${key}.json`);
    const sprites: SpriteBank = {};
    await Promise.all(
      Object.entries(data.anims).map(async ([name, a]) => {
        sprites[name] = await loadImage(`/assets/sprites/${key}/${a.file}`);
      }),
    );
    return { data, sprites };
  })();
  charCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Sahna fonlari
// ---------------------------------------------------------------------------
export interface StageImages {
  sky: HTMLImageElement;
  far: HTMLImageElement;
  mid: HTMLImageElement;
  near: HTMLImageElement;
}

const STAGE_BASE = "/assets/stages/karakura";

/** Fon qatlamlarini yuklaydi; bittasi yo'q bo'lsa `null` qaytaradi. */
export async function loadStage(): Promise<StageImages | null> {
  const names = ["sky", "far", "mid", "near"] as const;
  const results = await Promise.allSettled(
    names.map((n) => loadImage(`${STAGE_BASE}/${n}.png`)),
  );
  const out: Partial<StageImages> = {};
  let ok = true;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[names[i]] = r.value;
    else ok = false;
  });
  return ok ? (out as StageImages) : null;
}
