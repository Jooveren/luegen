// src/deploy-entry.js
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/app.js
import express2 from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

// src/rooms/RoomManager.js
import { randomBytes, randomInt as randomInt2 } from "node:crypto";

// ../shared/constants.js
var SUITS = ["eichel", "gras", "herz", "schellen"];
var RANKS = ["6", "8", "9", "10", "U", "O", "K", "A"];
var MIN_PLAYERS = 2;
var MAX_PLAYERS = 7;
var MAX_CARDS_PER_PLAY = 3;
var ROOM_CODE_LENGTH = 4;
var NAME_MAX_LENGTH = 16;
var CHAT_MAX_LENGTH = 200;
var CHAT_HISTORY_SIZE = 60;
var MODES = {
  SAME: "same",
  // Standard: Startspieler wählt den Wert frei, alle bedienen ihn bis „Lügner!“
  ASCENDING: "ascending"
  // Wert steigt mit jedem Zug: 6 → 8 → 9 → 10 → U → O → K → A → 6 …
};
var PHASES = {
  LOBBY: "lobby",
  PLAYING: "playing",
  FINISHED: "finished"
};
var EVT = {
  // Client → Server
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_REJOIN: "room:rejoin",
  ROOM_LEAVE: "room:leave",
  ROOM_SETTINGS: "room:settings",
  ROOM_KICK: "room:kick",
  GAME_START: "game:start",
  GAME_PLAY: "game:play",
  GAME_CHALLENGE: "game:challenge",
  GAME_ACCEPT: "game:accept",
  GAME_REMATCH: "game:rematch",
  CHAT_SEND: "chat:send",
  // Server → Client
  ROOM_STATE: "room:state",
  GAME_EVENT: "game:event",
  KICKED: "room:kicked",
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history"
};
function nextRank(rank) {
  const i = RANKS.indexOf(rank);
  return RANKS[(i + 1) % RANKS.length];
}
function sortCards(cards) {
  return [...cards].sort(
    (a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
  );
}

// ../shared/game/deck.js
function randomInt(max) {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const limit = Math.floor(4294967296 / max) * max;
    const buf = new Uint32Array(1);
    do
      c.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  return deck;
}
function shuffle(cards, rand = randomInt) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function deal(cards, playerIds) {
  const hands = new Map(playerIds.map((id) => [id, []]));
  cards.forEach((card, i) => hands.get(playerIds[i % playerIds.length]).push(card));
  return hands;
}

// ../shared/game/LuegenGame.js
var GameError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var LOSING_RANK = "O";
var LuegenGame = class {
  constructor(players, { mode = MODES.SAME, rand = randomInt, deck, startIndex } = {}) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new GameError("PLAYER_COUNT", `Es braucht ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler.`);
    }
    if (!Object.values(MODES).includes(mode)) throw new GameError("BAD_MODE", "Unbekannter Spielmodus.");
    this.mode = mode;
    this.rand = rand;
    this.order = players.map((p) => p.id);
    this.playerCount = this.order.length;
    const start = startIndex ?? rand(this.order.length);
    const dealOrder = [...this.order.slice(start), ...this.order.slice(0, start)];
    this.hands = deal(deck ?? shuffle(createDeck(), rand), dealOrder);
    this.currentPlayerId = this.order[start];
    this.pile = [];
    this.lastPlay = null;
    this.requiredRank = mode === MODES.ASCENDING ? RANKS[0] : null;
    this.pendingOutId = null;
    this.finishOrder = [];
    this.loserId = null;
    this.winnerId = null;
    this.endReason = null;
    this.phase = PHASES.PLAYING;
    this.seq = 0;
    this.discarded = [];
    this.initialQuads = this.order.flatMap((id) => this.#discardQuads(id));
    const unlucky = this.order.find((id) => this.#hasFourOber(id));
    if (unlucky) {
      this.#finish(unlucky, "ober");
      return;
    }
    for (const id of this.order) if (this.hands.get(id).length === 0) this.finishOrder.push(id);
    if (this.#checkEnd()) return;
    if (this.hands.get(this.currentPlayerId).length === 0) this.currentPlayerId = this.#nextActive(this.currentPlayerId);
  }
  // ---------- Aktionen ----------
  play(playerId, cardIds, claimRank, claimCount) {
    this.#assertTurn(playerId);
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > MAX_CARDS_PER_PLAY) {
      throw new GameError("BAD_CARDS", `Lege 1 bis ${MAX_CARDS_PER_PLAY} Karten.`);
    }
    if (new Set(cardIds).size !== cardIds.length) throw new GameError("BAD_CARDS", "Doppelte Karten.");
    const hand = this.hands.get(playerId);
    const cards = cardIds.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new GameError("NOT_IN_HAND", "Diese Karte hast du nicht.");
    if (!RANKS.includes(claimRank)) throw new GameError("BAD_CLAIM", "Ung\xFCltiger Wert.");
    if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > MAX_CARDS_PER_PLAY) {
      throw new GameError("BAD_CLAIM", `Angesagte Anzahl muss 1 bis ${MAX_CARDS_PER_PLAY} sein.`);
    }
    if (this.requiredRank && claimRank !== this.requiredRank) {
      throw new GameError("WRONG_RANK", "Du musst den geforderten Wert ansagen.");
    }
    let confirmedOutId = null;
    if (this.pendingOutId) {
      confirmedOutId = this.#confirmOut();
      if (this.#checkEnd()) {
        this.seq++;
        return { type: "out", playerId: confirmedOutId, place: this.finishOrder.length, ...this.#endInfo() };
      }
    }
    const remaining = hand.filter((c) => !cardIds.includes(c.id));
    this.hands.set(playerId, remaining);
    this.pile.push(...cards);
    this.lastPlay = { playerId, cards, claimRank, claimCount };
    this.requiredRank = this.mode === MODES.ASCENDING ? nextRank(claimRank) : claimRank;
    if (remaining.length === 0) this.pendingOutId = playerId;
    this.currentPlayerId = this.#nextActive(playerId);
    this.seq++;
    return {
      type: "played",
      playerId,
      claimRank,
      claimCount,
      pileCount: this.pile.length,
      nextPlayerId: this.currentPlayerId,
      lastCards: remaining.length === 0,
      confirmedOutId,
      place: confirmedOutId ? this.finishOrder.length : void 0
    };
  }
  challenge(playerId) {
    this.#assertTurn(playerId);
    if (!this.lastPlay) throw new GameError("NOTHING_TO_CHALLENGE", "Es gibt nichts anzuzweifeln.");
    const { playerId: accusedId, cards, claimRank, claimCount } = this.lastPlay;
    const lied = cards.length !== claimCount || cards.some((c) => c.rank !== claimRank);
    const loserId = lied ? accusedId : playerId;
    const pileSize = this.pile.length;
    this.hands.get(loserId).push(...this.pile);
    this.pile = [];
    this.lastPlay = null;
    if (this.mode === MODES.SAME) this.requiredRank = null;
    this.seq++;
    const quads = this.#discardQuads(loserId);
    const event = { type: "challenge", challengerId: playerId, accusedId, revealed: cards, claimRank, claimCount, lied, loserId, pileSize, quads };
    if (this.#hasFourOber(loserId)) {
      this.#finish(loserId, "ober");
      return { ...event, oberLoserId: loserId, ...this.#endInfo() };
    }
    if (this.pendingOutId) {
      if (!lied) {
        event.outId = this.#confirmOut();
        event.place = this.finishOrder.length;
      } else this.pendingOutId = null;
    }
    if (this.hands.get(loserId).length === 0 && !this.finishOrder.includes(loserId)) {
      this.finishOrder.push(loserId);
      event.outByQuads = loserId;
    }
    if (this.#checkEnd()) return { ...event, ...this.#endInfo() };
    const starter = lied ? playerId : accusedId;
    this.currentPlayerId = this.hands.get(starter).length > 0 ? starter : this.#nextActive(starter);
    return { ...event, nextPlayerId: this.currentPlayerId };
  }
  /** Dem Spieler ohne Karten glauben: er ist raus, der Glaubende spielt weiter. */
  accept(playerId) {
    this.#assertTurn(playerId);
    if (!this.pendingOutId) throw new GameError("NOTHING_TO_ACCEPT", "Niemand wartet auf dein Urteil.");
    const out = this.#confirmOut();
    this.lastPlay = null;
    this.seq++;
    const event = { type: "out", playerId: out, place: this.finishOrder.length, acceptedBy: playerId };
    if (this.#checkEnd()) return { ...event, ...this.#endInfo() };
    return event;
  }
  /**
   * Spieler scheidet aus der laufenden Runde aus (Verbindung weg oder verlassen).
   * Seine Handkarten werden zufällig an die übrigen Spieler verteilt, die noch Karten haben.
   */
  removePlayer(playerId) {
    if (!this.order.includes(playerId)) return null;
    const wasCurrent = this.currentPlayerId === playerId;
    const next = wasCurrent ? this.#nextActive(playerId) : null;
    const hand = this.hands.get(playerId) ?? [];
    this.hands.delete(playerId);
    this.order = this.order.filter((id) => id !== playerId);
    this.finishOrder = this.finishOrder.filter((id) => id !== playerId);
    if (this.lastPlay?.playerId === playerId) {
      this.lastPlay = null;
      if (this.mode === MODES.SAME) this.requiredRank = null;
    }
    if (this.pendingOutId === playerId) this.pendingOutId = null;
    this.seq++;
    if (this.phase !== PHASES.PLAYING) return { type: "player_removed", playerId };
    const receivers = this.order.filter((id) => this.hands.get(id).length > 0);
    const given = {};
    if (receivers.length) {
      for (const card of shuffle(hand, this.rand)) {
        const id = receivers[this.rand(receivers.length)];
        this.hands.get(id).push(card);
        given[id] = (given[id] ?? 0) + 1;
      }
    } else this.pile.unshift(...hand);
    const quads = Object.keys(given).flatMap((id) => this.#discardQuads(id));
    const event = { type: "player_removed", playerId, given, quads, cardCount: hand.length };
    const oberLoser = Object.keys(given).find((id) => this.#hasFourOber(id));
    if (oberLoser) {
      this.#finish(oberLoser, "ober");
      return { ...event, oberLoserId: oberLoser, ...this.#endInfo() };
    }
    for (const id of Object.keys(given)) if (this.hands.get(id).length === 0 && !this.finishOrder.includes(id)) this.finishOrder.push(id);
    if (this.order.length < MIN_PLAYERS) {
      this.#finish(null, "players_left");
      return { ...event, ...this.#endInfo() };
    }
    if (this.#checkEnd()) return { ...event, ...this.#endInfo() };
    if (wasCurrent) this.currentPlayerId = next && next !== playerId && this.hands.get(next)?.length ? next : this.#nextActive(this.order[0]);
    if (this.hands.get(this.currentPlayerId)?.length === 0) this.currentPlayerId = this.#nextActive(this.currentPlayerId);
    return { ...event, nextPlayerId: this.currentPlayerId };
  }
  getStateFor(viewerId) {
    return {
      phase: this.phase,
      mode: this.mode,
      order: [...this.order],
      currentPlayerId: this.currentPlayerId,
      requiredRank: this.requiredRank,
      pileCount: this.pile.length,
      lastPlay: this.lastPlay && { playerId: this.lastPlay.playerId, claimRank: this.lastPlay.claimRank, claimCount: this.lastPlay.claimCount },
      pendingOutId: this.pendingOutId,
      finishOrder: [...this.finishOrder],
      winnerId: this.winnerId,
      loserId: this.loserId,
      endReason: this.endReason,
      cardCounts: Object.fromEntries(this.order.map((id) => [id, this.hands.get(id).length])),
      hand: sortCards(this.hands.get(viewerId) ?? []),
      discardedRanks: [...new Set(this.discarded.map((c) => c.rank))],
      seq: this.seq
    };
  }
  // ---------- intern ----------
  #assertTurn(playerId) {
    if (this.phase !== PHASES.PLAYING) throw new GameError("NOT_PLAYING", "Das Spiel l\xE4uft nicht.");
    if (this.currentPlayerId !== playerId) throw new GameError("NOT_YOUR_TURN", "Du bist nicht am Zug.");
  }
  #hasFourOber(playerId) {
    return (this.hands.get(playerId) ?? []).filter((c) => c.rank === LOSING_RANK).length === 4;
  }
  /** Alle vollständigen Vierer (außer Ober) offen ablegen. */
  #discardQuads(playerId) {
    const hand = this.hands.get(playerId);
    const ranks = RANKS.filter((r) => r !== LOSING_RANK && hand.filter((c) => c.rank === r).length === 4);
    if (!ranks.length) return [];
    this.hands.set(playerId, hand.filter((c) => !ranks.includes(c.rank)));
    this.discarded.push(...hand.filter((c) => ranks.includes(c.rank)));
    return ranks.map((rank) => ({ playerId, rank }));
  }
  #confirmOut() {
    const id = this.pendingOutId;
    this.pendingOutId = null;
    if (!this.finishOrder.includes(id)) this.finishOrder.push(id);
    return id;
  }
  /** Spielende prüfen: noch 2 Spieler mit Karten (bei 2 Spielern: noch 1). */
  #checkEnd() {
    if (this.phase !== PHASES.PLAYING) return false;
    const remaining = this.order.filter((id) => this.hands.get(id).length > 0 || id === this.pendingOutId);
    const limit = this.playerCount >= 3 ? 2 : 1;
    if (remaining.length > limit) return false;
    if (remaining.length === 2) {
      const [a, b] = remaining;
      const ca = this.hands.get(a).length;
      const cb = this.hands.get(b).length;
      let loser = ca > cb ? a : cb > ca ? b : null;
      if (!loser) loser = remaining.includes(this.currentPlayerId) ? this.currentPlayerId : a;
      this.#finish(loser, "most_cards");
    } else {
      this.#finish(remaining[0] ?? null, "last");
    }
    return true;
  }
  #endInfo() {
    return { ended: true, endLoserId: this.loserId, endReason: this.endReason, winnerId: this.winnerId };
  }
  #nextActive(fromId) {
    const n = this.order.length;
    const start = this.order.indexOf(fromId);
    for (let step = 1; step < n; step++) {
      const id = this.order[(start + step) % n];
      if (this.hands.get(id).length > 0) return id;
    }
    return fromId;
  }
  #finish(loserId, reason) {
    this.phase = PHASES.FINISHED;
    this.loserId = loserId;
    this.endReason = reason;
    this.winnerId = this.finishOrder[0] ?? null;
    this.currentPlayerId = null;
    this.pendingOutId = null;
  }
};

// src/rooms/RoomManager.js
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var newId = () => randomBytes(8).toString("hex");
var newToken = () => randomBytes(24).toString("hex");
function sanitizeName(raw) {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  if (!name) throw new GameError("BAD_NAME", "Bitte gib einen Namen ein.");
  return name;
}
function normalizeCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH);
}
var Room = class {
  constructor(code) {
    this.code = code;
    this.hostId = null;
    this.players = /* @__PURE__ */ new Map();
    this.settings = { mode: MODES.SAME };
    this.game = null;
    this.chat = [];
    this.pauses = /* @__PURE__ */ new Map();
  }
  get phase() {
    return this.game ? this.game.phase : PHASES.LOBBY;
  }
  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, NAME_MAX_LENGTH - 2)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
  /** Persönliche Sicht für einen Spieler – enthält nur dessen eigene Karten. */
  stateFor(viewerId) {
    return {
      code: this.code,
      hostId: this.hostId,
      you: viewerId,
      phase: this.phase,
      settings: { ...this.settings },
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      game: this.game ? this.game.getStateFor(viewerId) : null,
      // Spiel pausiert, weil jemand die Verbindung verloren hat (Restzeit in ms)
      pauses: [...this.pauses].map(([playerId, until]) => ({ playerId, remainingMs: Math.max(0, until - Date.now()) })),
      spectating: Boolean(this.game && this.game.phase === "playing" && !this.game.order.includes(viewerId))
    };
  }
};
var RoomManager = class {
  constructor() {
    this.rooms = /* @__PURE__ */ new Map();
  }
  #generateCode() {
    for (let attempt = 0; attempt < 1e3; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt2(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError("NO_CODE", "Gerade sind zu viele R\xE4ume offen. Bitte sp\xE4ter erneut versuchen.");
  }
  #addPlayer(room, name) {
    const player = {
      id: newId(),
      name: room.uniqueName(sanitizeName(name)),
      token: newToken(),
      socketId: null,
      connected: false,
      disconnectTimer: null
    };
    room.players.set(player.id, player);
    if (!room.hostId) room.hostId = player.id;
    return player;
  }
  getRoom(code) {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) throw new GameError("ROOM_NOT_FOUND", "Raum nicht gefunden. Code pr\xFCfen?");
    return room;
  }
  createRoom(name) {
    const room = new Room(this.#generateCode());
    this.rooms.set(room.code, room);
    const player = this.#addPlayer(room, name);
    return { room, player };
  }
  joinRoom(code, name) {
    const room = this.getRoom(code);
    if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft bereits.");
    if (room.players.size >= MAX_PLAYERS) throw new GameError("ROOM_FULL", `Raum ist voll (max. ${MAX_PLAYERS}).`);
    const player = this.#addPlayer(room, name);
    return { room, player };
  }
  rejoin(code, token) {
    const room = this.getRoom(code);
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) throw new GameError("SESSION_EXPIRED", "Deine Sitzung ist abgelaufen.");
    return { room, player };
  }
  /** Entfernt einen Spieler endgültig. Gibt ein evtl. Spiel-Event zurück. */
  removePlayer(room, playerId) {
    const player = room.players.get(playerId);
    if (!player) return null;
    clearTimeout(player.disconnectTimer);
    room.players.delete(playerId);
    let event = null;
    room.pauses.delete(playerId);
    if (room.game && room.game.phase === PHASES.PLAYING) event = room.game.removePlayer(playerId);
    if (room.hostId === playerId) {
      const nextHost = [...room.players.values()].find((p) => p.connected) ?? [...room.players.values()][0];
      room.hostId = nextHost?.id ?? null;
    }
    if (room.players.size === 0) this.rooms.delete(room.code);
    return event;
  }
  updateSettings(room, playerId, settings) {
    this.#assertHost(room, playerId);
    if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Nur in der Lobby \xE4nderbar.");
    if (settings?.mode !== void 0) {
      if (!Object.values(MODES).includes(settings.mode)) throw new GameError("BAD_MODE", "Unbekannter Modus.");
      room.settings.mode = settings.mode;
    }
  }
  startGame(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.phase === PHASES.PLAYING) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft bereits.");
    if (room.players.size < MIN_PLAYERS) throw new GameError("PLAYER_COUNT", `Mindestens ${MIN_PLAYERS} Spieler n\xF6tig.`);
    room.pauses.clear();
    room.game = new LuegenGame([...room.players.values()], { mode: room.settings.mode });
    const g = room.game;
    return { type: "started", startPlayerId: g.currentPlayerId, quads: g.initialQuads, oberLoserId: g.endReason === "ober" ? g.loserId : null, ended: g.phase !== "playing" };
  }
  backToLobby(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.phase === PHASES.PLAYING) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft noch.");
    room.game = null;
    room.pauses.clear();
  }
  #assertHost(room, playerId) {
    if (room.hostId !== playerId) throw new GameError("NOT_HOST", "Nur der Host darf das.");
  }
};

