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
var GAMES = { LUEGEN: "luegen", SCHAFKOPF: "schafkopf" };
var GAME_MAX_PLAYERS = { luegen: 7, schafkopf: 4 };
var UNCLAIMABLE_RANK = "O";
var CLAIM_RANKS = RANKS.filter((r) => r !== UNCLAIMABLE_RANK);
var MAX_CARDS_PER_PLAY = 3;
var ROOM_CODE_LENGTH = 4;
var NAME_MAX_LENGTH = 16;
var CHAT_MAX_LENGTH = 200;
var CHAT_HISTORY_SIZE = 60;
var MODES = {
  SAME: "same",
  // Standard: Startspieler wählt den Wert frei, alle bedienen ihn bis „Lügner!“
  ASCENDING: "ascending"
  // Wert steigt mit jedem Zug: 6 → 8 → 9 → 10 → U → K → A → 6 … (Ober wird übersprungen)
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
  ROOM_ADD_BOT: "room:addBot",
  SK_BID: "sk:bid",
  SK_PLAY: "sk:play",
  SK_DOUBLE: "sk:double",
  SK_KNOCK: "sk:knock",
  SK_MARRY: "sk:marry",
  SK_NEXT: "sk:next",
  GAME_START: "game:start",
  GAME_PLAY: "game:play",
  GAME_CHALLENGE: "game:challenge",
  GAME_ACCEPT: "game:accept",
  GAME_REMATCH: "game:rematch",
  CHAT_SEND: "chat:send",
  LOBBY_LIST: "lobby:list",
  // Server → Client
  ROOM_STATE: "room:state",
  GAME_EVENT: "game:event",
  KICKED: "room:kicked",
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history"
};
function nextRank(rank) {
  const i = RANKS.indexOf(rank);
  for (let step = 1; step <= RANKS.length; step++) {
    const r = RANKS[(i + step) % RANKS.length];
    if (r !== UNCLAIMABLE_RANK) return r;
  }
  return CLAIM_RANKS[0];
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
    this.lastPickerId = null;
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
    if (claimRank === UNCLAIMABLE_RANK) throw new GameError("OBER_CLAIM", "Ober darf man nicht ansagen \u2013 nur untermogeln.");
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
    this.lastPickerId = loserId;
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
    const inPlay = [...this.order.flatMap((id) => this.hands.get(id)), ...this.pile];
    const holders = this.order.filter((id) => this.hands.get(id).length > 0);
    if (inPlay.length && holders.length >= 2 && inPlay.every((c) => c.rank === LOSING_RANK)) {
      const most = Math.max(...holders.map((id) => this.hands.get(id).length));
      const tied = holders.filter((id) => this.hands.get(id).length === most);
      const loser = tied.find((id) => id === this.lastPickerId) ?? tied.find((id) => id === this.currentPlayerId) ?? tied[0];
      this.#finish(loser, "ober_patt");
      return true;
    }
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

// ../shared/game/bot.js
var DIFFICULTY = {
  easy: { sharp: 0.35, noise: 0.25 },
  normal: { sharp: 0.75, noise: 0.12 },
  hard: { sharp: 1, noise: 0.05 }
};
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function countByRank(hand) {
  const m = /* @__PURE__ */ new Map();
  for (const c of hand) m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  return m;
}
function challengeChance(view, persona, memory = {}, rand = Math.random) {
  const last = view.lastPlay;
  if (!last) return 0;
  const mine = view.hand.filter((c) => c.rank === last.claimRank).length;
  if (rand() < persona.sharp) {
    if (mine + last.claimCount > 4) return 1;
    if (view.discardedRanks?.includes(last.claimRank)) return 1;
    const roundTotal = memory.claimed?.[last.claimRank] ?? last.claimCount;
    if (mine + roundTotal > 4) return 0.9;
  }
  let p = persona.suspicion;
  const myOber = view.hand.filter((c) => c.rank === "O").length;
  if (myOber >= 3) p -= 0.5;
  else if (myOber === 2) p -= 0.2;
  p += 0.09 * (last.claimCount - 1);
  p += 0.11 * mine;
  p -= 0.012 * view.pileCount;
  const claimantCards = view.cardCounts[last.playerId] ?? 0;
  if (claimantCards <= 2) p += 0.15;
  if (view.pendingOutId) p = Math.max(p + 0.3, 0.6);
  const required = view.requiredRank;
  if (required && !view.pendingOutId && !view.hand.some((c) => c.rank === required)) p += 0.12;
  return clamp(p, 0.04, 0.96);
}
function choosePlay(view, persona, rand = Math.random) {
  const hand = view.hand;
  const counts = countByRank(hand);
  const required = view.requiredRank;
  let claimRank = required;
  if (!claimRank) {
    const own = [...counts.entries()].filter(([r]) => CLAIM_RANKS.includes(r));
    if (own.length) {
      const best = Math.max(...own.map(([, n]) => n));
      const candidates = own.filter(([, n]) => n === best).map(([r]) => r);
      claimRank = candidates[Math.floor(rand() * candidates.length)];
    } else {
      const open = CLAIM_RANKS.filter((r) => !view.discardedRanks?.includes(r));
      const pool = open.length ? open : CLAIM_RANKS;
      claimRank = pool[Math.floor(rand() * pool.length)];
    }
  }
  const honest = hand.filter((c) => c.rank === claimRank).slice(0, MAX_CARDS_PER_PLAY);
  const junk = hand.filter((c) => c.rank !== claimRank).sort(
    (a, b) => (b.rank === "O") - (a.rank === "O") || // Ober zuerst als Bluff-Karten verwenden
    counts.get(a.rank) - counts.get(b.rank) || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)
  );
  let cards;
  if (honest.length > 0) {
    cards = [...honest];
    const myOber = counts.get("O") ?? 0;
    const oberUrge = myOber >= 2 ? 0.9 : myOber === 1 ? 0.45 : 0;
    const extra = honest.length < MAX_CARDS_PER_PLAY && junk.length > 0 && rand() < persona.bluff * 0.45 + oberUrge;
    if (extra) cards.push(junk[0]);
  } else {
    const obers = junk.filter((c) => c.rank === "O").length;
    const n = junk.length >= 2 && (obers >= 2 || rand() < 0.3 + persona.bluff * 0.3) ? 2 : 1;
    cards = junk.slice(0, n);
  }
  let claimCount = cards.length;
  if (claimCount < MAX_CARDS_PER_PLAY && rand() < persona.bluff * 0.12) claimCount += 1;
  return { type: "play", cardIds: cards.map((c) => c.id), claimRank, claimCount };
}
function decide(view, persona, memory = {}, rand = Math.random) {
  if (view.pendingOutId) {
    return rand() < challengeChance(view, persona, memory, rand) ? { type: "challenge" } : { type: "accept" };
  }
  if (view.lastPlay && rand() < challengeChance(view, persona, memory, rand)) return { type: "challenge" };
  return choosePlay(view, persona, rand);
}
function makePersona(base, difficulty = "normal", rand = Math.random) {
  const d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  const jitter = () => (rand() - 0.5) * 2 * d.noise;
  return {
    bluff: clamp((base?.bluff ?? 0.4) + jitter(), 0.05, 0.95),
    suspicion: clamp((base?.suspicion ?? 0.25) + jitter(), 0.05, 0.6),
    sharp: d.sharp
  };
}
var BOT_ROSTER = [
  { character: "resi", name: "Resi", persona: { bluff: 0.3, suspicion: 0.32 } },
  { character: "toni", name: "Toni", persona: { bluff: 0.55, suspicion: 0.2 } },
  { character: "sepp", name: "Opa Sepp", persona: { bluff: 0.7, suspicion: 0.25 } },
  { character: "vroni", name: "Vroni", persona: { bluff: 0.45, suspicion: 0.3 } },
  { character: "hias", name: "Hias", persona: { bluff: 0.35, suspicion: 0.4 } },
  { character: "kathi", name: "Kathi", persona: { bluff: 0.5, suspicion: 0.28 } },
  { character: "franz", name: "Franz", persona: { bluff: 0.25, suspicion: 0.22 } },
  { character: "lena", name: "Lena", persona: { bluff: 0.6, suspicion: 0.35 } }
];
var CHARACTER_ORDER = BOT_ROSTER.map((b) => b.character);

