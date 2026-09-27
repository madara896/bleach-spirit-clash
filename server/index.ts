/**
 * Bleach Fight — WebSocket relay server
 * ======================================
 *
 * A deliberately dumb relay for 2D fighting matches. The server knows rooms and
 * sockets and nothing about the game itself:
 *
 *   - `p1` is the authoritative simulation host. It broadcasts game state through
 *     `relay` messages. The server never inspects, validates or stores that state.
 *   - `p2` is the joiner. It sends its inputs through `relay`.
 *
 * Every message handler is wrapped in try/catch: a single malformed frame must
 * never be able to take the process down.
 *
 * Protocol (JSON text frames)
 * ---------------------------
 *   client -> server : {t:"create"} | {t:"join",room} | {t:"leave"}
 *                    | {t:"relay",d:any} | {t:"ping",id:number}
 *   server -> client : {t:"joined",room,role,seed} | {t:"error",msg}
 *                    | {t:"relay",from,d} | {t:"pong",id}
 *                    | {t:"peer",connected} | {t:"info",rooms}
 *
 * Only `GET /health` is served over HTTP; everything else is WebSocket.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** Room codes are 4 uppercase letters. I/O are excluded (they read as 1/0). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

/** 2^32, used as the exclusive upper bound of the uint32 seed. */
const UINT32_RANGE = 0x1_0000_0000;

/** Hard cap for one inbound frame. Anything larger is dropped. */
const MAX_MESSAGE_BYTES = 64 * 1024;

/** Per-client relay budget per sliding second. Extras are dropped silently. */
const RELAY_LIMIT_PER_SEC = 200;

/** Length of the sliding rate-limit window, in milliseconds. */
const RATE_WINDOW_MS = 1000;

/** WebSocket ping period. A socket must answer two consecutive pings. */
const HEARTBEAT_INTERVAL_MS = 20_000;

/** How often room members get an unsolicited `{t:"info",rooms}` push. */
const INFO_INTERVAL_MS = 10_000;

/** How long an empty room is kept alive before it is destroyed. */
const ROOM_TTL_MS = 10 * 60 * 1000;

const DEFAULT_PORT = 8787;
const HOST = '0.0.0.0';

/**
 * Exact error strings a client may match on. Treat these as part of the
 * protocol — do not reword them without updating the client too.
 */
export const ERRORS = {
  /** `join` for a code that does not exist (or is not a valid code). */
  roomNotFound: 'Xona topilmadi',
  /** `join` into a room that already has two players. */
  roomFull: "Xona to'ldi",
} as const;

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/** Which seat a client occupies. `p1` is the authoritative host. */
export type Role = 'p1' | 'p2';

/** `{t:"join"}` — the field is validated at runtime, so it stays `unknown`. */
export type JoinMessage = { t: 'join'; room?: unknown };

/** `{t:"relay"}` — `d` is forwarded verbatim and never inspected. */
export type RelayMessage = { t: 'relay'; d?: unknown };

/** `{t:"ping"}` — the echo id must be a finite number. */
export type PingMessage = { t: 'ping'; id?: unknown };

/** Any frame a client may send. Unknown/extra fields are ignored. */
export type ClientMessage =
  | { t: 'create' }
  | { t: 'leave' }
  | JoinMessage
  | RelayMessage
  | PingMessage;

/** Any frame the server may send. */
export type ServerMessage =
  | { t: 'joined'; room: string; role: Role; seed: number }
  | { t: 'error'; msg: string }
  | { t: 'relay'; from: Role; d: unknown }
  | { t: 'pong'; id: number }
  | { t: 'peer'; connected: boolean }
  | { t: 'info'; rooms: number };

/** Per-connection bookkeeping. Holds no game state. */
interface ClientState {
  /** Stable id for this connection, used in log lines. */
  readonly id: number;
  readonly ws: WebSocket;
  /** Current room, or null while idle. */
  room: Room | null;
  /** Current seat, or null while idle. */
  role: Role | null;
  /** Liveness flag flipped by the heartbeat (see `onPong`). */
  alive: boolean;
  /** Timestamps (ms) of recent relay messages, used by the rate limiter. */
  relayStamps: number[];
}