// src/socket/handlers.js
import { randomBytes as randomBytes2 } from "node:crypto";
var GRACE_MS = {
  [PHASES.LOBBY]: 60 * 1e3,
  [PHASES.PLAYING]: 3 * 60 * 1e3,
  [PHASES.FINISHED]: 60 * 1e3
};
var DEFAULT_PAUSE_MS = 10 * 1e3;
var RATE_LIMIT = { windowMs: 2e3, max: 30 };
function registerSocketHandlers(io, rooms, { pauseMs = DEFAULT_PAUSE_MS } = {}) {
  function broadcastState(room) {
    for (const player of room.players.values()) {
      if (player.socketId) io.to(player.socketId).emit(EVT.ROOM_STATE, room.stateFor(player.id));
    }
  }
  function emitEvent(room, event) {
    if (event) io.to(room.code).emit(EVT.GAME_EVENT, { ...event, at: Date.now() });
  }
  function attach(socket, room, player) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) {
        old.leave(room.code);
        old.data = {};
      }
    }
    player.socketId = socket.id;
    player.connected = true;
    socket.data = { code: room.code, playerId: player.id };
    socket.join(room.code);
    socket.emit(EVT.CHAT_HISTORY, room.chat);
    if (room.pauses.delete(player.id)) {
      clearTimeout(player.pauseTimer);
      emitEvent(room, { type: "reconnected", playerId: player.id });
    }
  }
  function assertNotPaused(room) {
    if (room.pauses.size) {
      const [id] = room.pauses.keys();
      throw new GameError("PAUSED", `Pause \u2013 warte auf ${room.players.get(id)?.name ?? "Mitspieler"} \u2026`);
    }
  }
  function detach(socket, room) {
    socket.leave(room.code);
    socket.data = {};
  }
  function on(socket, event, handler) {
    socket.on(event, async (payload, ack) => {
      if (typeof payload === "function") [payload, ack] = [{}, payload];
      const reply = typeof ack === "function" ? ack : () => {
      };
      if (!allow(socket)) return reply({ ok: false, code: "RATE_LIMIT", error: "Langsam, langsam!" });
      try {
        const result = await handler(payload && typeof payload === "object" ? payload : {});
        reply({ ok: true, ...result });
      } catch (err) {
        if (!(err instanceof GameError)) console.error(`[${event}]`, err);
        reply({ ok: false, code: err.code ?? "ERROR", error: err instanceof GameError ? err.message : "Serverfehler" });
      }
    });
  }
  function allow(socket) {
    const now = Date.now();
    const rl = socket.data.__rl ??= { start: now, count: 0 };
    if (now - rl.start > RATE_LIMIT.windowMs) {
      rl.start = now;
      rl.count = 0;
    }
    return ++rl.count <= RATE_LIMIT.max;
  }
  function ctx(socket) {
    const { code, playerId } = socket.data ?? {};
    if (!code || !playerId) throw new GameError("NOT_IN_ROOM", "Du bist in keinem Raum.");
    const room = rooms.getRoom(code);
    const player = room.players.get(playerId);
    if (!player) throw new GameError("NOT_IN_ROOM", "Du bist in keinem Raum.");
    return { room, player };
  }
  function leaveCurrent(socket) {
    const { code, playerId } = socket.data ?? {};
    if (!code) return;
    const room = rooms.rooms.get(code);
    detach(socket, { code });
    if (!room) return;
    const event = rooms.removePlayer(room, playerId);
    emitEvent(room, { type: "left", playerId });
    emitEvent(room, event);
    broadcastState(room);
  }
  function sessionPayload(room, player) {
    return { code: room.code, playerId: player.id, token: player.token };
  }
  io.on("connection", (socket) => {
    socket.data = {};
    on(socket, EVT.ROOM_CREATE, ({ name }) => {
      leaveCurrent(socket);
      const { room, player } = rooms.createRoom(name);
      attach(socket, room, player);
      broadcastState(room);
      return sessionPayload(room, player);
    });
    on(socket, EVT.ROOM_JOIN, ({ code, name }) => {
      leaveCurrent(socket);
      const { room, player } = rooms.joinRoom(code, name);
      attach(socket, room, player);
      emitEvent(room, { type: "joined", playerId: player.id, name: player.name });
      broadcastState(room);
      return sessionPayload(room, player);
    });
    on(socket, EVT.ROOM_REJOIN, ({ code, token }) => {
      const { room, player } = rooms.rejoin(code, token);
      attach(socket, room, player);
      broadcastState(room);
      return sessionPayload(room, player);
    });
    on(socket, EVT.ROOM_LEAVE, () => {
      leaveCurrent(socket);
      return {};
    });
    on(socket, EVT.ROOM_SETTINGS, (settings) => {
      const { room, player } = ctx(socket);
      rooms.updateSettings(room, player.id, settings);
      broadcastState(room);
      return {};
    });
    on(socket, EVT.ROOM_KICK, ({ playerId }) => {
      const { room, player } = ctx(socket);
      if (room.hostId !== player.id) throw new GameError("NOT_HOST", "Nur der Host darf das.");
      if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Nur in der Lobby m\xF6glich.");
      const target = room.players.get(playerId);
      if (!target || target.id === player.id) throw new GameError("BAD_TARGET", "Ung\xFCltiger Spieler.");
      const targetSocket = target.socketId && io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit(EVT.KICKED);
        detach(targetSocket, room);
      }
      rooms.removePlayer(room, target.id);
      emitEvent(room, { type: "left", playerId: target.id, kicked: true });
      broadcastState(room);
      return {};
    });
    on(socket, EVT.GAME_START, () => {
      const { room, player } = ctx(socket);
      emitEvent(room, rooms.startGame(room, player.id));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.GAME_PLAY, ({ cardIds, claimRank, claimCount }) => {
      const { room, player } = ctx(socket);
      if (!room.game) throw new GameError("NOT_PLAYING", "Das Spiel l\xE4uft nicht.");
      assertNotPaused(room);
      emitEvent(room, room.game.play(player.id, cardIds, claimRank, claimCount));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.GAME_CHALLENGE, () => {
      const { room, player } = ctx(socket);
      if (!room.game) throw new GameError("NOT_PLAYING", "Das Spiel l\xE4uft nicht.");
      assertNotPaused(room);
      emitEvent(room, room.game.challenge(player.id));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.GAME_ACCEPT, () => {
      const { room, player } = ctx(socket);
      if (!room.game) throw new GameError("NOT_PLAYING", "Das Spiel l\xE4uft nicht.");
      assertNotPaused(room);
      emitEvent(room, room.game.accept(player.id));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.CHAT_SEND, ({ text }) => {
      const { room, player } = ctx(socket);
      const clean = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LENGTH);
      if (!clean) throw new GameError("EMPTY", "Leere Nachricht.");
      const msg = { id: randomBytes2(6).toString("hex"), playerId: player.id, name: player.name, text: clean, at: Date.now() };
      room.chat.push(msg);
      if (room.chat.length > CHAT_HISTORY_SIZE) room.chat.splice(0, room.chat.length - CHAT_HISTORY_SIZE);
      io.to(room.code).emit(EVT.CHAT_MESSAGE, msg);
      return {};
    });
    on(socket, EVT.GAME_REMATCH, () => {
      const { room, player } = ctx(socket);
      rooms.backToLobby(room, player.id);
      broadcastState(room);
      return {};
    });
    socket.on("disconnect", () => {
      const { code, playerId } = socket.data ?? {};
      if (!code) return;
      const room = rooms.rooms.get(code);
      const player = room?.players.get(playerId);
      if (!player || player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      if (room.game?.phase === PHASES.PLAYING && room.game.order.includes(player.id)) {
        room.pauses.set(player.id, Date.now() + pauseMs);
        emitEvent(room, { type: "disconnected", playerId: player.id, name: player.name, pauseMs });
        clearTimeout(player.pauseTimer);
        player.pauseTimer = setTimeout(() => {
          if (player.connected || !room.pauses.has(player.id)) return;
          room.pauses.delete(player.id);
          if (room.game?.phase === PHASES.PLAYING && room.game.order.includes(player.id)) {
            emitEvent(room, { ...room.game.removePlayer(player.id), reason: "timeout", name: player.name });
          }
          broadcastState(room);
        }, pauseMs);
        player.pauseTimer.unref?.();
      }
      broadcastState(room);
      player.disconnectTimer = setTimeout(() => {
        if (player.connected || !room.players.has(player.id)) return;
        const event = rooms.removePlayer(room, player.id);
        emitEvent(room, { type: "left", playerId: player.id, timeout: true });
        emitEvent(room, event);
        broadcastState(room);
      }, GRACE_MS[room.phase] ?? GRACE_MS[PHASES.LOBBY]);
      player.disconnectTimer.unref?.();
    });
  });
}

// src/tiktok.js
import express from "express";
import { randomBytes as randomBytes3 } from "node:crypto";
var AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
var TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
var USER_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name";
var VIDEOS_URL = "https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,duration";
var COOKIE = "luegen_tt";
var STATE_TTL = 10 * 60 * 1e3;
var config = () => ({
  key: process.env.TIKTOK_CLIENT_KEY?.trim(),
  secret: process.env.TIKTOK_CLIENT_SECRET?.trim(),
  scopes: process.env.TIKTOK_SCOPES?.trim() || "user.info.basic,video.list",
  publicUrl: process.env.PUBLIC_URL?.trim().replace(/\/$/, "")
});
function baseUrl(req) {
  const { publicUrl } = config();
  if (publicUrl) return publicUrl;
  const proto = (req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0];
  return `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
}
function readCookie(req, name) {
  const m = (req.headers.cookie ?? "").match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function popupPage(ok, message) {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TikTok</title><body style="font-family:system-ui;background:#111;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><p style="font-size:20px">${ok ? "\u2713 TikTok verkn\xFCpft" : "TikTok-Anmeldung fehlgeschlagen"}</p>${message ? `<p style="opacity:.7">${esc(message)}</p>` : ""}
<p><a href="/" style="color:#fe2c55">Zur\xFCck zum Spiel</a></p></div>
<script>try{if(window.opener){window.opener.postMessage({type:'tiktok-auth',ok:${ok ? "true" : "false"}},location.origin);setTimeout(()=>window.close(),600)}else{setTimeout(()=>location.replace('/'),1200)}}catch(e){}</script></body></html>`;
}
var LEGAL = {
  datenschutz: `<h1>Datenschutz</h1><p>Die App \u201EL\xFCgen\u201C speichert Spielnamen und Spielst\xE4nde nur w\xE4hrend einer laufenden Partie im Arbeitsspeicher des Servers.
Chat-Nachrichten werden nicht dauerhaft gespeichert. Wer sein TikTok-Konto verkn\xFCpft, erlaubt der App, Anzeigename, Profilbild und die Liste der eigenen
\xF6ffentlichen Videos abzurufen, um sie im TikTok-Fenster anzuzeigen. Der Zugriffsschl\xFCssel liegt nur im Arbeitsspeicher des Servers und wird beim Abmelden
oder Neustart gel\xF6scht. Es werden keine Daten an Dritte weitergegeben.</p>`,
  nutzungsbedingungen: `<h1>Nutzungsbedingungen</h1><p>\u201EL\xFCgen\u201C ist ein kostenloses Freizeit-Kartenspiel. Die Nutzung erfolgt auf eigene Verantwortung.
Beleidigende oder rechtswidrige Inhalte im Chat sind untersagt. Die TikTok-Verkn\xFCpfung ist freiwillig und kann jederzeit \xFCber \u201EAbmelden\u201C beendet werden.</p>`
};
function tiktokRouter() {
  const router = express.Router();
  const states = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const configured = () => Boolean(config().key && config().secret);
  async function tokenRequest(params) {
    const { key, secret } = config();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: key, client_secret: secret, ...params })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `Token-Fehler (${res.status})`);
    return data;
  }
  function store(session, data) {
    session.accessToken = data.access_token;
    session.refreshToken = data.refresh_token ?? session.refreshToken;
    session.expiresAt = Date.now() + (Number(data.expires_in) || 86400) * 1e3 - 6e4;
    session.cache = null;
  }
  async function validToken(session) {
    if (Date.now() < session.expiresAt) return session.accessToken;
    store(session, await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken }));
    return session.accessToken;
  }
  async function loadProfile(session) {
    if (session.cache && Date.now() - session.cacheAt < 6e4) return session.cache;
    const token = await validToken(session);
    const auth = { Authorization: `Bearer ${token}` };
    const userRes = await fetch(USER_URL, { headers: auth }).then((r) => r.json());
    const user = userRes?.data?.user ?? null;
    let videos = [];
    if (config().scopes.includes("video.list")) {
      const vRes = await fetch(VIDEOS_URL, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }) }).then((r) => r.text()).then((t) => JSON.parse(t.replace(/"id"\s*:\s*(\d{15,})/g, '"id":"$1"'))).catch(() => null);
      videos = (vRes?.data?.videos ?? []).map((v) => ({ id: String(v.id), title: v.title ?? "", cover: v.cover_image_url ?? "", duration: v.duration ?? 0 }));
    }
    session.cache = { user, videos };
    session.cacheAt = Date.now();
    return session.cache;
  }
  const sessionOf = (req) => sessions.get(readCookie(req, COOKIE) ?? "") ?? null;
  router.get("/api/tiktok/status", async (req, res) => {
    if (!configured()) return res.json({ configured: false, connected: false });
    const session = sessionOf(req);
    if (!session) return res.json({ configured: true, connected: false });
    try {
      res.json({ configured: true, connected: true, ...await loadProfile(session) });
    } catch (err) {
      sessions.delete(readCookie(req, COOKIE));
      res.json({ configured: true, connected: false, error: err.message });
    }
  });
  router.get("/auth/tiktok/start", (req, res) => {
    if (!configured()) return res.status(503).send(popupPage(false, "Die TikTok-Anmeldung ist auf diesem Server noch nicht eingerichtet."));
    for (const [s, v] of states) if (Date.now() - v.at > STATE_TTL) states.delete(s);
    const state = randomBytes3(16).toString("hex");
    const redirectUri = `${baseUrl(req)}/auth/tiktok/callback`;
    states.set(state, { at: Date.now(), redirectUri });
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({ client_key: config().key, scope: config().scopes, response_type: "code", redirect_uri: redirectUri, state }).toString();
    res.redirect(url.toString());
  });
  router.get("/auth/tiktok/callback", async (req, res) => {
    const { code, state, error, error_description: desc } = req.query;
    const pending = states.get(String(state ?? ""));
    states.delete(String(state ?? ""));
    if (error) return res.send(popupPage(false, desc || String(error)));
    if (!pending || !code) return res.status(400).send(popupPage(false, "Ung\xFCltige oder abgelaufene Anmeldung. Bitte nochmal versuchen."));
    try {
      const data = await tokenRequest({ code: String(code), grant_type: "authorization_code", redirect_uri: pending.redirectUri });
      const sid = randomBytes3(24).toString("hex");
      const session = {};
      store(session, data);
      sessions.set(sid, session);
      const secure = pending.redirectUri.startsWith("https");
      res.setHeader("Set-Cookie", `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`);
      res.send(popupPage(true));
    } catch (err) {
      res.status(502).send(popupPage(false, err.message));
    }
  });
  router.post("/api/tiktok/logout", (req, res) => {
    sessions.delete(readCookie(req, COOKIE) ?? "");
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });
  for (const [slug, body] of Object.entries(LEGAL)) {
    router.get(
      `/${slug}`,
      (_req, res) => res.send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L\xFCgen \u2013 ${slug}</title><body style="font-family:system-ui;max-width:680px;margin:40px auto;padding:0 16px;line-height:1.6">${body}<p><a href="/">Zur\xFCck</a></p></body></html>`)
    );
  }
  return router;
}

// src/app.js
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var CLIENT_ORIGIN = process.env.CLIENT_ORIGIN?.split(",").map((s) => s.trim());
function createLuegenServer({ clientDir, pauseMs } = {}) {
  const app = express2();
  const httpServer2 = createServer(app);
  const io = new Server(httpServer2, {
    cors: { origin: CLIENT_ORIGIN ?? true },
    // in Produktion auf die echte Domain setzen
    // Abbrüche (WLAN weg, Handy gesperrt) schnell bemerken: spätestens nach ~9 s
    pingInterval: 4e3,
    pingTimeout: 5e3
  });
  const rooms = new RoomManager();
  registerSocketHandlers(io, rooms, { pauseMs });
  app.set("trust proxy", true);
  app.use(tiktokRouter());
  app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
  if (clientDir) {
    const PUBLIC = ["manifest.webmanifest", "icon-192.png", "icon-512.png", "favicon.svg"];
    for (const f of PUBLIC) app.get(`/${f}`, (_req, res) => res.sendFile(path.join(clientDir, f)));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
    return { app, httpServer: httpServer2, io, rooms };
  }
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (existsSync(clientDist)) {
    app.use(express2.static(clientDist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }
  return { app, httpServer: httpServer2, io, rooms };
}

// src/deploy-entry.js
var dir = path2.dirname(fileURLToPath2(import.meta.url));
var PORT = Number(process.env.PORT ?? 3001);
var { httpServer } = createLuegenServer({ clientDir: dir });
httpServer.listen(PORT, () => console.log(`L\xFCgen l\xE4uft auf Port ${PORT}`));