// ../shared/schafkopf/rules.js
var SK_DECKS = {
  lang: { ranks: ["8", "9", "10", "U", "O", "K", "A"], label: "Mit Achtern", handSize: 7, davonlaufen: 4 },
  kurz: { ranks: ["9", "10", "U", "O", "K", "A"], label: "Kurzes Blatt", handSize: 6, davonlaufen: 3 }
};
var SK_PLAYERS = 4;
var CARD_POINTS = { A: 11, 10: 10, K: 4, O: 3, U: 2, 9: 0, 8: 0 };
var SK_EXTRAS = {
  hochzeit: { label: "Hochzeit", default: true },
  bettel: { label: "Bettel & Bettel Brett", default: true },
  geier: { label: "Geier & Farbgeier", default: true },
  farbwenz: { label: "Farbwenz", default: true },
  klopfen: { label: "Klopfen", default: false },
  supra: { label: "Supra & Resupra", default: true }
};
var defaultExtras = () => Object.fromEntries(Object.entries(SK_EXTRAS).map(([k, v]) => [k, v.default]));
var SK_PASS = { ramsch: "Ramsch", stock: "Stock", thrown: "Zusammenwerfen" };
var SK_TARIF = { ruf: 10, hochzeit: 20, bettel: 30, bettelBrett: 60, solo: 50, extra: 10, ramsch: 20 };
var BASE = {
  sauspiel: { rank: 1, label: "Sauspiel", lords: "OU", trumpSuit: "herz", tarif: "ruf", partner: true },
  hochzeit: { rank: 1, label: "Hochzeit", lords: "OU", trumpSuit: "herz", tarif: "hochzeit", partner: true, extra: "hochzeit" },
  bettel: { rank: 2, label: "Bettel", lords: "", solo: true, bettel: true, tarif: "bettel", extra: "bettel" },
  bettel_brett: { rank: 3, label: "Bettel Brett", lords: "", solo: true, bettel: true, open: true, tarif: "bettelBrett", extra: "bettel" },
  farbgeier: { rank: 4, label: "Farbgeier", lords: "O", suit: true, solo: true, tarif: "solo", extra: "geier" },
  geier: { rank: 5, label: "Geier", lords: "O", solo: true, tarif: "solo", extra: "geier" },
  farbwenz: { rank: 6, label: "Farbwenz", lords: "U", suit: true, solo: true, tarif: "solo", extra: "farbwenz" },
  wenz: { rank: 7, label: "Wenz", lords: "U", solo: true, tarif: "solo" },
  solo: { rank: 8, label: "Solo", lords: "OU", suit: true, solo: true, tarif: "solo" }
};
var TOUT_ORDER = ["farbgeier", "geier", "farbwenz", "wenz", "solo"];
var CONTRACTS = Object.fromEntries([
  ...Object.entries(BASE).map(([k, v]) => [k, { ...v, family: k.startsWith("bettel") ? "bettel" : k }]),
  ...TOUT_ORDER.map((k, i) => [`${k}_tout`, { ...BASE[k], rank: 9 + i, label: `${BASE[k].label}-Tout`, tout: true, family: k }])
]);
var RAMSCH = { rank: 0, label: "Ramsch", lords: "OU", trumpSuit: "herz", family: "ramsch" };
var CALLABLE_SUITS = ["eichel", "gras", "schellen"];
var SUIT_ORDER = { eichel: 3, gras: 2, herz: 1, schellen: 0 };
var PLAIN_ORDER = { A: 8, 10: 7, K: 6, O: 5, U: 5, 9: 4, 8: 3 };
var BETTEL_ORDER = { A: 8, K: 7, O: 6, U: 5, 10: 4, 9: 3, 8: 2 };
function meta(contract) {
  if (!contract) return CONTRACTS.sauspiel;
  if (contract.type === "ramsch") return RAMSCH;
  return CONTRACTS[contract.type] ?? CONTRACTS.sauspiel;
}
function createSkDeck(variant = "lang") {
  const ranks = (SK_DECKS[variant] ?? SK_DECKS.lang).ranks;
  return SUITS.flatMap((suit) => ranks.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })));
}
var cardPoints = (cards) => cards.reduce((s, c) => s + (CARD_POINTS[c.rank] ?? 0), 0);
function trumpSuitOf(contract) {
  const m = meta(contract);
  if (m.trumpSuit) return m.trumpSuit;
  return m.suit ? contract.suit : null;
}
function isTrump(card, contract) {
  const m = meta(contract);
  if (m.bettel) return false;
  if (m.lords.includes(card.rank)) return true;
  const ts = trumpSuitOf(contract);
  return ts !== null && card.suit === ts;
}
function plainPower(card, contract) {
  return (meta(contract).bettel ? BETTEL_ORDER : PLAIN_ORDER)[card.rank] ?? 0;
}
function trumpPower(card, contract) {
  if (!isTrump(card, contract)) return -1;
  const { lords } = meta(contract);
  if (lords.includes(card.rank)) return (lords === "OU" && card.rank === "U" ? 30 : 40) + SUIT_ORDER[card.suit];
  return 20 + plainPower(card, contract);
}
var followSuit = (card, contract) => isTrump(card, contract) ? "trumpf" : card.suit;
function beats(a, b, led, contract) {
  const ta = trumpPower(a, contract);
  const tb = trumpPower(b, contract);
  if (ta >= 0 || tb >= 0) return ta > tb;
  if (a.suit !== b.suit) return a.suit === led;
  return plainPower(a, contract) > plainPower(b, contract);
}
function trickWinnerIndex(cards, contract) {
  const led = followSuit(cards[0], contract);
  let best = 0;
  for (let i = 1; i < cards.length; i++) if (beats(cards[i], cards[best], led, contract)) best = i;
  return best;
}
function trumpOrder(contract, variant = "lang") {
  return createSkDeck(variant).filter((c) => isTrump(c, contract)).sort((a, b) => trumpPower(b, contract) - trumpPower(a, contract));
}
function laufendeMin(contract) {
  const m = meta(contract);
  if (m.bettel || m.family === "ramsch") return Infinity;
  return m.family === "wenz" || m.family === "geier" ? 2 : 3;
}
function sortSkHand(cards, contract) {
  const suitRank = { eichel: 0, gras: 1, herz: 2, schellen: 3 };
  return [...cards].sort((a, b) => {
    const ta = trumpPower(a, contract);
    const tb = trumpPower(b, contract);
    if (ta >= 0 || tb >= 0) return tb - ta;
    if (a.suit !== b.suit) return suitRank[a.suit] - suitRank[b.suit];
    return plainPower(b, contract) - plainPower(a, contract);
  });
}
function legalCards(hand, ctx) {
  const { contract, trick, calledSuit, searched, lastTrick } = ctx;
  const sau = calledSuit && !searched ? hand.find((c) => c.suit === calledSuit && c.rank === "A") : null;
  const ofCalled = (c) => calledSuit && !isTrump(c, contract) && c.suit === calledSuit;
  if (!trick.length) {
    if (!sau) return hand;
    if (hand.filter(ofCalled).length >= (ctx.davonlaufen ?? 4)) return hand;
    return hand.filter((c) => !ofCalled(c) || c === sau);
  }
  const led = followSuit(trick[0], contract);
  if (sau && led === calledSuit) return [sau];
  const follow = hand.filter((c) => followSuit(c, contract) === led);
  if (follow.length) return follow;
  if (sau && !lastTrick) {
    const rest = hand.filter((c) => c !== sau);
    if (rest.length) return rest;
  }
  return hand;
}