/** A room holds two seats and the seed both players must agree on. */
interface Room {
  readonly code: string;
  /** uint32, generated once when the room is created. */
  readonly seed: number;
  p1: ClientState | null;
  p2: ClientState | null;
  /** Fires `ROOM_TTL_MS` after the room became empty; null while occupied. */
  expiry: NodeJS.Timeout | null;
}

/** Options accepted by {@link createServer}. Every field has a default. */
export interface CreateServerOptions {
  /** Log sink. Defaults to `console.log`. Pass a no-op to silence (tests). */
  log: ((line: string) => void) | undefined;
  /** Empty-room lifetime. Defaults to 10 minutes. */
  roomTtlMs: number;
  /** `{t:"info"}` push period; `0` disables. Defaults to 10s. */
  infoIntervalMs: number;
  /** WebSocket ping period; `0` disables. Defaults to 20s. */
  heartbeatIntervalMs: number;
  /** Host to bind. Defaults to `0.0.0.0`. */
  host: string;
}

/** The running relay, returned by {@link createServer}. */
export interface RelayServer {
  readonly httpServer: HttpServer;
  readonly wss: WebSocketServer;
  /** Number of live rooms (including the ones inside their grace period). */
  roomCount(): number;
  /** Number of currently connected sockets. */
  clientCount(): number;
  /** Resolves with the port actually bound. */
  listen(port?: number, host?: string): Promise<number>;
  /** Stops timers, drops sockets and closes the HTTP server. */
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Random 4-letter room code from the unambiguous alphabet. */
function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // Non-null assertion is safe: `i < CODE_LENGTH <= CODE_ALPHABET.length`.
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]!;
  }
  return code;
}

/** Cryptographically random uint32 (0 .. 2^32-1). */
function randomUint32(): number {
  return randomInt(0, UINT32_RANGE);
}

/** Byte length of a `ws` payload, which may arrive as a Buffer or Buffer[]. */
function rawByteLength(data: RawData): number {
  if (Array.isArray(data)) {
    let total = 0;
    for (const chunk of data) total += chunk.length;
    return total;
  }
  return data.byteLength;
}

/** Decode a `ws` payload to a UTF-8 string. */
function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(new Uint8Array(data)).toString('utf8');
}

/** True when `code` is a syntactically valid room code. */
function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

/**
 * Creates a relay instance. Nothing is bound to a port until you call
 * `listen()`, which makes this safe to import from tests.
 */
