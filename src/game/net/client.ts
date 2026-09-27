/**
 * net/client.ts — WebSocket orqali o'yin.
 *
 * ARXITEKTURA (p1 = host/autoritet):
 *   - p1 serverdan `role:"p1"` oladi va o'yin simulyatsiyasini o'zi yuritadi.
 *   - p1 har kadrda o'z kiritishini yuboradi, p2 esa o'z kiritishini.
 *   - p1 har 2-3 kadrda holatni (`snap`) butun dunyoga yuboradi.
 *   - p2 faqat kelgan holatni chizadi, o'z belgisini shu holatga qo'yadi.
 *
 * Bu yondashuv float fizikasining determinizmini talab qilmaydi va
 * "desync" muammosini yo'q qiladi, lekin p1 dialsiz bo'lsa o'yin to'xtaydi
 * (server README'da ham shu aytilgan).
 */

export type NetRole = "p1" | "p2" | null;
export type NetStatus =
  | "idle" | "connecting" | "lobby" | "waiting" | "ready"
  | "disconnected" | "error";

export type NetHandler = (kind: string, payload: unknown) => void;
export type NetStatusHandler = (
  role: NetRole, status: NetStatus, room: string, ping: number,
) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  role: NetRole = null;
  status: NetStatus = "idle";
  room = "";
  ping = 0;
  /** so'nggi xatolik (UI uchun) */
  lastError = "";

  constructor(
    private onStatus: NetStatusHandler,
    private onMessage: NetHandler,
  ) {}

  /** Server manzili. Berilmasa `NEXT_PUBLIC_WS_URL`, so'ng `ws://<host>:8787`. */
  static defaultUrl(): string {
    const env = process.env.NEXT_PUBLIC_WS_URL;
    if (env) return env;
    if (typeof window === "undefined") return "ws://localhost:8787";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:8787`;
  }

  private url(): string {
    return NetClient.defaultUrl();
  }

  private emitStatus() {
    this.onStatus(this.role, this.status, this.room, this.ping);
  }

  private open(then: () => void) {
    this.status = "connecting";
    this.emitStatus();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.status = "error";
      this.lastError = "Server manziliga ulanib bo'lmadi";
      this.emitStatus();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.status = "lobby";
      this.emitStatus();
      then();
      this.startPing();
    };
    ws.onclose = () => {
      this.status = "disconnected";
      this.emitStatus();
    };
    ws.onerror = () => {
      this.lastError = "Server bilan aloqa uzildi";
      this.status = "error";
      this.emitStatus();
    };
    ws.onmessage = (ev) => this.handle(ev.data as string);
  }

  connect() {
    this.open(() => this.raw({ t: "create" }));
  }

  join(room: string) {
    this.room = room;
    this.open(() => this.raw({ t: "join", room }));
  }

  disconnect() {
    try { this.raw({ t: "leave" }); } catch { /* yopiq */ }
    this.ws?.close();
    this.ws = null;
    this.status = "idle";
    this.role = null;
    this.emitStatus();
  }

  private raw(o: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(o));
    }
  }

  /** O'z kiritishimizni yuborish. */
  sendInput(who: 0 | 1, mask: number) {
    this.raw({ t: "relay", d: { k: "in", i: who, m: mask } });
  }

  /** p1 holatni yuboradi. */
  sendState(snap: unknown) {
    this.raw({ t: "relay", d: { k: "snap", s: snap } });
  }

  send(kind: string, payload: unknown) {
    this.raw({ t: "relay", d: { k: kind, ...(payload as object) } });
  }

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingId = 1;
  private pingSent = 0;

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.pingSent = performance.now();
      this.raw({ t: "ping", id: this.pingId++ });
    }, 2000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private handle(raw: string) {
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw); } catch { return; }
    const t = m.t as string;

    switch (t) {
      case "joined": {
        this.role = m.role as NetRole;
        this.room = String(m.room ?? "");
        this.status = "lobby";
        this.emitStatus();
        return;
      }
      case "peer": {
        if (m.connected) {
          this.status = "ready";
          this.onMessage("ready", {});
        } else {
          this.status = "waiting";
          this.onMessage("peerLeft", {});
        }
        this.emitStatus();
        return;
      }
      case "error": {
        this.lastError = String(m.msg ?? "Xatolik");
        this.status = "error";
        this.emitStatus();
        return;
      }
      case "pong": {
        if (m.id === this.pingId - 1 && this.pingSent) {
          this.ping = Math.round(performance.now() - this.pingSent);
        }
        this.emitStatus();
        return;
      }
      case "info": {
        void m;
        return;
      }
      case "relay": {
        const d = m.d as Record<string, unknown> | null;
        if (!d) return;
        const from = m.from as string;
        if (from === this.role) return; // o'z xabarimizni qayta ishlamaslik
        const kind = String(d.k ?? "");
        this.onMessage(kind, d);
        return;
      }
      default:
        return;
    }
  }
}