// ../shared/schafkopf/SchafkopfGame.js
var SK_PHASES = { KLOPFEN: "klopfen", BIDDING: "bidding", WEDDING: "wedding", PLAYING: "playing", SCORED: "scored" };
var DOUBLE_KINDS = ["kontra", "re", "supra", "resupra"];
var SAUSPIEL = { type: "sauspiel" };
var SchafkopfGame = class {
  /**
   * @param {{id:string}[]} players genau 4, in Sitzreihenfolge (im Uhrzeigersinn)
   * @param {{variant?:'lang'|'kurz', pass?:'ramsch'|'stock'|'thrown', ramsch?:boolean, extras?:object, dealerIndex?:number, rand?:Function, deck?:object[]}} opts
   */
  constructor(players, { variant = "lang", pass, ramsch, extras, dealerIndex, rand = randomInt, deck } = {}) {
    if (players.length !== SK_PLAYERS) throw new GameError("SK_PLAYERS", "Schafkopf spielt man zu viert.");
    this.kind = "schafkopf";
    this.order = players.map((p) => p.id);
    this.variant = SK_DECKS[variant] ? variant : "lang";
    this.pass = pass ?? (ramsch === false ? "thrown" : "ramsch");
    this.extras = { ...defaultExtras(), ...extras ?? {} };
    this.rand = rand;
    this.dealerIndex = dealerIndex ?? rand(SK_PLAYERS);
    this.balances = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.stock = 0;
    this.history = [];
    this.round = 0;
    this.seq = 0;
    this.#deal(deck);
  }
  get handSize() {
    return SK_DECKS[this.variant].handSize;
  }
  get dealerId() {
    return this.order[this.dealerIndex];
  }
  get forehandIndex() {
    return (this.dealerIndex + 1) % SK_PLAYERS;
  }
  get currentPlayerId() {
    return this.order[this.turn];
  }
  get completedTricks() {
    return this.tricks.length;
  }
  get multiplier() {
    return 2 ** (this.knocks.length + this.doubles.length);
  }
  /** erste Hälfte der Karten (beim Klopfen sichtbar): 4 von 7 bzw. 3 von 6 */
  get firstHalf() {
    return Math.ceil(this.handSize / 2);
  }
  #deal(deck) {
    this.round += 1;
    const cards = deck ? [...deck] : shuffle(createSkDeck(this.variant), this.rand);
    this.hands = /* @__PURE__ */ new Map();
    this.order.forEach((id, i) => {
      const seat = (i - this.forehandIndex + SK_PLAYERS) % SK_PLAYERS;
      this.hands.set(id, cards.slice(seat * this.handSize, (seat + 1) * this.handSize));
    });
    this.dealt = new Map([...this.hands].map(([id, h]) => [id, [...h]]));
    this.knocks = [];
    this.knockVotes = [];
    this.bids = [];
    this.contract = null;
    this.wedding = null;
    this.turn = this.forehandIndex;
    this.trick = [];
    this.tricks = [];
    this.won = Object.fromEntries(this.order.map((id) => [id, []]));
    this.searched = false;
    this.ranAway = false;
    this.partnerRevealed = false;
    this.doubles = [];
    this.result = null;
    this.phase = this.extras.klopfen ? SK_PHASES.KLOPFEN : SK_PHASES.BIDDING;
    this.seq += 1;
  }
  /** Nächstes Spiel: Geber rückt weiter, Kontostände und Stock bleiben. */
  nextDeal(deck) {
    if (this.phase !== SK_PHASES.SCORED) throw new GameError("NOT_SCORED", "Das Spiel l\xE4uft noch.");
    this.dealerIndex = this.forehandIndex;
    this.#deal(deck);
    return { type: "sk_deal", dealerId: this.dealerId, round: this.round };
  }
  #assertTurn(playerId, phase) {
    if (this.phase !== phase) throw new GameError("WRONG_PHASE", "Das geht gerade nicht.");
    if (this.currentPlayerId !== playerId) throw new GameError("NOT_YOUR_TURN", "Du bist nicht dran.");
  }
  // ───────────── Klopfen ─────────────
  knock(playerId, yes) {
    this.#assertTurn(playerId, SK_PHASES.KLOPFEN);
    this.knockVotes.push(playerId);
    if (yes) this.knocks.push(playerId);
    this.seq += 1;
    const event = { type: "sk_knock", playerId, yes: !!yes };
    this.turn = (this.turn + 1) % SK_PLAYERS;
    if (this.knockVotes.length === SK_PLAYERS) {
      this.phase = SK_PHASES.BIDDING;
      this.turn = this.forehandIndex;
    }
    return event;
  }
  // ───────────── Ansage ─────────────
  #bestBid() {
    let best = null;
    for (const b of this.bids) if (b.contract && (!best || CONTRACTS[b.contract.type].rank > CONTRACTS[best.contract.type].rank)) best = b;
    return best;
  }
  #enabled(type) {
    const extra = CONTRACTS[type]?.extra;
    return !extra || this.extras[extra];
  }
  /** Welche Spiele darf dieser Spieler jetzt ansagen? */
  allowedBids(playerId) {
    if (this.phase !== SK_PHASES.BIDDING || this.currentPlayerId !== playerId) return [];
    const best = this.#bestBid();
    const min = best ? CONTRACTS[best.contract.type].rank : 0;
    const hand = this.hands.get(playerId);
    const out = [];
    for (const [type, m] of Object.entries(CONTRACTS)) {
      if (m.rank <= min || !this.#enabled(type)) continue;
      if (type === "sauspiel") {
        for (const suit of CALLABLE_SUITS) {
          const hasAce = hand.some((c) => c.suit === suit && c.rank === "A");
          const hasSuit = hand.some((c) => c.suit === suit && c.rank !== "O" && c.rank !== "U");
          if (!hasAce && hasSuit) out.push({ type, suit });
        }
      } else if (type === "hochzeit") {
        if (hand.filter((c) => isTrump(c, SAUSPIEL)).length === 1) out.push({ type });
      } else if (m.suit) {
        for (const suit of SUITS) out.push({ type, suit });
      } else out.push({ type });
    }
    return out;
  }
  /** Ansage: contract = null („weiter“) oder { type, suit? }. */
  bid(playerId, contract) {
    this.#assertTurn(playerId, SK_PHASES.BIDDING);
    if (contract) {
      const ok = this.allowedBids(playerId).some((b) => b.type === contract.type && (b.suit ?? null) === (contract.suit ?? null));
      if (!ok) {
        const best = this.#bestBid();
        if (!CONTRACTS[contract.type] || !this.#enabled(contract.type)) throw new GameError("BAD_BID", "Dieses Spiel wird an diesem Tisch nicht gespielt.");
        if (best && CONTRACTS[best.contract.type].rank >= CONTRACTS[contract.type].rank)
          throw new GameError("BID_TOO_LOW", "Da ist schon ein gleich hohes oder h\xF6heres Spiel angesagt.");
        if (contract.type === "sauspiel") throw new GameError("BAD_CALL", "Auf diese Sau kannst du nicht spielen (Farbe fehlt oder du hast die Sau selbst).");
        if (contract.type === "hochzeit") throw new GameError("BAD_WEDDING", "Eine Hochzeit kann man nur mit genau einem Trumpf anbieten.");
        throw new GameError("BAD_BID", "Dieses Spiel geht so nicht.");
      }
      contract = { type: contract.type, ...contract.suit && { suit: contract.suit } };
    }
    this.bids.push({ playerId, contract: contract ?? null });
    this.seq += 1;
    const event = { type: "sk_bid", playerId, contract: contract ?? null };
    if (this.bids.length < SK_PLAYERS) {
      this.turn = (this.turn + 1) % SK_PLAYERS;
      return event;
    }
    return { ...event, ...this.#finishBidding() };
  }
  #finishBidding() {
    const best = this.#bestBid();
    if (!best) return this.#allPassed();
    const c = best.contract;
    if (c.type === "hochzeit") {
      const i = this.order.indexOf(best.playerId);
      const candidates = [1, 2, 3].map((k) => this.order[(i + k) % SK_PLAYERS]);
      this.wedding = { offererId: best.playerId, candidates, asked: 0 };
      this.phase = SK_PHASES.WEDDING;
      this.#nextWeddingCandidate();
      this.seq += 1;
      return { wedding: { offererId: best.playerId } };
    }
    this.contract = { ...c, declarerId: best.playerId };
    if (c.type === "sauspiel") {
      this.contract.calledSuit = c.suit;
      this.contract.partnerId = this.order.find((id) => this.hands.get(id).some((x) => x.suit === c.suit && x.rank === "A"));
    }
    this.#startPlay();
    return { final: this.publicContract() };
  }
  #startPlay() {
    this.phase = SK_PHASES.PLAYING;
    this.turn = this.forehandIndex;
    this.seq += 1;
  }
  #allPassed() {
    if (this.pass === "ramsch") {
      this.contract = { type: "ramsch" };
      this.#startPlay();
      return { final: this.publicContract() };
    }
    const payout = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.phase = SK_PHASES.SCORED;
    if (this.pass === "stock") {
      const each = SK_TARIF.ruf * 2 ** this.knocks.length;
      for (const id of this.order) {
        payout[id] = -each;
        this.balances[id] -= each;
      }
      this.stock += each * SK_PLAYERS;
      this.result = { type: "stock", each, stockTotal: this.stock, payout };
      this.history.unshift({ round: this.round, label: "Stock", payout });
      this.seq += 1;
      return { stock: this.stock };
    }
    this.result = { type: "thrown", payout };
    this.history.unshift({ round: this.round, label: "Zusammengeworfen", payout });
    this.seq += 1;
    return { thrown: true };
  }
  // ───────────── Hochzeit ─────────────
  #canMarry(playerId) {
    return this.hands.get(playerId).some((c) => !isTrump(c, SAUSPIEL));
  }
  #nextWeddingCandidate() {
    const w = this.wedding;
    while (w.asked < w.candidates.length && !this.#canMarry(w.candidates[w.asked])) w.asked += 1;
    if (w.asked >= w.candidates.length) return false;
    this.turn = this.order.indexOf(w.candidates[w.asked]);
    return true;
  }
  /** Hochzeit annehmen (cardId = Fehlkarte, die man dafür hergibt) oder ablehnen (null). */
  marry(playerId, cardId) {
    this.#assertTurn(playerId, SK_PHASES.WEDDING);
    const w = this.wedding;
    this.seq += 1;
    if (!cardId) {
      w.asked += 1;
      const event = { type: "sk_marry", playerId, accepted: false };
      if (!this.#nextWeddingCandidate()) return { ...event, nobody: true, ...this.#allPassed() };
      return event;
    }
    const hand = this.hands.get(playerId);
    const give = hand.find((c) => c.id === cardId);
    if (!give || isTrump(give, SAUSPIEL)) throw new GameError("BAD_GIFT", "F\xFCr die Hochzeit gibst du eine Fehlkarte (keinen Trumpf) her.");
    const offerHand = this.hands.get(w.offererId);
    const trump = offerHand.find((c) => isTrump(c, SAUSPIEL));
    offerHand.splice(offerHand.indexOf(trump), 1, give);
    hand.splice(hand.indexOf(give), 1, trump);
    this.contract = { type: "hochzeit", declarerId: w.offererId, partnerId: playerId };
    this.partnerRevealed = true;
    this.#startPlay();
    return { type: "sk_marry", playerId, accepted: true, final: this.publicContract() };
  }
  // ───────────── Spiel ─────────────
  publicContract(viewerId) {
    if (!this.contract) return null;
    const { partnerId, ...rest } = this.contract;
    const showPartner = partnerId && (this.partnerRevealed || viewerId === partnerId || this.phase === SK_PHASES.SCORED);
    return { ...rest, ...showPartner && { partnerId }, tout: !!CONTRACTS[this.contract.type]?.tout };
  }
  #team(playerId) {
    const c = this.contract;
    if (!c || c.type === "ramsch") return null;
    return playerId === c.declarerId || playerId === c.partnerId ? "player" : "opp";
  }
  #ctxFor(playerId) {
    const c = this.contract;
    const holder = c?.calledSuit && c.partnerId === playerId;
    return {
      contract: c,
      trick: this.trick.map((t) => t.card),
      calledSuit: holder ? c.calledSuit : null,
      searched: this.searched,
      lastTrick: this.hands.get(playerId).length === 1,
      davonlaufen: SK_DECKS[this.variant].davonlaufen
    };
  }
  legalFor(playerId) {
    if (this.phase !== SK_PHASES.PLAYING || this.currentPlayerId !== playerId) return [];
    return legalCards(this.hands.get(playerId), this.#ctxFor(playerId));
  }
  /** Welche Verdopplung darf dieser Spieler jetzt geben? 'kontra' | 're' | 'supra' | 'resupra' | null */
  doubleKindFor(playerId) {
    if (this.phase !== SK_PHASES.PLAYING || !this.contract || this.contract.type === "ramsch") return null;
    const kind = DOUBLE_KINDS[this.doubles.length];
    if (!kind) return null;
    if ((kind === "supra" || kind === "resupra") && !this.extras.supra) return null;
    if (this.completedTricks > this.doubles.length) return null;
    const side = kind === "kontra" || kind === "supra" ? "opp" : "player";
    return this.#team(playerId) === side ? kind : null;
  }
  /** Kontra/Re/Supra/Resupra – verdoppelt jeweils. */
  double(playerId, expected) {
    const kind = this.doubleKindFor(playerId);
    if (!kind || expected && expected !== kind) throw new GameError("NO_DOUBLE", "Das geht jetzt nicht.");
    this.doubles.push({ kind, playerId });
    if (playerId === this.contract.partnerId) this.partnerRevealed = true;
    this.seq += 1;
    return { type: "sk_double", kind, playerId };
  }
  canKontra(playerId) {
    return this.doubleKindFor(playerId) === "kontra";
  }
  canRe(playerId) {
    return this.doubleKindFor(playerId) === "re";
  }
  kontra(playerId) {
    return this.double(playerId, "kontra");
  }
  re(playerId) {
    return this.double(playerId, "re");
  }
  get kontraBy() {
    return this.doubles.find((d) => d.kind === "kontra")?.playerId ?? null;
  }
  get reBy() {
    return this.doubles.find((d) => d.kind === "re")?.playerId ?? null;
  }
  play(playerId, cardId) {
    this.#assertTurn(playerId, SK_PHASES.PLAYING);
    const hand = this.hands.get(playerId);
    const card = hand.find((c2) => c2.id === cardId);
    if (!card) throw new GameError("NOT_IN_HAND", "Diese Karte hast du nicht.");
    const c = this.contract;
    if (!this.legalFor(playerId).includes(card)) {
      if (c?.calledSuit && c.partnerId === playerId && !this.searched && card.suit === c.calledSuit && card.rank === "A")
        throw new GameError("SAU_HOLD", "Die gerufene Sau darfst du nicht abwerfen.");
      if (this.trick.length) throw new GameError("MUST_FOLLOW", "Du musst bedienen.");
      throw new GameError("MUST_LEAD_SAU", "Die Ruffarbe darfst du nur mit der Sau anspielen (Davonlaufen erst ab 4 Karten).");
    }
    const event = { type: "sk_play", playerId, card };
    if (c?.calledSuit && !isTrump(card, c) && card.suit === c.calledSuit) {
      if (!this.trick.length && !this.searched && playerId === c.partnerId && card.rank !== "A") {
        this.ranAway = true;
        this.partnerRevealed = true;
        event.ranAway = true;
      }
      if (card.rank === "A") {
        this.partnerRevealed = true;
        event.sau = true;
      }
    }
    hand.splice(hand.indexOf(card), 1);
    this.trick.push({ playerId, card });
    this.seq += 1;
    if (this.trick.length < SK_PLAYERS) {
      this.turn = (this.turn + 1) % SK_PLAYERS;
      return event;
    }
    const cards = this.trick.map((t) => t.card);
    const winnerId = this.trick[trickWinnerIndex(cards, c)].playerId;
    if (c?.calledSuit && !isTrump(cards[0], c) && cards[0].suit === c.calledSuit) this.searched = true;
    const points = cardPoints(cards);
    this.won[winnerId].push(...cards);
    this.tricks.push({ cards: this.trick, winnerId, points });
    this.trick = [];
    this.turn = this.order.indexOf(winnerId);
    event.trickDone = { winnerId, points, cards: this.tricks.at(-1).cards };
    const m = meta(c);
    const toutBroken = m.tout && this.#team(winnerId) === "opp";
    const bettelBroken = m.bettel && winnerId === c.declarerId;
    if (toutBroken || bettelBroken || this.hands.get(this.order[0]).length === 0) {
      this.#score(toutBroken || bettelBroken);
      event.result = this.result;
    }
    return event;
  }
  /** Laufende: wie viele höchste Trümpfe ununterbrochen bei einer Partei (ab Schwelle). */
  #laufende() {
    const c = this.contract;
    const order = trumpOrder(c, this.variant);
    if (!order.length) return 0;
    const holder = (card) => this.order.find((id) => this.dealt.get(id).some((x) => x.id === card.id));
    const side = (id) => this.#team(id);
    const first = side(holder(order[0]));
    let n = 0;
    for (const card of order) {
      if (side(holder(card)) !== first) break;
      n += 1;
    }
    return n >= laufendeMin(c) ? n : 0;
  }
  #score(brokenEarly = false) {
    const c = this.contract;
    const m = meta(c);
    this.phase = SK_PHASES.SCORED;
    this.partnerRevealed = true;
    const pointsOf = (id) => cardPoints(this.won[id]);
    const tricksOf = (id) => this.tricks.filter((t) => t.winnerId === id).length;
    const payout = Object.fromEntries(this.order.map((id) => [id, 0]));
    const knockMult = 2 ** this.knocks.length;
    if (c.type === "ramsch") {
      const pts2 = Object.fromEntries(this.order.map((id) => [id, pointsOf(id)]));
      const tricks = Object.fromEntries(this.order.map((id) => [id, tricksOf(id)]));
      const durch = this.order.find((id) => tricks[id] === this.tricks.length);
      let value;
      let loserId = null;
      if (durch) {
        value = (SK_TARIF.solo + 2 * SK_TARIF.extra) * knockMult;
        for (const id of this.order) payout[id] = id === durch ? 3 * value : -value;
      } else {
        const highestTrump = (id) => Math.max(-1, ...this.won[id].map((x) => trumpPower(x, c)));
        loserId = [...this.order].sort((a, b) => pts2[b] - pts2[a] || tricks[b] - tricks[a] || highestTrump(b) - highestTrump(a))[0];
        const jungfrauen = this.order.filter((id) => tricks[id] === 0);
        value = SK_TARIF.ramsch * 2 ** jungfrauen.length * knockMult;
        for (const id of this.order) payout[id] = id === loserId ? -3 * value : value;
      }
      this.result = { type: "ramsch", points: pts2, tricks, loserId, durchmarschId: durch ?? null, jungfrauen: this.order.filter((id) => tricks[id] === 0), knocks: this.knocks.length, value, payout };
    } else {
      const team = this.order.filter((id) => this.#team(id) === "player");
      const opps = this.order.filter((id) => this.#team(id) === "opp");
      const teamPts = team.reduce((s, id) => s + pointsOf(id), 0);
      const teamTricks = team.reduce((s, id) => s + tricksOf(id), 0);
      const allTricks = this.tricks.length === this.handSize;
      let won;
      let schneider = false;
      let schwarz = false;
      let laufende = 0;
      if (m.bettel) won = !brokenEarly && teamTricks === 0;
      else if (m.tout) won = !brokenEarly && allTricks && teamTricks === this.handSize;
      else {
        won = teamPts >= 61;
        schneider = won ? teamPts >= 91 : teamPts <= 30;
        schwarz = won ? teamTricks === this.handSize : teamTricks === 0;
      }
      if (!m.bettel) laufende = this.#laufende();
      let value = SK_TARIF[m.tarif] + laufende * SK_TARIF.extra;
      if (m.tout) value *= 2;
      else value += (schneider ? SK_TARIF.extra : 0) + (schwarz ? SK_TARIF.extra : 0);
      value *= this.multiplier;
      const sign = won ? 1 : -1;
      if (m.solo) {
        payout[c.declarerId] = sign * 3 * value;
        for (const id of opps) payout[id] = -sign * value;
      } else {
        for (const id of team) payout[id] = sign * value;
        for (const id of opps) payout[id] = -sign * value;
      }
      let stock = null;
      if (m.partner && this.stock > 0) {
        const share = this.stock / team.length;
        stock = { before: this.stock };
        for (const id of team) payout[id] += won ? share : -share;
        this.stock = won ? 0 : this.stock * 2;
        stock.after = this.stock;
        stock.won = won;
      }
      this.result = {
        type: c.type,
        contract: this.publicContract(),
        team,
        teamPoints: teamPts,
        oppPoints: 120 - teamPts - this.#unplayedPoints(),
        teamTricks,
        won,
        schneider,
        schwarz,
        laufende,
        knocks: this.knocks.length,
        doubles: this.doubles.map((d) => d.kind),
        kontra: this.doubles.length > 0,
        re: this.doubles.length > 1,
        brokenEarly,
        toutBroken: m.tout && brokenEarly,
        stock,
        value,
        payout
      };
    }
    for (const id of this.order) this.balances[id] += payout[id];
    this.history.unshift({ round: this.round, contract: this.publicContract(), payout });
    this.history = this.history.slice(0, 20);
    this.seq += 1;
  }
  #unplayedPoints() {
    return this.order.reduce((s, id) => s + cardPoints(this.hands.get(id)), 0);
  }
  replacePlayer(oldId, newId2) {
    const i = this.order.indexOf(oldId);
    if (i < 0) return;
    this.order[i] = newId2;
    for (const m of [this.hands, this.dealt]) {
      m.set(newId2, m.get(oldId));
      m.delete(oldId);
    }
    this.won[newId2] = this.won[oldId];
    delete this.won[oldId];
    this.balances[newId2] = this.balances[oldId];
    delete this.balances[oldId];
    const swap = (id) => id === oldId ? newId2 : id;
    if (this.contract) {
      this.contract.declarerId = swap(this.contract.declarerId);
      if (this.contract.partnerId) this.contract.partnerId = swap(this.contract.partnerId);
    }
    if (this.wedding) {
      this.wedding.offererId = swap(this.wedding.offererId);
      this.wedding.candidates = this.wedding.candidates.map(swap);
    }
    for (const t of [...this.trick, ...this.tricks.flatMap((x) => x.cards)]) t.playerId = swap(t.playerId);
    for (const t of this.tricks) t.winnerId = swap(t.winnerId);
    for (const b of this.bids) b.playerId = swap(b.playerId);
    for (const d of this.doubles) d.playerId = swap(d.playerId);
    this.knocks = this.knocks.map(swap);
    this.knockVotes = this.knockVotes.map(swap);
  }
  /** Sicht eines Spielers – ohne fremde Karten (außer Bettel Brett und nach der Abrechnung). */
  getStateFor(viewerId) {
    const scored = this.phase === SK_PHASES.SCORED;
    const c = this.contract;
    const sortContract = c && c.type !== "ramsch" ? c : SAUSPIEL;
    let hand = this.hands.get(viewerId) ?? [];
    let hiddenCards = 0;
    if (this.phase === SK_PHASES.KLOPFEN) {
      hiddenCards = Math.max(0, hand.length - this.firstHalf);
      hand = hand.slice(0, this.firstHalf);
    }
    const lastTrick = this.tricks.at(-1);
    const open = c && meta(c).open && this.tricks.length >= 1 && this.phase === SK_PHASES.PLAYING;
    return {
      kind: "schafkopf",
      phase: this.phase,
      seq: this.seq,
      round: this.round,
      variant: this.variant,
      handSize: this.handSize,
      extras: this.extras,
      pass: this.pass,
      order: this.order,
      dealerId: this.dealerId,
      forehandId: this.order[this.forehandIndex],
      currentPlayerId: scored ? null : this.currentPlayerId,
      hand: sortSkHand(hand, sortContract),
      hiddenCards,
      cardCounts: Object.fromEntries(this.order.map((id) => [id, this.hands.get(id).length])),
      knocks: this.knocks,
      knockVotes: this.knockVotes,
      bids: this.bids,
      allowedBids: this.allowedBids(viewerId),
      wedding: this.wedding && { offererId: this.wedding.offererId, askedId: this.phase === SK_PHASES.WEDDING ? this.currentPlayerId : null },
      contract: this.publicContract(viewerId),
      searched: this.searched,
      ranAway: this.ranAway,
      trick: this.trick,
      lastTrick: lastTrick ? { cards: lastTrick.cards, winnerId: lastTrick.winnerId, points: lastTrick.points } : null,
      trickNo: this.tricks.length,
      played: this.tricks.flatMap((t) => t.cards.map((x) => x.card.id)),
      tricksWon: Object.fromEntries(this.order.map((id) => [id, this.tricks.filter((t) => t.winnerId === id).length])),
      doubles: this.doubles,
      kontraBy: this.kontraBy,
      reBy: this.reBy,
      doubleKind: this.doubleKindFor(viewerId),
      canKontra: this.doubleKindFor(viewerId) === "kontra",
      canRe: this.doubleKindFor(viewerId) === "re",
      legalCardIds: this.legalFor(viewerId).map((x) => x.id),
      openHand: open ? { playerId: c.declarerId, cards: sortSkHand(this.hands.get(c.declarerId), c) } : null,
      stock: this.stock,
      multiplier: this.multiplier,
      balances: this.balances,
      history: this.history.slice(0, 8),
      result: this.result,
      ...scored && this.result?.type !== "thrown" && this.result?.type !== "stock" && {
        dealt: Object.fromEntries([...this.dealt].map(([id, h]) => [id, sortSkHand(h, sortContract)]))
      }
    };
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
    this.settings = { mode: MODES.SAME, public: true, game: GAMES.LUEGEN, skVariant: "lang", skPass: "ramsch", skExtras: defaultExtras() };
    this.ready = /* @__PURE__ */ new Set();
    this.game = null;
    this.chat = [];
    this.pauses = /* @__PURE__ */ new Map();
    this.personas = {};
    this.botMemory = { claimed: {} };
    this.botTimer = null;
    this.botKey = null;
  }
  get maxPlayers() {
    return GAME_MAX_PLAYERS[this.settings.game] ?? MAX_PLAYERS;
  }
  /** Läuft gerade eine Runde (bei Schafkopf auch während der Ansage)? */
  get active() {
    const p = this.game?.phase;
    return p === PHASES.PLAYING || p === "bidding" || p === "klopfen" || p === "wedding";
  }
  get humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }
  /** Freie Figur – damit nicht zwei Plätze gleich aussehen. */
  freeCharacter(preferIndex = 0) {
    const used = new Set([...this.players.values()].map((p) => p.character));
    for (let i = 0; i < CHARACTER_ORDER.length; i++) {
      const c = CHARACTER_ORDER[(preferIndex + i) % CHARACTER_ORDER.length];
      if (!used.has(c)) return c;
    }
    return CHARACTER_ORDER[preferIndex % CHARACTER_ORDER.length];
  }
  get phase() {
    return this.game ? this.game.phase : PHASES.LOBBY;
  }
  /** Spielt an diesem Platz gerade der Computer (Bot oder vertretener Spieler)? */
  isAuto(id) {
    const p = this.players.get(id);
    return Boolean(p?.bot || p?.autoplay);
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
      settings: { ...this.settings, skExtras: { ...this.settings.skExtras } },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        character: p.character,
        ...p.bot && { bot: true, difficulty: p.difficulty },
        ...p.autoplay && { autoplay: true }
      })),
      ready: [...this.ready],
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
      disconnectTimer: null,
      character: room.freeCharacter(room.players.size + 1)
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
    if (room.players.size >= room.maxPlayers) throw new GameError("ROOM_FULL", `Raum ist voll (max. ${room.maxPlayers}).`);
    const player = this.#addPlayer(room, name);
    return { room, player };
  }
  rejoin(code, token) {
    const room = this.getRoom(code);
    const player = token ? [...room.players.values()].find((p) => p.token === token) : null;
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
    room.ready.delete(playerId);
    if (room.game?.kind === "schafkopf" && room.game.order.includes(playerId) && room.humans.length > 0) {
      const bot = this.#createBot(room, "normal");
      room.game.replacePlayer(playerId, bot.id);
      room.personas[bot.id] = makePersona(bot.base, bot.difficulty);
      event = { type: "replaced", playerId, botId: bot.id, name: player.name, botName: bot.name };
    } else if (room.game && room.game.phase === PHASES.PLAYING && room.game.kind !== "schafkopf") event = room.game.removePlayer(playerId);
    if (room.hostId === playerId) {
      const humans = room.humans;
      const nextHost = humans.find((p) => p.connected) ?? humans[0];
      room.hostId = nextHost?.id ?? null;
    }
    if (room.humans.length === 0) {
      clearTimeout(room.botTimer);
      room.players.clear();
      this.rooms.delete(room.code);
    }
    return event;
  }
  /** Host setzt einen Computer-Gegner an den Tisch. */
  addBot(room, playerId, difficulty = "normal") {
    this.#assertHost(room, playerId);
    if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Nur in der Lobby m\xF6glich.");
    if (room.players.size >= room.maxPlayers) throw new GameError("ROOM_FULL", `Raum ist voll (max. ${room.maxPlayers}).`);
    return this.#createBot(room, difficulty);
  }
  #createBot(room, difficulty) {
    if (!DIFFICULTY[difficulty]) difficulty = "normal";
    const usedChars = new Set([...room.players.values()].map((p) => p.character));
    const free = BOT_ROSTER.filter((b) => !usedChars.has(b.character));
    const pick = (free.length ? free : BOT_ROSTER)[randomInt2((free.length ? free : BOT_ROSTER).length)];
    const bot = {
      id: newId(),
      name: room.uniqueName(pick.name),
      token: null,
      socketId: null,
      connected: true,
      disconnectTimer: null,
      character: pick.character,
      bot: true,
      difficulty,
      base: pick.persona
    };
    room.players.set(bot.id, bot);
    return bot;
  }
  updateSettings(room, playerId, settings) {
    this.#assertHost(room, playerId);
    if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Nur in der Lobby \xE4nderbar.");
    if (settings?.public !== void 0) room.settings.public = Boolean(settings.public);
    if (settings?.game !== void 0) {
      if (!Object.values(GAMES).includes(settings.game)) throw new GameError("BAD_GAME", "Unbekanntes Spiel.");
      if (room.players.size > GAME_MAX_PLAYERS[settings.game])
        throw new GameError("TOO_MANY", `Schafkopf spielt man zu viert \u2013 erst ${room.players.size - GAME_MAX_PLAYERS[settings.game]} Spieler entfernen.`);
      room.settings.game = settings.game;
    }
    if (settings?.skVariant !== void 0) {
      if (!SK_DECKS[settings.skVariant]) throw new GameError("BAD_VARIANT", "Unbekanntes Blatt.");
      room.settings.skVariant = settings.skVariant;
    }
    if (settings?.skPass !== void 0) {
      if (!SK_PASS[settings.skPass]) throw new GameError("BAD_PASS", "Unbekannte Regel.");
      room.settings.skPass = settings.skPass;
    }
    if (settings?.skExtras && typeof settings.skExtras === "object") {
      for (const key2 of Object.keys(SK_EXTRAS)) if (settings.skExtras[key2] !== void 0) room.settings.skExtras[key2] = Boolean(settings.skExtras[key2]);
    }
    if (settings?.mode !== void 0) {
      if (!Object.values(MODES).includes(settings.mode)) throw new GameError("BAD_MODE", "Unbekannter Modus.");
      room.settings.mode = settings.mode;
    }
  }
  /** Öffentliche Tische, die noch auf Mitspieler warten. */
  listOpenRooms() {
    return [...this.rooms.values()].filter((r) => r.phase === PHASES.LOBBY && r.settings.public && r.players.size > 0 && r.players.size < r.maxPlayers).map((r) => ({
      code: r.code,
      host: r.players.get(r.hostId)?.name ?? "?",
      players: r.players.size,
      max: r.maxPlayers,
      mode: r.settings.mode,
      game: r.settings.game
    })).slice(0, 50);
  }
  startGame(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.active) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft bereits.");
    room.pauses.clear();
    room.ready.clear();
    if (room.settings.game === GAMES.SCHAFKOPF) {
      while (room.players.size < GAME_MAX_PLAYERS.schafkopf) this.#createBot(room, "normal");
      room.game = new SchafkopfGame([...room.players.values()], { variant: room.settings.skVariant, pass: room.settings.skPass, extras: room.settings.skExtras });
      room.botKey = null;
      room.personas = Object.fromEntries([...room.players.values()].filter((p) => p.bot).map((p) => [p.id, makePersona(p.base, p.difficulty)]));
      return { type: "sk_deal", dealerId: room.game.dealerId, round: 1 };
    }
    if (room.players.size < MIN_PLAYERS) throw new GameError("PLAYER_COUNT", `Mindestens ${MIN_PLAYERS} Spieler n\xF6tig.`);
    room.game = new LuegenGame([...room.players.values()], { mode: room.settings.mode });
    room.botMemory = { claimed: {} };
    room.botKey = null;
    room.personas = Object.fromEntries(
      [...room.players.values()].filter((p) => p.bot).map((p) => [p.id, makePersona(p.base, p.difficulty)])
    );
    const g = room.game;
    return { type: "started", startPlayerId: g.currentPlayerId, quads: g.initialQuads, oberLoserId: g.endReason === "ober" ? g.loserId : null, ended: g.phase !== "playing" };
  }
  backToLobby(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.active) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft noch.");
    room.game = null;
    room.pauses.clear();
    room.ready.clear();
    for (const p of room.players.values()) p.autoplay = false;
  }
  /** Schafkopf: „Weiter“ nach der Abrechnung – neues Spiel, sobald alle Menschen bereit sind. */
  readyNext(room, playerId) {
    const g = room.game;
    if (g?.kind !== "schafkopf" || g.phase !== "scored") throw new GameError("NOT_SCORED", "Gerade gibt es nichts zu best\xE4tigen.");
    room.ready.add(playerId);
    const waiting = room.humans.filter((p) => p.connected && !p.autoplay && !room.ready.has(p.id));
    if (waiting.length) return null;
    room.ready.clear();
    return g.nextDeal();
  }
  #assertHost(room, playerId) {
    if (room.hostId !== playerId) throw new GameError("NOT_HOST", "Nur der Host darf das.");
  }
};

