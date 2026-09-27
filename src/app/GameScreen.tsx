"use client";

/**
 * GameScreen.tsx — o'yin canvas'i va barcha UI (menyu, tanlov, tarmoq).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Game, type HudState } from "../game/game";
import type { StageSet } from "../game/render";
import { loadChar, loadStage } from "../game/assets";
import { CHAR_LIST } from "../game/chars";
import { AI_LEVELS, type AiLevel } from "../game/ai";
import { VIEW_H, VIEW_W } from "../game/types";
import { KEY_HELP } from "../game/input";

type Screen = "menu" | "chars" | "online" | "help" | "loading" | "game";

const AI_LABEL: Record<AiLevel, string> = {
  easy: "Ongina", normal: "O'rtacha", hard: "Qiyin", expert: "Expert",
};

export default function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [hud, setHud] = useState<HudState | null>(null);
  const [p1Char, setP1Char] = useState("ichigo");
  const [p2Char, setP2Char] = useState("aizen");
  const [aiLevel, setAiLevel] = useState<AiLevel>("normal");
  const [room, setRoom] = useState("");
  const [netMsg, setNetMsg] = useState("");
  const [loadingText, setLoadingText] = useState("Yuklanmoqda...");
  const [assets, setAssets] = useState<{
    ichigo: Awaited<ReturnType<typeof loadChar>>;
    aizen: Awaited<ReturnType<typeof loadChar>>;
    stage: StageSet | null;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Yuklash
  // -------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingText("Ichigo yuklanmoqda...");
      const ichigo = await loadChar("ichigo");
      if (!alive) return;
      setLoadingText("Aizen yuklanmoqda...");
      const aizen = await loadChar("aizen");
      if (!alive) return;
      setLoadingText("Arena yuklanmoqda...");
      const imgs = await loadStage();
      if (!alive) return;
      const stage: StageSet | null = imgs
        ? {
          // Osmon butun ekranni qoplashi uchun anchorY katta (rasm tepasidan
          // yuqoriga chiqib ketadi) — gradient bo'lgani uchun bu sezilmaydi.
          sky: { img: imgs.sky, factor: 0.06, scale: 1.0, anchorY: 820 },
          far: { img: imgs.far, factor: 0.30, scale: 1.0, anchorY: 600 },
          mid: { img: imgs.mid, factor: 0.60, scale: 1.0, anchorY: 600 },
          near: { img: imgs.near, factor: 1.00, scale: 1.0, anchorY: 600 },
          worldH: 720,
        }
        : null;
      setAssets({ ichigo, aizen, stage });
      setScreen("menu");
    })().catch((e) => {
      if (alive) {
        setNetMsg(`Yuklashda xatolik: ${e instanceof Error ? e.message : e}`);
        setScreen("menu");
      }
    });
    return () => { alive = false; };
  }, []);

  // -------------------------------------------------------------------------
  // Game obyektini yaratish
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!canvasRef.current || !assets) return;
    let g: Game;
    try {
      g = new Game({ canvas: canvasRef.current, stage: assets.stage });
    } catch {
      return;
    }
    gameRef.current = g;
    g.onHud = (s) => setHud(s);
    g.onNetMessage = (m) => setNetMsg(m);
    g.start();
    return () => { g.stop(); gameRef.current = null; };
  }, [assets]);

  // -------------------------------------------------------------------------
  // O'yinni boshlash
  // -------------------------------------------------------------------------
  const beginLocal = useCallback((mode: "cpu" | "p2") => {
    const g = gameRef.current;
    if (!g || !assets) return;
    g.startMatch(
      mode, p1Char, p2Char, aiLevel,
      [assets[p1Char as "ichigo" | "aizen"].data, assets[p2Char as "ichigo" | "aizen"].data],
      [assets[p1Char as "ichigo" | "aizen"].sprites, assets[p2Char as "ichigo" | "aizen"].sprites],
    );
    setScreen("game");
  }, [assets, p1Char, p2Char, aiLevel]);

  const beginOnline = useCallback((create: boolean) => {
    const g = gameRef.current;
    if (!g || !assets) return;
    const a = assets[p1Char as "ichigo" | "aizen"];
    const b = assets[p2Char as "ichigo" | "aizen"];
    setNetMsg("");
    if (create) g.netCreate(p1Char, p2Char, [a.data, b.data] as never, [a.sprites, b.sprites] as never);
    else if (room.trim().length === 4) g.netJoin(room.trim(), p1Char, p2Char, [a.data, b.data] as never, [a.sprites, b.sprites] as never);
    else setNetMsg("Xona kodi 4 ta harfdan iborat bo'lishi kerak");
    setScreen("game");
  }, [assets, p1Char, p2Char, room]);

  const backToMenu = useCallback(() => {
    const g = gameRef.current;
    g?.net?.disconnect();
    g?.stop();
    g?.start();
    setScreen("menu");
  }, []);

  // -------------------------------------------------------------------------
  // Klaviatura: Escape — orqaga
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && screen === "game") {
        const g = gameRef.current;
        if (g && g.mode === "net") { backToMenu(); return; }
        g?.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, backToMenu]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-dvh bg-[#0B0912] text-white flex flex-col items-center justify-center py-4 px-3 font-sans">
      <div className="w-full max-w-6xl">
        {/* Sarlavha */}
        <div className="flex items-end justify-between mb-3 px-1">
          <h1
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={{
              background: "linear-gradient(90deg,#F2802A,#FFD08A 45%,#7C6BE8)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            BLEACH <span className="text-white/80">· SPIRIT CLASH</span>
          </h1>
          {hud && screen === "game" && (
            <div className="text-[11px] text-white/40 font-mono">
              {hud.fps} FPS
              {hud.mode === "net" && hud.netStatus === "ready" && ` · ${hud.ping}ms`}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden ring-1 ring-white/10 bg-black shadow-2xl">
          <canvas
            ref={canvasRef}
            width={VIEW_W}
            height={VIEW_H}
            className="absolute inset-0 w-full h-full block"
            style={{ imageRendering: "auto" }}
          />

          {/* Ekran qatlami */}
          {screen === "loading" && (
            <Overlay>
              <div className="text-center">
                <div className="text-4xl font-black mb-3 text-orange-400">BLEACH</div>
                <div className="text-white/60 animate-pulse">{loadingText}</div>
              </div>
            </Overlay>
          )}

          {screen === "menu" && (
            <Overlay>
              <Menu
                onCpu={() => setScreen("chars")}
                onP2={() => { setP2Char(p1Char === "ichigo" ? "aizen" : "ichigo"); beginLocal("p2"); }}
                onOnline={() => setScreen("online")}
                onHelp={() => setScreen("help")}
                hasStage={!!assets?.stage}
              />
            </Overlay>
          )}

          {screen === "chars" && (
            <Overlay>
              <CharSelect
                p1={p1Char} setP1={setP1Char}
                p2={p2Char} setP2={setP2Char}
                aiLevel={aiLevel} setAi={setAiLevel}
                onStart={() => beginLocal("cpu")}
                onBack={() => setScreen("menu")}
              />
            </Overlay>
          )}

          {screen === "online" && (
            <Overlay>
              <div className="w-full max-w-md bg-black/70 rounded-2xl p-6 ring-1 ring-white/10">
                <h2 className="text-xl font-bold mb-1">ONLINE 1v1</h2>
                <p className="text-xs text-white/50 mb-4">
                  Do&apos;stingiz bilan internet orqali o&apos;ynash. U xona yaratadi,
                  siz uning 4 harfli kodini kiritasiz.
                </p>
                {netMsg && (
                  <div className="text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded px-3 py-2 mb-3">
                    {netMsg}
                  </div>
                )}
                <button
                  className="w-full mb-2 bg-orange-600 hover:bg-orange-500 py-3 rounded-lg font-bold"
                  onClick={() => beginOnline(true)}
                >
                  Xona yaratish
                </button>
                <div className="flex gap-2 mt-2">
                  <input
                    value={room}
                    onChange={(e) => setRoom(e.target.value.toUpperCase().slice(0, 4))}
                    placeholder="XONA"
                    maxLength={4}
                    className="flex-1 bg-white/10 rounded-lg px-4 py-3 text-center text-xl font-black tracking-[0.3em] uppercase outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    className="px-5 bg-violet-600 hover:bg-violet-500 rounded-lg font-bold"
                    onClick={() => beginOnline(false)}
                  >
                    Kirish
                  </button>
                </div>
                <p className="text-[10px] text-white/35 mt-3">
                  Server: <code className="text-white/55">NEXT_PUBLIC_WS_URL</code> yoki
                  {" "}<code className="text-white/55">ws://localhost:8787</code>
                </p>
                <BackButton onBack={() => setScreen("menu")} />
              </div>
            </Overlay>
          )}

          {screen === "help" && (
            <Overlay>
              <div className="w-full max-w-2xl bg-black/70 rounded-2xl p-6 ring-1 ring-white/10">
                <h2 className="text-xl font-bold mb-4">BOSHQARUV</h2>
                <div className="grid sm:grid-cols-2 gap-5">
                  {KEY_HELP.map((p) => (
                    <div key={p.p} className="bg-white/5 rounded-xl p-4">
                      <div className="font-black text-lg mb-2 text-orange-400">{p.p}</div>
                      <table className="w-full text-sm">
                        <tbody>
                          {p.rows.map(([k, v]) => (
                            <tr key={k} className="border-b border-white/5 last:border-0">
                              <td className="py-1 text-white/60">{k}</td>
                              <td className="py-1 text-right font-mono font-bold">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-white/50 mt-4 space-y-1">
                  <p><b>Blok:</b> raqamni dushmanga qarama-tarifa ushlang.</p>
                  <p><b>Kombinatsiya:</b> J → K → I (yengil → og&apos;ir → tizaklash).</p>
                  <p><b>Bankai:</b> meter 100% bo&apos;lganda <b>I</b> (P1) / <b>Num4</b> (P2).</p>
                  <p><b>Maxsus:</b> L (P1) / Num3 (P2) — masofaviy turboq.</p>
                </div>
                <BackButton onBack={() => setScreen("menu")} />
              </div>
            </Overlay>
          )}

          {screen === "game" && hud && (
            <>
              {/* Pauza */}
              {hud.paused && hud.mode !== "net" && (
                <Overlay>
                  <div className="text-center">
                    <div className="text-5xl font-black mb-4">PAUZA</div>
                    <button
                      className="bg-orange-600 hover:bg-orange-500 px-8 py-3 rounded-lg font-bold"
                      onClick={() => gameRef.current?.togglePause()}
                    >
                      Davom etish
                    </button>
                    <button
                      className="ml-2 bg-white/10 hover:bg-white/20 px-6 py-3 rounded-lg"
                      onClick={backToMenu}
                    >
                      Menyuga
                    </button>
                  </div>
                </Overlay>
              )}

              {/* Tarmoq holati */}
              {hud.mode === "net" && hud.netStatus !== "ready" && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/85 px-5 py-2.5 rounded-full text-sm font-bold ring-1 ring-white/15 flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${
                    hud.netStatus === "error" ? "bg-red-500"
                      : hud.netStatus === "waiting" ? "bg-green-400"
                        : "bg-yellow-400 animate-pulse"
                  }`} />
                  {netMsg || NET_STATUS_TEXT[hud.netStatus]}
                  {hud.netRoom && <span className="text-white/50 font-mono">{hud.netRoom}</span>}
                  {hud.netStatus === "waiting" && (
                    <button
                      className="text-xs underline text-white/70 hover:text-white"
                      onClick={backToMenu}
                    >
                      Bekor qilish
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pastki panel */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/45 px-1">
          <div className="flex gap-4 flex-wrap">
            <span><b className="text-white/70">ICHIGO</b> — tez, yaqin masofa, qizil to&apos;lqin</span>
            <span><b className="text-violet-300">AIZEN</b> — masofaviy, Hadō, uzoq urish</span>
          </div>
          <span>Next.js + Canvas · sprites Python/Pillow bilan koddan chizilgan</span>
        </div>
      </div>
    </div>
  );
}

const NET_STATUS_TEXT: Record<string, string> = {
  idle: "Tayyor emas",
  connecting: "Serverga ulanmoqda...",
  lobby: "Xonaga kiritildi",
  waiting: "Do'stingizni kutmoqda...",
  ready: "Tayyor!",
  disconnected: "Aloqa uzildi",
  error: "Xatolik",
};

// ---------------------------------------------------------------------------
// Kichik komponentlar
// ---------------------------------------------------------------------------
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      {children}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="mt-5 w-full bg-white/10 hover:bg-white/20 py-2.5 rounded-lg text-sm font-semibold"
    >
      ← Menyuga qaytish
    </button>
  );
}

function Menu(props: {
  onCpu: () => void; onP2: () => void; onOnline: () => void;
  onHelp: () => void; hasStage: boolean;
}) {
  return (
    <div className="w-full max-w-lg text-center">
      <div className="mb-6">
        <div className="text-xs tracking-[0.5em] text-white/40 mb-2">2D FIGHTING</div>
        <h2 className="text-4xl sm:text-5xl font-black"
          style={{
            background: "linear-gradient(90deg,#F2802A,#FFD08A)",
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}
        >
          BLEACH SPIRIT CLASH
        </h2>
        <p className="text-white/50 text-sm mt-2">
          Ichigo va Aizen orasidagi o&apos;zaro urish
        </p>
      </div>
      <div className="grid gap-2.5">
        <button onClick={props.onCpu}
          className="group bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 py-4 rounded-xl font-black text-lg transition">
          BOT bilan o&apos;ynash
        </button>
        <button onClick={props.onP2}
          className="bg-white/10 hover:bg-white/20 py-3.5 rounded-xl font-bold transition">
          2 o&apos;yinchi (bir klaviatura)
        </button>
        <button onClick={props.onOnline}
          className="bg-violet-600/80 hover:bg-violet-500 py-3.5 rounded-xl font-bold transition">
          ONLINE 1v1 (do&apos;st bilan)
        </button>
        <button onClick={props.onHelp}
          className="bg-white/5 hover:bg-white/10 py-3 rounded-xl text-sm font-semibold">
          Bosqaruv va qoidalar
        </button>
      </div>
      {!props.hasStage && (
        <p className="text-[11px] text-amber-300/70 mt-3">
          Arena foni topilmadi — o&apos;yin foni bir xil rangda bo&apos;ladi.
          <code className="block mt-1 text-white/30">python tools\gen_stage.py</code>
        </p>
      )}
    </div>
  );
}

function CharSelect(props: {
  p1: string; setP1: (s: string) => void;
  p2: string; setP2: (s: string) => void;
  aiLevel: AiLevel; setAi: (s: AiLevel) => void;
  onStart: () => void; onBack: () => void;
}) {
  return (
    <div className="w-full max-w-3xl">
      <h2 className="text-center text-2xl font-black mb-4">BELGI TANLANG</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {(["p1", "p2"] as const).map((side) => {
          const cur = side === "p1" ? props.p1 : props.p2;
          const set = side === "p1" ? props.setP1 : props.setP2;
          return (
            <div key={side} className="bg-black/60 rounded-2xl p-4 ring-1 ring-white/10">
              <div className={`text-xs font-black tracking-widest mb-2 ${side === "p1" ? "text-orange-400" : "text-violet-300"}`}>
                {side === "p1" ? "1-O'YINCHI (SEN)" : "BOT"}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CHAR_LIST.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => set(c.key)}
                    className={`rounded-xl p-3 text-left transition border-2 ${
                      cur === c.key
                        ? "border-orange-500 bg-orange-500/15"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="font-black text-lg" style={{ color: c.color }}>{c.name}</div>
                    <div className="text-[10px] text-white/45 mt-0.5">{c.subtitle}</div>
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: c.color + "33" }}>
                      <div className="h-full w-3/4 rounded-full" style={{ background: c.color }} />
                    </div>
                    <div className="text-[9px] text-white/35 mt-1">Sog&apos;liq</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 bg-black/60 rounded-2xl p-4 ring-1 ring-white/10">
        <div className="text-xs font-black tracking-widest mb-2 text-white/50">QIYINLIK</div>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(AI_LEVELS) as AiLevel[]).map((k) => (
            <button
              key={k}
              onClick={() => props.setAi(k)}
              className={`py-2 rounded-lg text-sm font-bold transition ${
                props.aiLevel === k
                  ? "bg-orange-600 text-white"
                  : "bg-white/5 hover:bg-white/15 text-white/60"
              }`}
            >
              {AI_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={props.onBack}
          className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold">
          ← Orqaga
        </button>
        <button onClick={props.onStart}
          className="flex-1 bg-gradient-to-r from-orange-600 to-amber-500 hover:to-amber-400 py-3 rounded-xl font-black text-lg">
          O&apos;YINNI BOSHLASH
        </button>
      </div>
    </div>
  );
}