export function createServer(options: Partial<CreateServerOptions> = {}): RelayServer {
  const log = options.log ?? ((line: string): void => console.log(line));
  const roomTtlMs = options.roomTtlMs ?? ROOM_TTL_MS;
  const infoIntervalMs = options.infoIntervalMs ?? INFO_INTERVAL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const defaultHost = options.host ?? HOST;

  /** Live rooms, keyed by code. */
  const rooms = new Map<string, Room>();
  /** Live sockets, keyed by WebSocket. */
  const clients = new Map<WebSocket, ClientState>();
  let nextClientId = 1;

  /* ---------------- sending ---------------- */

  /** Serialize and send. Returns false if the socket is not writable. */
  function send(ws: WebSocket, msg: ServerMessage): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      // A failed send is not fatal; the heartbeat will clean the socket up.
      return false;
    }
  }

  function sendError(state: ClientState, msg: string): void {
    send(state.ws, { t: 'error', msg });
  }

  /** Push the current room count to one client. */
  function sendInfo(state: ClientState): void {
    send(state.ws, { t: 'info', rooms: rooms.size });
  }

  /** Push the current room count to everyone (room created/destroyed). */
  function broadcastInfo(): void {
    for (const state of clients.values()) sendInfo(state);
  }

  /** Tell a client whether the other player is currently in the room. */
  function sendPeer(state: ClientState, connected: boolean): void {
    send(state.ws, { t: 'peer', connected });
  }

  /* ---------------- rooms ---------------- */

  /** Create + register a room with a fresh seed. */
  function createRoom(): Room {
    let code = randomCode();
    // 24^4 codes; collisions with live rooms are vanishingly rare.
    while (rooms.has(code)) code = randomCode();
    const room: Room = { code, seed: randomUint32(), p1: null, p2: null, expiry: null };
    rooms.set(code, room);
    return room;
  }

  /** Destroy a room now and clear its pending expiry timer. */
  function destroyRoom(room: Room): void {
    if (room.expiry !== null) {
      clearTimeout(room.expiry);
      room.expiry = null;
    }
    rooms.delete(room.code);
    log(`room ${room.code} destroyed rooms=${rooms.size}`);
    broadcastInfo();
  }

  /** Start (or restart) the empty-room grace timer. */
  function scheduleExpiry(room: Room): void {
    if (room.expiry !== null) return;
    room.expiry = setTimeout(() => {
      room.expiry = null;
      // Someone may have re-joined during the grace period.
      if (room.p1 === null && room.p2 === null) destroyRoom(room);
    }, roomTtlMs);
    // Do not hold the event loop open just for the grace timer.
    room.expiry.unref?.();
  }

  function cancelExpiry(room: Room): void {
    if (room.expiry === null) return;
    clearTimeout(room.expiry);
    room.expiry = null;
  }

  /** The first free seat in a room, or null when both are taken. */
  function freeSlotOf(room: Room): Role | null {
    if (room.p1 === null) return 'p1';
    if (room.p2 === null) return 'p2';
    return null;
  }

  /** The other player in the room, or null when playing alone. */
  function opponentOf(room: Room, role: Role): ClientState | null {
    return role === 'p1' ? room.p2 : room.p1;
  }

  /**
   * Detach a client from its room, notify the opponent and either cancel or
   * start the room's expiry timer. Safe to call for an idle client.
   */
  function detach(state: ClientState, reason: 'leave' | 'close' | 'error'): void {
    const room = state.room;
    const role = state.role;
    state.room = null;
    state.role = null;
    if (room === null || role === null) return;

    if (room.p1 === state) room.p1 = null;
    if (room.p2 === state) room.p2 = null;

    const opponent = opponentOf(room, role);
    if (opponent !== null) sendPeer(opponent, false);

    log(`room ${room.code} ${role} ${reason} clients=${clients.size}`);
    if (room.p1 === null && room.p2 === null) scheduleExpiry(room);
    else cancelExpiry(room);
  }

  /* ---------------- message handlers ---------------- */

  /**
   * Attach a client to a room and announce the result to both sides.
   * `role` is decided by which seat is free.
   */
  function seat(state: ClientState, room: Room, role: Role): void {
    // Single place where a room slot is ever filled.
    if (role === 'p1') room.p1 = state;
    else room.p2 = state;

    state.room = room;
    state.role = role;
    send(state.ws, { t: 'joined', room: room.code, role, seed: room.seed });
    sendInfo(state);

    // Both sides learn that the other player is now present. A `peer:false` is
    // never sent here: it is only emitted when the opponent actually leaves.
    const opponent = opponentOf(room, role);
    if (opponent !== null) {
      sendPeer(opponent, true);
      sendPeer(state, true);
    }
  }

  function handleCreate(state: ClientState): void {
    // `create` while already seated implicitly leaves the old room first.
    if (state.room !== null) detach(state, 'leave');
    const room = createRoom();
    seat(state, room, 'p1');
    log(`room ${room.code} created rooms=${rooms.size}`);
    broadcastInfo();
  }

  function handleJoin(state: ClientState, msg: JoinMessage): void {
    const raw = typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : '';
    const room = isValidCode(raw) ? rooms.get(raw) : undefined;
    if (room === undefined) {
      sendError(state, ERRORS.roomNotFound);
      return;
    }

    if (state.room !== null) detach(state, 'leave');

    const role = freeSlotOf(room);
    if (role === null) {
      sendError(state, ERRORS.roomFull);
      return;
    }

    cancelExpiry(room);
    seat(state, room, role);
    log(`room ${room.code} joined ${role} clients=${clients.size}`);
  }

  function handleLeave(state: ClientState): void {
    detach(state, 'leave');
  }

  /**
   * Sliding one-second budget for `relay`: at most {@link RELAY_LIMIT_PER_SEC}
   * relayed messages in *any* one-second span. Timestamps older than a second
   * are discarded first, so a window boundary can never double the budget.
   */
  function allowRelay(state: ClientState, now: number): boolean {
    const cutoff = now - RATE_WINDOW_MS;
    let stale = 0;
    while (stale < state.relayStamps.length && (state.relayStamps[stale] as number) <= cutoff) {
      stale += 1;
    }
    if (stale > 0) state.relayStamps.splice(0, stale);
    if (state.relayStamps.length >= RELAY_LIMIT_PER_SEC) return false;
    state.relayStamps.push(now);
    return true;
  }

  function handleRelay(state: ClientState, msg: RelayMessage): void {
    const room = state.room;
    const role = state.role;
    if (room === null || role === null) return; // nothing to relay to
    if (!allowRelay(state, Date.now())) return; // over budget: drop silently

    const opponent = opponentOf(room, role);
    if (opponent === null) return; // alone in the room
    // The payload is opaque: forwarded verbatim, never inspected.
    send(opponent.ws, { t: 'relay', from: role, d: msg.d ?? null });
  }

  function handlePing(state: ClientState, msg: PingMessage): void {
    const id = msg.id;
    if (typeof id !== 'number' || !Number.isFinite(id)) return;
    send(state.ws, { t: 'pong', id });
  }

  /**
   * Parse and dispatch one inbound frame. Every branch is isolated so a bad
   * frame can only ever drop that frame.
   */
  function onMessage(state: ClientState, data: RawData, isBinary: boolean): void {
    try {
      if (isBinary) return; // JSON text frames only
      if (rawByteLength(data) > MAX_MESSAGE_BYTES) return; // over the cap: drop

      const parsed: unknown = JSON.parse(rawToString(data));
      if (typeof parsed !== 'object' || parsed === null) return;

      const msg = parsed as ClientMessage;
      switch (msg.t) {
        case 'create':
          handleCreate(state);
          break;
        case 'join':
          handleJoin(state, msg);
          break;
        case 'leave':
          handleLeave(state);
          break;
        case 'relay':
          handleRelay(state, msg);
          break;
        case 'ping':
          handlePing(state, msg);
          break;
        default:
          break; // unknown frame types are ignored
      }
    } catch {
      // Malformed JSON or an unexpected payload: drop the frame, stay alive.
    }
  }

  /* ---------------- HTTP (health only) ---------------- */

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    try {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
      });
      res.end(payload);
    } catch {
      res.destroy();
    }
  }

  /** No CORS headers on purpose: this endpoint is for Render and uptime checks. */
  function onRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      const path = (req.url ?? '/').split('?', 1)[0];
      if (req.method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true, rooms: rooms.size });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch {
      res.destroy();
    }
  }

  /* ---------------- wiring ---------------- */

  const httpServer = createHttpServer(onRequest);

  const wss = new WebSocketServer({
    server: httpServer,
    // Hard memory guard: ws tears the socket down on a bigger frame.
    maxPayload: MAX_MESSAGE_BYTES,
    // Keep the default of no permessage-deflate: game frames are tiny and
    // compression would add latency and CPU.
  });

  wss.on('connection', (ws: WebSocket): void => {
    const state: ClientState = {
      id: nextClientId,
      ws,
      room: null,
      role: null,
      alive: true,
      relayStamps: [],
    };
    nextClientId += 1;
    clients.set(ws, state);
    log(`ws connect id=${state.id} clients=${clients.size}`);

    ws.on('pong', () => {
      state.alive = true;
    });

    ws.on('message', (data: RawData, isBinary: boolean) => {
      try {
        onMessage(state, data, isBinary);
      } catch {
        // Defence in depth: a handler bug must not escape into `ws`.
      }
    });

    // Idempotent: `detach` no-ops once idle and `clients.delete` reports whether
    // it removed anything, so close-after-error and error-after-close are safe.
    const teardown = (reason: 'close' | 'error'): void => {
      try {
        detach(state, reason);
      } catch {
        // ignore
      }
      if (clients.delete(ws)) log(`ws ${reason} id=${state.id} clients=${clients.size}`);
    };

    ws.on('close', () => teardown('close'));
    ws.on('error', () => {
      log(`ws error id=${state.id}`);
      teardown('error');
    });
  });

  wss.on('error', (err: Error) => {
    log(`wss error ${err.message}`);
  });

  /* ---------------- timers ---------------- */

  const heartbeat =
    heartbeatIntervalMs > 0
      ? setInterval(() => {
          for (const state of clients.values()) {
            if (state.alive === false) {
              // Missed the previous ping: terminate.
              state.alive = true;
              state.ws.terminate();
              continue;
            }
            state.alive = false;
            try {
              state.ws.ping();
            } catch {
              state.ws.terminate();
            }
          }
        }, heartbeatIntervalMs)
      : null;
  heartbeat?.unref?.();

  const infoTick =
    infoIntervalMs > 0
      ? setInterval(() => {
          for (const state of clients.values()) {
            if (state.room !== null) sendInfo(state);
          }
        }, infoIntervalMs)
      : null;
  infoTick?.unref?.();

  /* ---------------- public surface ---------------- */

  return {
    httpServer,
    wss,
    roomCount: (): number => rooms.size,
    clientCount: (): number => clients.size,
    listen(port?: number, host?: string): Promise<number> {
      const target = port ?? resolvePort();
      return new Promise<number>((resolve, reject) => {
        const onError = (err: Error): void => reject(err);
        httpServer.once('error', onError);
        httpServer.listen(target, host ?? defaultHost, () => {
          httpServer.removeListener('error', onError);
          const address = httpServer.address();
          const bound = typeof address === 'object' && address !== null ? address.port : target;
          log(`listening :${bound} rooms=${rooms.size}`);
          resolve(bound);
        });
      });
    },
    async close(): Promise<void> {
      if (heartbeat !== null) clearInterval(heartbeat);
      if (infoTick !== null) clearInterval(infoTick);
      for (const room of rooms.values()) cancelExpiry(room);
      rooms.clear();
      for (const state of clients.values()) {
        detach(state, 'close');
        state.ws.terminate();
      }
      clients.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Drop lingering keep-alive sockets so close() cannot hang.
        httpServer.closeAllConnections?.();
      });
    },
  };
}