// src/socket/handlers.js
import { randomBytes as randomBytes2 } from "node:crypto";

// ../shared/schafkopf/bot.js
var pts = (c) => CARD_POINTS[c.rank] ?? 0;
var SAUSPIEL2 = { type: "sauspiel" };
function strength(hand, contract) {
  const m = meta(contract);
  const trumps = hand.filter((c) => isTrump(c, contract));
  const lordCards = trumps.filter((c) => m.lords.includes(c.rank));
  const tops = trumps.filter((c) => trumpPower(c, contract) >= 40).length;
  const top = trumps.some((c) => trumpPower(c, contract) === 43);
  const plain = hand.filter((c) => !isTrump(c, contract));
  const aces = plain.filter((c) => c.rank === "A").length;
  const guardedTen = (c) => c.rank === "10" && plain.some((x) => x.suit === c.suit && x.rank === "A");
  const losers = plain.filter((c) => c.rank !== "A" && !guardedTen(c)).length;
  const voids = SUITS.filter((s) => !hand.some((c) => !isTrump(c, contract) && c.suit === s)).length;
  return { t: trumps.length, lords: lordCards.length, tops, top, aces, losers, voids };
}
function bettelRisk(hand) {
  let risky = 0;
  let veryLow = true;
  for (const s of SUITS) {
    const cards = hand.filter((c) => c.suit === s).sort((a, b) => plainPower(a, { type: "bettel" }) - plainPower(b, { type: "bettel" }));
    cards.forEach((c, i) => {
      const p = plainPower(c, { type: "bettel" });
      if (p >= 5 && i < p - 3) risky += 1;
      if (p >= 5) veryLow = false;
    });
  }
  return { risky, veryLow };
}
function chooseBid(view, persona = {}) {
  const hand = view.hand;
  const hs = view.handSize ?? SK_DECKS[view.variant]?.handSize ?? 7;
  const allowed = view.allowedBids;
  if (!allowed?.length) return null;
  const aggro = (persona.bluff ?? 0.4) - 0.4;
  const can = (type, suit) => allowed.find((b2) => b2.type === type && (b2.suit ?? null) === (suit ?? null));
  const candidates = [];
  for (const suit of SUITS) {
    const s = strength(hand, { type: "solo", suit });
    if (s.t === hs && s.tops >= 3 && s.top && s.lords >= hs - 1) candidates.push(can("solo_tout", suit));
    if (s.t >= hs - 1 && s.lords >= 4 && s.tops >= 2 || s.t >= hs - 2 && s.tops >= 3 && s.losers === 0) {
      if (s.t + s.tops * 0.7 + (s.top ? 0.5 : 0) + s.aces * 0.6 - s.losers * 0.5 + aggro >= hs + 0.8) candidates.push(can("solo", suit));
    }
    for (const type of ["farbwenz", "farbgeier"]) {
      const f = strength(hand, { type, suit });
      if (f.t === hs && f.tops >= 2 && f.top) candidates.push(can(`${type}_tout`, suit));
      if (f.t >= hs - 2 && f.lords >= 2 && f.top && f.losers <= 1 && f.t + f.lords * 0.5 + aggro >= hs) candidates.push(can(type, suit));
    }
  }
  for (const type of ["wenz", "geier"]) {
    const w = strength(hand, { type });
    if (w.t === 4 && w.losers === 0) candidates.push(can(`${type}_tout`));
    const score = w.t * 1.3 + (w.top ? 0.6 : 0) + w.aces * 0.9 - w.losers * 0.7 + aggro;
    if (w.t >= 2 && (w.top || w.t >= 3) && score >= hs - 2.4) candidates.push(can(type));
  }
  const b = bettelRisk(hand);
  if (b.risky === 0 && b.veryLow) candidates.push(can("bettel_brett"));
  if (b.risky === 0) candidates.push(can("bettel"));
  const r = strength(hand, SAUSPIEL2);
  const need = hs === 6 ? 3.6 : 4.4;
  if (r.t >= (hs === 6 ? 3 : 4) && (r.tops >= 1 || r.t >= hs - 1) && r.t + r.tops * 0.5 + (r.top ? 0.3 : 0) + r.aces * 0.4 + aggro >= need) {
    const calls = allowed.filter((x) => x.type === "sauspiel");
    if (calls.length) {
      const count = (suit) => hand.filter((c) => c.suit === suit && !isTrump(c, SAUSPIEL2)).length;
      const has10 = (suit) => hand.some((c) => c.suit === suit && c.rank === "10");
      calls.sort((a, b2) => count(a.suit) - count(b2.suit) || has10(a.suit) - has10(b2.suit));
      candidates.push(calls[0]);
    }
  }
  if (r.t === 1 && r.aces >= 2) candidates.push(can("hochzeit"));
  const valid = candidates.filter(Boolean);
  if (!valid.length) return null;
  valid.sort((a, b2) => CONTRACTS[b2.type].rank - CONTRACTS[a.type].rank);
  return valid[0];
}
function wantsKnock(hand, persona = {}) {
  const obers = hand.filter((c) => c.rank === "O").length;
  const lords = hand.filter((c) => c.rank === "O" || c.rank === "U").length;
  const aces = hand.filter((c) => c.rank === "A").length;
  const aggro = (persona.bluff ?? 0.4) - 0.4;
  return obers >= 2 || lords + aces * 0.5 + aggro >= 3.2;
}
function chooseMarriage(view) {
  const hand = view.hand;
  const s = strength(hand, SAUSPIEL2);
  const hs = view.handSize;
  const plain = hand.filter((c) => !isTrump(c, SAUSPIEL2));
  if (!plain.length) return null;
  if (!(s.t + 1 >= Math.ceil(hs / 2) && s.tops >= 1) && !(s.t + 1 >= hs - 2)) return null;
  const suitCount = (suit) => plain.filter((c) => c.suit === suit).length;
  plain.sort((a, b) => pts(a) - pts(b) || suitCount(a.suit) - suitCount(b.suit));
  return plain[0].id;
}
function relationFn(view, me) {
  const c = view.contract;
  if (!c || c.type === "ramsch") return (id) => id === me ? "friend" : "enemy";
  const decl = c.declarerId;
  const partner = c.partnerId;
  const solo = CONTRACTS[c.type]?.solo;
  const iAmPlayer = me === decl || me === partner;
  return (id) => {
    if (id === me) return "friend";
    if (solo) return iAmPlayer === (id === decl) ? "friend" : "enemy";
    if (iAmPlayer) return id === decl || id === partner ? "friend" : partner ? "enemy" : "unknown";
    if (id === decl || id === partner) return "enemy";
    return partner ? "friend" : "unknown";
  };
}
function currentWinner(trick, contract) {
  let best = 0;
  const led = followSuit(trick[0].card, contract);
  for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, trick[best].card, led, contract)) best = i;
  return trick[best];
}
function choosePlayCard(view, me, persona = {}, rand = Math.random) {
  const legal = view.hand.filter((c2) => view.legalCardIds.includes(c2.id));
  if (legal.length <= 1) return legal[0];
  if (rand() > (persona.sharp ?? 0.75) + 0.25) return legal[Math.floor(rand() * legal.length)];
  const c = view.contract;
  const m = meta(c);
  const rel = relationFn(view, me);
  const trick = view.trick;
  const power = (x) => isTrump(x, c) ? 100 + trumpPower(x, c) : plainPower(x, c);
  const byPower = (a, b) => power(a) - power(b);
  const played = new Set(view.played ?? []);
  if (m.bettel) {
    const declarer = me === c.declarerId;
    if (!trick.length) return [...legal].sort(byPower)[0];
    const best2 = currentWinner(trick, c);
    const led2 = followSuit(trick[0].card, c);
    const under = legal.filter((x) => !beats(x, best2.card, led2, c)).sort(byPower);
    if (declarer) return under.length ? under.at(-1) : [...legal].sort(byPower)[0];
    if (best2.playerId === c.declarerId) return under.length ? under.at(-1) : [...legal].sort(byPower)[0];
    const declarerStillToPlay = !trick.some((t) => t.playerId === c.declarerId);
    return declarerStillToPlay ? [...legal].sort(byPower)[0] : [...legal].sort(byPower).at(-1);
  }
  if (c.type === "ramsch") {
    if (!trick.length) {
      const plain = legal.filter((x) => !isTrump(x, c)).sort((a, b) => pts(a) - pts(b) || byPower(a, b));
      return plain[0] ?? [...legal].sort(byPower)[0];
    }
    const best2 = currentWinner(trick, c);
    const led2 = followSuit(trick[0].card, c);
    const losers2 = legal.filter((x) => !beats(x, best2.card, led2, c));
    if (losers2.length) return losers2.sort((a, b) => pts(b) - pts(a) || byPower(b, a))[0];
    const winners2 = legal.filter((x) => beats(x, best2.card, led2, c));
    return trick.length === 3 ? winners2.sort((a, b) => pts(b) - pts(a))[0] : winners2.sort(byPower).at(-1);
  }
  if (!trick.length) {
    const iAmPlayer = me === c.declarerId || me === c.partnerId;
    const trumps = legal.filter((x) => isTrump(x, c)).sort(byPower);
    const myTrumpIds = new Set(view.hand.filter((x) => isTrump(x, c)).map((x) => x.id));
    const otherTrumps = createSkDeck(view.variant).filter((x) => isTrump(x, c) && !played.has(x.id) && !myTrumpIds.has(x.id));
    const aces = legal.filter((x) => !isTrump(x, c) && x.rank === "A");
    if (iAmPlayer) {
      if (trumps.length && otherTrumps.length) {
        const highest = trumps.at(-1);
        const higherOut = otherTrumps.some((x) => trumpPower(x, c) > trumpPower(highest, c));
        return higherOut && trumps.length > 1 ? trumps[0] : highest;
      }
      if (aces.length) return aces[0];
    } else {
      if (c.calledSuit && !view.searched) {
        const search = legal.filter((x) => !isTrump(x, c) && x.suit === c.calledSuit).sort(byPower);
        if (search.length) return search[0];
      }
      if (aces.length) return aces[0];
    }
    const plain = legal.filter((x) => !isTrump(x, c)).sort((a, b) => pts(a) - pts(b) || byPower(a, b));
    return plain[0] ?? trumps[0] ?? legal[0];
  }
  const best = currentWinner(trick, c);
  const led = followSuit(trick[0].card, c);
  const winners = legal.filter((x) => beats(x, best.card, led, c)).sort(byPower);
  const losers = legal.filter((x) => !beats(x, best.card, led, c));
  const trickPts = trick.reduce((s, t) => s + pts(t.card), 0);
  const last = trick.length === 3;
  const r = rel(best.playerId);
  const strongWin = isTrump(best.card, c) ? trumpPower(best.card, c) >= 40 : best.card.rank === "A";
  if (r === "friend" && (last || strongWin)) {
    const smearScore = (x) => pts(x) - (isTrump(x, c) && x.rank !== "A" && x.rank !== "10" ? 6 : 0);
    return [...legal].sort((a, b) => smearScore(b) - smearScore(a))[0];
  }
  if (winners.length && r !== "friend") {
    const worth = trickPts >= 4 || last || trick.some((t) => t.card.rank === "A" || t.card.rank === "10");
    if (worth) {
      if (last) return winners[0];
      const safe = winners.filter((x) => isTrump(x, c) && trumpPower(x, c) >= 40);
      return trickPts >= 10 && safe.length ? safe[0] : winners[0];
    }
  }
  const pool = losers.length ? losers : legal;
  return [...pool].sort((a, b) => pts(a) + power(a) * 0.02 - (pts(b) + power(b) * 0.02))[0];
}
function wantsDouble(view, persona) {
  const c = view.contract;
  const m = meta(c);
  const hs = view.handSize;
  const sharp = persona.sharp ?? 0.75;
  if (m.bettel) {
    if (view.doubleKind !== "kontra") return false;
    const low = view.hand.filter((x) => plainPower(x, c) <= 4).length;
    return low >= hs - 2 && Math.random() < 0.5 * sharp;
  }
  const s = strength(view.hand, c);
  if (view.doubleKind === "kontra" || view.doubleKind === "supra") {
    return s.t >= Math.ceil(hs / 2) + 1 + (m.solo ? 1 : 0) && s.tops >= 2 && Math.random() < 0.6 * sharp;
  }
  return s.t >= hs - 2 && s.tops >= 2;
}
function skDecide(view, me, persona = {}) {
  const myTurn = view.currentPlayerId === me;
  if (view.phase === "klopfen") return myTurn ? { type: "knock", yes: wantsKnock(view.hand, persona) } : null;
  if (view.phase === "bidding") return myTurn ? { type: "bid", contract: chooseBid(view, persona) } : null;
  if (view.phase === "wedding") return myTurn ? { type: "marry", cardId: chooseMarriage(view) } : null;
  if (view.phase !== "playing") return null;
  if (view.doubleKind && wantsDouble(view, persona)) return { type: "double", kind: view.doubleKind };
  if (!myTurn) return null;
  const card = choosePlayCard(view, me, persona);
  return card ? { type: "play", cardId: card.id } : null;
}