/** `process.env.PORT` as a number, falling back to {@link DEFAULT_PORT}. */
export function resolvePort(): number {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/* ------------------------------------------------------------------ *
 * Process guards (only installed when run as a program)
 * ------------------------------------------------------------------ */

/**
 * Keeps the process alive on unexpected errors. Each distinct error is logged
 * once; a running total is reported so a log flood cannot hide the process.
 */
export function installProcessGuards(
  log: (line: string) => void = (line: string): void => console.log(line),
): void {
  const seen = new Set<string>();
  let total = 0;
  const MAX_LINES = 10;

  const report = (kind: string, err: unknown): void => {
    total += 1;
    if (total > MAX_LINES) return;
    const message = err instanceof Error ? err.message : String(err);
    const key = `${kind}:${message}`;
    if (seen.has(key)) {
      log(`${kind} suppressed (total=${total})`);
      return;
    }
    seen.add(key);
    log(`${kind} ${message} (kept running)`);
  };

  process.on('uncaughtException', (err: unknown) => report('uncaughtException', err));
  process.on('unhandledRejection', (reason: unknown) => report('unhandledRejection', reason));
}

/** True when this module is the process entry point, not an import. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

/** Boot sequence for `node dist/index.js` / `tsx index.ts`. */
function main(): void {
  installProcessGuards();
  const server = createServer();

  void server.listen().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`listen failed ${message}`);
    process.exit(1);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} shutdown`);
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (isEntryPoint()) {
  main();
}