// src/socket/handlers.js
var GRACE_MS = {
  [PHASES.LOBBY]: 60 * 1e3,
  [PHASES.PLAYING]: 3 * 60 * 1e3,
  [PHASES.FINISHED]: 60 * 1e3
};
var DEFAULT_PAUSE_MS = 10 * 1e3;
var RATE_LIMIT = { windowMs: 2e3, max: 30 };
var BOT_TIMING = { min: 900, max: 1700, pending: [1400, 2200], first: [1600, 2300], afterReveal: 3800, afterTrick: 1500 };
function registerSocketHandlers(io, rooms, { pauseMs = DEFAULT_PAUSE_MS, botTiming = BOT_TIMING } = {}) {
  function broadcastState(room) {
    for (const player of room.players.values()) {
      if (player.socketId) io.to(player.socketId).emit(EVT.ROOM_STATE, room.stateFor(player.id));
    }
    scheduleBot(room);
  }
  function emitEvent(room, event) {
    if (!event) return;
    room.lastEventType = event.type;
    io.to(room.code).emit(EVT.GAME_EVENT, { ...event, at: Date.now() });
  }
  function scheduleSkBot(room) {
    const game = room.game;
    const id = game.currentPlayerId;
    const auto = id && room.isAuto(id) && ["klopfen", "bidding", "wedding", "playing"].includes(game.phase);
    if (!auto || room.pauses.size || !rooms.rooms.has(room.code)) {
      clearTimeout(room.botTimer);
      room.botKey = null;
      return;
    }
    const key2 = `${game.seq}:${id}`;
    if (room.botKey === key2) return;
    clearTimeout(room.botTimer);
    room.botKey = key2;
    const afterTrick = game.phase === "playing" && game.trick.length === 0 && game.completedTricks > 0 ? botTiming.afterTrick : 0;
    const delay = between([botTiming.min * 0.8, botTiming.max * 0.8]) + afterTrick;
    const seq = game.seq;
    room.botTimer = setTimeout(() => {
      room.botKey = null;
      if (room.game !== game || game.seq !== seq || game.currentPlayerId !== id || room.pauses.size) return;
      const persona = room.personas[id] ??= makePersona({ bluff: 0.4 }, "normal");
      try {
        let action = skDecide(game.getStateFor(id), id, persona);
        if (action?.type === "double") {
          applyAction(room, id, { type: "sk_double", kind: action.kind });
          action = skDecide(game.getStateFor(id), id, persona);
          if (action?.type === "double") action = null;
        }
        if (action?.type === "bid") applyAction(room, id, { type: "sk_bid", contract: action.contract });
        else if (action?.type === "play") applyAction(room, id, { type: "sk_play", cardId: action.cardId });
        else if (action?.type === "knock") applyAction(room, id, { type: "sk_knock", yes: action.yes });
        else if (action?.type === "marry") applyAction(room, id, { type: "sk_marry", cardId: action.cardId });
      } catch (err) {
        console.error("[sk-bot]", err);
        const legal = game.legalFor(id);
        if (game.phase === "bidding") applyAction(room, id, { type: "sk_bid", contract: null });
        else if (game.phase === "klopfen") applyAction(room, id, { type: "sk_knock", yes: false });
        else if (game.phase === "wedding") applyAction(room, id, { type: "sk_marry", cardId: null });
        else if (legal[0]) applyAction(room, id, { type: "sk_play", cardId: legal[0].id });
      }
    }, delay);
    room.botTimer.unref?.();
  }
  function applyAction(room, playerId, action) {
    if (!room.game) throw new GameError("NOT_PLAYING", "Das Spiel l\xE4uft nicht.");
    assertNotPaused(room);
    let event;
    if (room.game.kind === "schafkopf") {
      const g = room.game;
      if (action.type === "sk_bid") event = g.bid(playerId, action.contract ?? null);
      else if (action.type === "sk_play") event = g.play(playerId, action.cardId);
      else if (action.type === "sk_double") event = g.double(playerId, action.kind);
      else if (action.type === "sk_knock") event = g.knock(playerId, action.yes);
      else if (action.type === "sk_marry") event = g.marry(playerId, action.cardId ?? null);
      else throw new GameError("BAD_ACTION", "Unbekannter Zug.");
      if (g.phase === "scored") room.ready.clear();
      emitEvent(room, event);
      broadcastState(room);
      return;
    }
    if (action.type === "play") {
      event = room.game.play(playerId, action.cardIds, action.claimRank, action.claimCount);
      room.botMemory.claimed[action.claimRank] = (room.botMemory.claimed[action.claimRank] ?? 0) + action.claimCount;
    } else if (action.type === "challenge") {
      event = room.game.challenge(playerId);
      room.botMemory.claimed = {};
    } else {
      event = room.game.accept(playerId);
    }
    emitEvent(room, event);
    broadcastState(room);
  }
  const between = ([a, b]) => a + Math.random() * (b - a);
  function scheduleBot(room) {
    if (room.game?.kind === "schafkopf") return scheduleSkBot(room);
    const game = room.game;
    const bot = game?.phase === PHASES.PLAYING ? room.players.get(game.currentPlayerId) : null;
    if (!bot?.bot || room.pauses.size || !rooms.rooms.has(room.code)) {
      clearTimeout(room.botTimer);
      room.botKey = null;
      return;
    }
    const key2 = `${game.seq}:${bot.id}`;
    if (room.botKey === key2) return;
    clearTimeout(room.botTimer);
    room.botKey = key2;
    const think = game.pendingOutId ? between(botTiming.pending) : game.seq === 0 ? between(botTiming.first) : between([botTiming.min, botTiming.max]);
    const delay = think + (room.lastEventType === "challenge" ? botTiming.afterReveal : 0);
    const seq = game.seq;
    room.botTimer = setTimeout(() => {
      room.botKey = null;
      if (room.game !== game || game.seq !== seq || game.currentPlayerId !== bot.id || room.pauses.size) return;
      try {
        applyAction(room, bot.id, decide(game.getStateFor(bot.id), room.personas[bot.id], room.botMemory));
      } catch (err) {
        console.error("[bot]", err);
        const view = game.getStateFor(bot.id);
        if (view.pendingOutId) return applyAction(room, bot.id, { type: "accept" });
        const card = view.hand[0];
        if (card) applyAction(room, bot.id, { type: "play", cardIds: [card.id], claimRank: view.requiredRank ?? "K", claimCount: 1 });
      }
    }, delay);
    room.botTimer.unref?.();
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
    if (player.autoplay) {
      player.autoplay = false;
      emitEvent(room, { type: "took_over", playerId: player.id, name: player.name });
    }
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
    on(socket, EVT.LOBBY_LIST, () => ({ rooms: rooms.listOpenRooms() }));
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
    on(socket, EVT.ROOM_ADD_BOT, ({ difficulty }) => {
      const { room, player } = ctx(socket);
      const bot = rooms.addBot(room, player.id, difficulty);
      emitEvent(room, { type: "joined", playerId: bot.id, name: bot.name, bot: true });
      broadcastState(room);
      return { playerId: bot.id };
    });
    on(socket, EVT.GAME_START, () => {
      const { room, player } = ctx(socket);
      emitEvent(room, rooms.startGame(room, player.id));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.GAME_PLAY, ({ cardIds, claimRank, claimCount }) => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "play", cardIds, claimRank, claimCount });
      return {};
    });
    on(socket, EVT.GAME_CHALLENGE, () => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "challenge" });
      return {};
    });
    on(socket, EVT.GAME_ACCEPT, () => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "accept" });
      return {};
    });
    on(socket, EVT.SK_BID, ({ contract }) => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "sk_bid", contract: contract && typeof contract === "object" ? { type: String(contract.type), ...contract.suit && { suit: String(contract.suit) } } : null });
      return {};
    });
    on(socket, EVT.SK_PLAY, ({ cardId }) => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "sk_play", cardId: String(cardId ?? "") });
      return {};
    });
    on(socket, EVT.SK_DOUBLE, ({ kind }) => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "sk_double", kind: kind ? String(kind) : void 0 });
      return {};
    });
    on(socket, EVT.SK_KNOCK, ({ yes }) => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "sk_knock", yes: Boolean(yes) });
      return {};
    });
    on(socket, EVT.SK_MARRY, ({ cardId }) => {
      const { room, player } = ctx(socket);
      applyAction(room, player.id, { type: "sk_marry", cardId: cardId ? String(cardId) : null });
      return {};
    });
    on(socket, EVT.SK_NEXT, () => {
      const { room, player } = ctx(socket);
      const event = rooms.readyNext(room, player.id);
      emitEvent(room, event);
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
      if (room.active && room.game.order.includes(player.id)) {
        room.pauses.set(player.id, Date.now() + pauseMs);
        emitEvent(room, { type: "disconnected", playerId: player.id, name: player.name, pauseMs });
        clearTimeout(player.pauseTimer);
        player.pauseTimer = setTimeout(() => {
          if (player.connected || !room.pauses.has(player.id)) return;
          room.pauses.delete(player.id);
          if (room.game?.kind === "schafkopf" && room.game.order.includes(player.id)) {
            player.autoplay = true;
            emitEvent(room, { type: "autoplay", playerId: player.id, name: player.name });
          } else if (room.game?.phase === PHASES.PLAYING && room.game.order.includes(player.id)) {
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
      }, room.active || room.game?.kind === "schafkopf" ? GRACE_MS[PHASES.PLAYING] : GRACE_MS[room.phase] ?? GRACE_MS[PHASES.LOBBY]);
      player.disconnectTimer.unref?.();
    });
  });
}

// src/youtube.js
import express from "express";
var API = "https://www.googleapis.com/youtube/v3";
var TTL = 30 * 60 * 1e3;
var key = () => process.env.YOUTUBE_API_KEY?.trim();
function toItem(id, snippet) {
  if (!id || !snippet) return null;
  return {
    id,
    title: snippet.title ?? "",
    channel: snippet.channelTitle ?? snippet.videoOwnerChannelTitle ?? "",
    thumb: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? ""
  };
}
function youtubeRouter() {
  const router = express.Router();
  const cache = /* @__PURE__ */ new Map();
  async function api(path3, params) {
    const url = `${API}/${path3}?${new URLSearchParams({ ...params, key: key() })}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? `YouTube-Fehler (${res.status})`);
    cache.set(url, { at: Date.now(), data });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return data;
  }
  router.get("/api/youtube/status", (_req, res) => res.json({ configured: Boolean(key()) }));
  router.get("/api/youtube/trending", async (req, res) => {
    if (!key()) return res.status(503).json({ error: "not_configured" });
    try {
      const since = new Date(Date.now() - 4 * 24 * 3600 * 1e3);
      since.setUTCMinutes(0, 0, 0);
      const data = await api("search", {
        part: "snippet",
        type: "video",
        q: "#shorts",
        videoDuration: "short",
        order: "viewCount",
        regionCode: String(req.query.region ?? "DE").slice(0, 2),
        relevanceLanguage: "de",
        safeSearch: "moderate",
        publishedAfter: since.toISOString(),
        maxResults: "25",
        ...req.query.page ? { pageToken: String(req.query.page).slice(0, 100) } : {}
      });
      res.json({
        items: (data.items ?? []).map((v) => toItem(v.id?.videoId, v.snippet)).filter(Boolean),
        next: data.nextPageToken ?? null
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  router.get("/api/youtube/channel", async (req, res) => {
    if (!key()) return res.status(503).json({ error: "not_configured" });
    const handle = String(req.query.handle ?? "").trim().replace(/^@?/, "@");
    if (!/^@[A-Za-z0-9._-]{2,40}$/.test(handle)) return res.status(400).json({ error: "Ung\xFCltiger Kanalname" });
    try {
      const ch = await api("channels", { part: "snippet", forHandle: handle });
      const channel = ch.items?.[0];
      if (!channel) return res.status(404).json({ error: "Kanal nicht gefunden" });
      const shortsPlaylist = `UUSH${channel.id.slice(2)}`;
      let items = [];
      try {
        const pl = await api("playlistItems", { part: "snippet", playlistId: shortsPlaylist, maxResults: "30" });
        items = (pl.items ?? []).map((v) => toItem(v.snippet?.resourceId?.videoId, v.snippet)).filter(Boolean);
      } catch {
        items = [];
      }
      res.json({ channel: { id: channel.id, title: channel.snippet?.title ?? handle, handle }, items });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  return router;
}

// src/app.js
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var CLIENT_ORIGIN = process.env.CLIENT_ORIGIN?.split(",").map((s) => s.trim());
function createLuegenServer({ clientDir, pauseMs, botTiming } = {}) {
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
  registerSocketHandlers(io, rooms, { pauseMs, botTiming });
  app.set("trust proxy", true);
  app.use(youtubeRouter());
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
