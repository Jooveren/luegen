// src/deploy-entry.js
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/app.js
import express2 from "express";
import { createServer } from "node:http";
import { existsSync as existsSync2 } from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

// src/rooms/RoomManager.js
import { randomBytes, randomInt as randomInt2 } from "node:crypto";

// ../shared/constants.js
var SUITS = ["eichel", "gras", "herz", "schellen"];
var RANKS = ["6", "7", "8", "9", "10", "U", "O", "K", "A"];
var MIN_PLAYERS = 2;
var MAX_PLAYERS = 7;
var GAMES = { LUEGEN: "luegen", SCHAFKOPF: "schafkopf", CHESS: "chess", POKER: "poker", BLACKJACK: "blackjack" };
var GAME_MAX_PLAYERS = { luegen: 7, schafkopf: 4, chess: 2, poker: 9, blackjack: 7 };
var GAME_LABELS = { luegen: "L\xFCgen", schafkopf: "Schafkopf", chess: "Schach", poker: "Poker", blackjack: "Blackjack" };
var POKER_CHIPS = [500, 1e3, 2e3, 5e3];
var POKER_BLINDS = ["5/10", "10/20", "25/50", "50/100"];
var TURN_SECONDS = [15, 30, 60, 0];
var BJ_DECKS = [1, 2, 6, 8];
var WALLET = { start: 500, daily: 50, floor: 100, pinMin: 4, pinMax: 8 };
var STAKE_LEVELS = {
  luegen: [5, 10, 20, 50],
  schafkopf: [5, 10, 20, 50],
  chess: [10, 25, 50, 100],
  poker: [100, 200, 500, 1e3],
  blackjack: [50, 100, 200, 500]
};
var SK_TARIF_BASE = 10;
var stakeOf = (settings) => STAKE_LEVELS[settings.game]?.[settings.stakeLevel ?? 1] ?? 0;
function minBalanceFor(settings, players = 2) {
  const s = stakeOf(settings);
  if (settings.game === "luegen") return s * Math.max(1, players - 1);
  if (settings.game === "schafkopf") return s * 10;
  return s;
}
function walletBlinds(buyIn) {
  const bb = Math.max(2, Math.round(buyIn / 50));
  return { sb: Math.max(1, Math.floor(bb / 2)), bb };
}
var fmtTaler = (n) => `${Math.round(n ?? 0).toLocaleString("de-DE")} Taler`;
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
  // Wert steigt mit jedem Zug: 6 → 7 → 8 → 9 → 10 → U → K → A → 6 … (Ober wird übersprungen)
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
  ROOM_PHOTO: "room:photo",
  // eigenes Bild setzen
  ROOM_PHOTOS: "room:photos",
  // Bilder der Mitspieler holen
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
  POKER_ACT: "poker:act",
  POKER_SHOW: "poker:show",
  BJ_BET: "bj:bet",
  BJ_ACT: "bj:act",
  BJ_INSURE: "bj:insure",
  CHESS_MOVE: "chess:move",
  CHESS_RESIGN: "chess:resign",
  CHESS_DRAW: "chess:draw",
  CHESS_REMATCH: "chess:rematch",
  PRESENCE_HELLO: "presence:hello",
  // wer bin ich, was mache ich gerade
  PRESENCE_LIST: "presence:list",
  // wer ist gerade online
  INVITE_SEND: "invite:send",
  // Leute an meinen Tisch einladen
  ACC_REGISTER: "acc:register",
  // Konto anlegen (Name + PIN)
  ACC_LOGIN: "acc:login",
  ACC_RESUME: "acc:resume",
  // gespeicherte Sitzung fortsetzen
  ACC_LOGOUT: "acc:logout",
  ACC_HISTORY: "acc:history",
  CASINO_REBUY: "casino:rebuy",
  // Taler-Tisch: Chips nachkaufen
  // Server → Client
  ROOM_STATE: "room:state",
  GAME_EVENT: "game:event",
  KICKED: "room:kicked",
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",
  INVITE: "invite",
  // Einladung an diesen Client
  ACC_BALANCE: "acc:balance"
  // neuer Kontostand
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
  cards.forEach((card2, i) => hands.get(playerIds[i % playerIds.length]).push(card2));
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
    this.caughtStreak = {};
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
    if (this.lastPlay && this.lastPlay.playerId !== playerId) this.caughtStreak[this.lastPlay.playerId] = 0;
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
    let starter = accusedId;
    if (lied) {
      const streak = (this.caughtStreak[accusedId] ?? 0) + 1;
      event.caughtStreak = streak;
      if (streak >= 3) {
        starter = playerId;
        this.caughtStreak[accusedId] = 0;
        event.streakBroken = true;
      } else this.caughtStreak[accusedId] = streak;
    } else this.caughtStreak[accusedId] = 0;
    if (!this.hands.has(starter)) starter = playerId;
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
      for (const card2 of shuffle(hand, this.rand)) {
        const id = receivers[this.rand(receivers.length)];
        this.hands.get(id).push(card2);
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
  lang: { ranks: ["7", "8", "9", "10", "U", "O", "K", "A"], label: "Langes Blatt", handSize: 8, davonlaufen: 4 },
  kurz: { ranks: ["9", "10", "U", "O", "K", "A"], label: "Kurzes Blatt", handSize: 6, davonlaufen: 3 }
};
var SK_PLAYERS = 4;
var CARD_POINTS = { A: 11, 10: 10, K: 4, O: 3, U: 2, 9: 0, 8: 0, 7: 0 };
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
  ...TOUT_ORDER.map((k, i) => [`${k}_tout`, { ...BASE[k], rank: 9 + i, label: `${BASE[k].label}-Tout`, tout: true, family: k }]),
  ["sie", { rank: 14, label: "Sie", lords: "OU", solo: true, sie: true, tarif: "solo", family: "sie" }]
]);
var RAMSCH = { rank: 0, label: "Ramsch", lords: "OU", trumpSuit: "herz", family: "ramsch" };
var CALLABLE_SUITS = ["eichel", "gras", "schellen"];
var CALL_NAMES = { eichel: "Eichel", gras: "Blaue", schellen: "Schelln" };
var SUIT_ORDER = { eichel: 3, gras: 2, herz: 1, schellen: 0 };
var PLAIN_ORDER = { A: 8, 10: 7, K: 6, O: 5, U: 5, 9: 4, 8: 3, 7: 2 };
var BETTEL_ORDER = { A: 8, K: 7, O: 6, U: 5, 10: 4, 9: 3, 8: 2, 7: 1 };
var SUIT_NAMES = { eichel: "Eichel", gras: "Gras", herz: "Herz", schellen: "Schellen" };
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
function isTrump(card2, contract) {
  const m = meta(contract);
  if (m.bettel) return false;
  if (m.lords.includes(card2.rank)) return true;
  const ts = trumpSuitOf(contract);
  return ts !== null && card2.suit === ts;
}
function plainPower(card2, contract) {
  return (meta(contract).bettel ? BETTEL_ORDER : PLAIN_ORDER)[card2.rank] ?? 0;
}
function trumpPower(card2, contract) {
  if (!isTrump(card2, contract)) return -1;
  const { lords } = meta(contract);
  if (lords.includes(card2.rank)) return (lords === "OU" && card2.rank === "U" ? 30 : 40) + SUIT_ORDER[card2.suit];
  return 20 + plainPower(card2, contract);
}
var followSuit = (card2, contract) => isTrump(card2, contract) ? "trumpf" : card2.suit;
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
function contractLabel(contract) {
  if (!contract) return "";
  if (contract.type === "ramsch") return "Ramsch";
  if (contract.type === "sauspiel") return `Sauspiel auf die ${CALL_NAMES[contract.suit]}`;
  const m = meta(contract);
  const suit = SUIT_NAMES[contract.suit] ?? "";
  if (m.family === "solo") return `${suit}-${m.label}`;
  if (m.suit) return `${m.label} ${suit}`;
  return m.label;
}

// ../shared/schafkopf/SchafkopfGame.js
var SK_PHASES = { KLOPFEN: "klopfen", BIDDING: "bidding", WEDDING: "wedding", PLAYING: "playing", SCORED: "scored" };
var DOUBLE_KINDS = ["kontra", "re", "supra", "resupra"];
var SAUSPIEL = { type: "sauspiel" };
var SchafkopfGame = class _SchafkopfGame {
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
  /** Welche Spiele darf dieser Spieler jetzt ansagen? (opts.anyTime: ohne Zug-/Rang-Prüfung – für den Berater) */
  allowedBids(playerId, opts = {}) {
    if (!opts.anyTime && (this.phase !== SK_PHASES.BIDDING || this.currentPlayerId !== playerId)) return [];
    const best = opts.anyTime ? null : this.#bestBid();
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
      } else if (type === "sie") {
        if (hand.filter((c) => c.rank === "O" || c.rank === "U").length === 8) out.push({ type });
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
    if (c.type === "sie") {
      const value = (SK_TARIF.solo + 8 * SK_TARIF.extra) * 4 * this.multiplier;
      const payout = Object.fromEntries(this.order.map((id) => [id, id === best.playerId ? 3 * value : -value]));
      this.phase = SK_PHASES.SCORED;
      for (const id of this.order) this.balances[id] += payout[id];
      this.result = { type: "sie", contract: this.publicContract(), team: [best.playerId], won: true, laufende: 8, knocks: this.knocks.length, doubles: [], value, payout };
      this.history.unshift({ round: this.round, contract: this.publicContract(), payout });
      this.seq += 1;
      return { final: this.publicContract(), result: this.result };
    }
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
    const card2 = hand.find((c2) => c2.id === cardId);
    if (!card2) throw new GameError("NOT_IN_HAND", "Diese Karte hast du nicht.");
    const c = this.contract;
    if (!this.legalFor(playerId).includes(card2)) {
      if (c?.calledSuit && c.partnerId === playerId && !this.searched && card2.suit === c.calledSuit && card2.rank === "A")
        throw new GameError("SAU_HOLD", "Die gerufene Sau darfst du nicht abwerfen.");
      if (this.trick.length) throw new GameError("MUST_FOLLOW", "Du musst bedienen.");
      throw new GameError("MUST_LEAD_SAU", "Die Ruffarbe darfst du nur mit der Sau anspielen (Davonlaufen erst ab 4 Karten).");
    }
    const event = { type: "sk_play", playerId, card: card2 };
    if (c?.calledSuit && !isTrump(card2, c) && card2.suit === c.calledSuit) {
      if (!this.trick.length && !this.searched && playerId === c.partnerId && card2.rank !== "A") {
        this.ranAway = true;
        this.partnerRevealed = true;
        event.ranAway = true;
      }
      if (card2.rank === "A") {
        this.partnerRevealed = true;
        event.sau = true;
      }
    }
    hand.splice(hand.indexOf(card2), 1);
    this.trick.push({ playerId, card: card2 });
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
    const holder = (card2) => this.order.find((id) => this.dealt.get(id).some((x) => x.id === card2.id));
    const side = (id) => this.#team(id);
    const first = side(holder(order[0]));
    let n = 0;
    for (const card2 of order) {
      if (side(holder(card2)) !== first) break;
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
  /**
   * Kopie für Simulationen (Berater): gleicher Spielstand, aber andere (geratene) Hände der Mitspieler.
   * hands: Map id → Karten. Bereits gespielte Karten bleiben, wie sie sind.
   */
  cloneForSim(hands) {
    const g = new _SchafkopfGame(
      this.order.map((id) => ({ id })),
      { variant: this.variant, pass: this.pass, extras: { ...this.extras, klopfen: false }, dealerIndex: this.dealerIndex, rand: this.rand }
    );
    const playedBy = (id) => [...this.tricks.flatMap((t) => t.cards), ...this.trick].filter((x) => x.playerId === id).map((x) => x.card);
    g.hands = new Map(this.order.map((id) => [id, [...hands.get(id)]]));
    g.dealt = new Map(this.order.map((id) => [id, [...hands.get(id), ...playedBy(id)]]));
    g.knocks = [...this.knocks];
    g.knockVotes = [...this.knockVotes];
    g.bids = this.bids.map((b) => ({ ...b }));
    g.contract = this.contract ? { ...this.contract } : null;
    g.wedding = this.wedding ? { ...this.wedding, candidates: [...this.wedding.candidates] } : null;
    g.turn = this.turn;
    g.trick = this.trick.map((t) => ({ ...t }));
    g.tricks = this.tricks.map((t) => ({ ...t, cards: t.cards.map((x) => ({ ...x })) }));
    g.won = Object.fromEntries(Object.entries(this.won).map(([k, v]) => [k, [...v]]));
    g.searched = this.searched;
    g.ranAway = this.ranAway;
    g.partnerRevealed = this.partnerRevealed;
    g.doubles = this.doubles.map((d) => ({ ...d }));
    g.phase = this.phase === SK_PHASES.KLOPFEN ? SK_PHASES.BIDDING : this.phase;
    g.stock = this.stock;
    if (g.contract?.calledSuit && !this.partnerRevealed) {
      const holder = this.order.find((id) => g.hands.get(id).some((x) => x.suit === g.contract.calledSuit && x.rank === "A"));
      if (holder) g.contract.partnerId = holder;
    }
    return g;
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

// ../shared/score/ScoreBook.js
var LUEGEN_STAKE = 10;
var MAX_ROUNDS = 200;
var clampName = (n) => String(n ?? "").slice(0, 24);
var ScoreBook = class {
  constructor(data) {
    this.totals = {};
    this.rounds = [];
    if (data && typeof data === "object") {
      for (const [name, v] of Object.entries(data.totals ?? {})) if (Number.isFinite(v)) this.totals[clampName(name)] = Math.round(v);
      for (const r of (Array.isArray(data.rounds) ? data.rounds : []).slice(-MAX_ROUNDS)) {
        if (!r || typeof r !== "object" || typeof r.deltas !== "object") continue;
        const deltas = {};
        for (const [name, v] of Object.entries(r.deltas)) if (Number.isFinite(v)) deltas[clampName(name)] = Math.round(v);
        this.rounds.push({ no: Number(r.no) || this.rounds.length + 1, game: r.game === "schafkopf" ? "schafkopf" : "luegen", label: String(r.label ?? "").slice(0, 80), deltas, at: Number(r.at) || 0 });
      }
    }
  }
  /** Runde eintragen: deltas = { Name: Cent } */
  record({ game, label, deltas }) {
    const clean = {};
    for (const [name, v] of Object.entries(deltas)) {
      const n = clampName(name);
      clean[n] = Math.round(v);
      this.totals[n] = (this.totals[n] ?? 0) + clean[n];
    }
    const round = { no: (this.rounds.at(-1)?.no ?? 0) + 1, game, label, deltas: clean, at: Date.now() };
    this.rounds.push(round);
    if (this.rounds.length > MAX_ROUNDS) this.rounds.shift();
    return round;
  }
  /** Name sicherstellen (neue Mitspieler starten mit 0). */
  ensure(name) {
    const n = clampName(name);
    if (!(n in this.totals)) this.totals[n] = 0;
  }
  rename(oldName, newName) {
    if (oldName === newName || !(oldName in this.totals)) return;
    this.totals[newName] = (this.totals[newName] ?? 0) + this.totals[oldName];
    delete this.totals[oldName];
  }
  toJSON(limit = MAX_ROUNDS) {
    return { totals: { ...this.totals }, rounds: this.rounds.slice(-limit) };
  }
};
function luegenDeltas(names, loserName, stake = LUEGEN_STAKE) {
  const deltas = Object.fromEntries(names.map((n) => [n, stake]));
  deltas[loserName] = -stake * (names.length - 1);
  return deltas;
}

// ../shared/chess/board.js
var WHITE = 0;
var BLACK = 1;
var PAWN = 1;
var KNIGHT = 2;
var BISHOP = 3;
var ROOK = 4;
var QUEEN = 5;
var KING = 6;
var BLACK_BIT = 8;
var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
var F_CAPTURE = 1;
var F_EP = 2;
var F_CASTLE = 4;
var F_DOUBLE = 8;
var F_PROMO = 16;
var mFrom = (m) => m & 127;
var mTo = (m) => m >> 7 & 127;
var mPromo = (m) => m >> 14 & 15;
var mFlags = (m) => m >> 18;
var encode = (from, to, promo, flags) => from | to << 7 | promo << 14 | flags << 18;
var pieceType = (p) => p & 7;
var pieceColor = (p) => p & BLACK_BIT ? BLACK : WHITE;
var N_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
var B_DIRS = [17, 15, -17, -15];
var R_DIRS = [16, -16, 1, -1];
var K_DIRS = [17, 15, -17, -15, 16, -16, 1, -1];
var sq88 = (i) => i >> 3 << 4 | i & 7;
var sqName = (s) => "abcdefgh"[s & 7] + ((s >> 4) + 1);
var sqFromName = (n) => n.charCodeAt(1) - 49 << 4 | n.charCodeAt(0) - 97;
var PIECE_CHARS = " pnbrqk";
var charOf = (p) => {
  const c = PIECE_CHARS[pieceType(p)];
  return pieceColor(p) === WHITE ? c.toUpperCase() : c;
};
var CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[4] = 15 & ~3;
CASTLE_MASK[0] = 15 & ~2;
CASTLE_MASK[7] = 15 & ~1;
CASTLE_MASK[116] = 15 & ~12;
CASTLE_MASK[112] = 15 & ~8;
CASTLE_MASK[119] = 15 & ~4;
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = s + 1831565813 >>> 0;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return (t ^ t >>> 14) >>> 0;
  };
}
var rnd = prng(20261113);
var Z_PIECE_HI = new Uint32Array(16 * 128);
var Z_PIECE_LO = new Uint32Array(16 * 128);
for (let i = 0; i < 16 * 128; i++) {
  Z_PIECE_HI[i] = rnd();
  Z_PIECE_LO[i] = rnd();
}
var Z_CASTLE_HI = Uint32Array.from({ length: 16 }, rnd);
var Z_CASTLE_LO = Uint32Array.from({ length: 16 }, rnd);
var Z_EP_HI = Uint32Array.from({ length: 8 }, rnd);
var Z_EP_LO = Uint32Array.from({ length: 8 }, rnd);
var Z_SIDE_HI = rnd();
var Z_SIDE_LO = rnd();
var MG_VAL = [0, 82, 337, 365, 477, 1025, 0];
var EG_VAL = [0, 94, 281, 297, 512, 936, 0];
var PHASE_INC = [0, 0, 1, 1, 2, 4, 0];
var PST_MG = [
  null,
  [0, 0, 0, 0, 0, 0, 0, 0, 98, 134, 61, 95, 68, 126, 34, -11, -6, 7, 26, 31, 65, 56, 25, -20, -14, 13, 6, 21, 23, 12, 17, -23, -27, -2, -5, 12, 17, 6, 10, -25, -26, -4, -4, -10, 3, 3, 33, -12, -35, -1, -20, -23, -15, 24, 38, -22, 0, 0, 0, 0, 0, 0, 0, 0],
  [-167, -89, -34, -49, 61, -97, -15, -107, -73, -41, 72, 36, 23, 62, 7, -17, -47, 60, 37, 65, 84, 129, 73, 44, -9, 17, 19, 53, 37, 69, 18, 22, -13, 4, 16, 13, 28, 19, 21, -8, -23, -9, 12, 10, 19, 17, 25, -16, -29, -53, -12, -3, -1, 18, -14, -19, -105, -21, -58, -33, -17, -28, -19, -23],
  [-29, 4, -82, -37, -25, -42, 7, -8, -26, 16, -18, -13, 30, 59, 18, -47, -16, 37, 43, 40, 35, 50, 37, -2, -4, 5, 19, 50, 37, 37, 7, -2, -6, 13, 13, 26, 34, 12, 10, 4, 0, 15, 15, 15, 14, 27, 18, 10, 4, 15, 16, 0, 7, 21, 33, 1, -33, -3, -14, -21, -13, -12, -39, -21],
  [32, 42, 32, 51, 63, 9, 31, 43, 27, 32, 58, 62, 80, 67, 26, 44, -5, 19, 26, 36, 17, 45, 61, 16, -24, -11, 7, 26, 24, 35, -8, -20, -36, -26, -12, -1, 9, -7, 6, -23, -45, -25, -16, -17, 3, 0, -5, -33, -44, -16, -20, -9, -1, 11, -6, -71, -19, -13, 1, 17, 16, 7, -37, -26],
  [-28, 0, 29, 12, 59, 44, 43, 45, -24, -39, -5, 1, -16, 57, 28, 54, -13, -17, 7, 8, 29, 56, 47, 57, -27, -27, -16, -16, -1, 17, -2, 1, -9, -26, -9, -10, -2, -4, 3, -3, -14, 2, -11, -2, -5, 2, 14, 5, -35, -8, 11, 2, 8, 15, -3, 1, -1, -18, -9, 10, -15, -25, -31, -50],
  [-65, 23, 16, -15, -56, -34, 2, 13, 29, -1, -20, -7, -8, -4, -38, -29, -9, 24, 2, -16, -20, 6, 22, -22, -17, -20, -12, -27, -30, -25, -14, -36, -49, -1, -27, -39, -46, -44, -33, -51, -14, -14, -22, -46, -44, -30, -15, -27, 1, 7, -8, -64, -43, -16, 9, 8, -15, 36, 12, -54, 8, -28, 24, 14]
];
var PST_EG = [
  null,
  [0, 0, 0, 0, 0, 0, 0, 0, 178, 173, 158, 134, 147, 132, 165, 187, 94, 100, 85, 67, 56, 53, 82, 84, 32, 24, 13, 5, -2, 4, 17, 17, 13, 9, -3, -7, -7, -8, 3, -1, 4, 7, -6, 1, 0, -5, -1, -8, 13, 8, 8, 10, 13, 0, 2, -7, 0, 0, 0, 0, 0, 0, 0, 0],
  [-58, -38, -13, -28, -31, -27, -63, -99, -25, -8, -25, -2, -9, -25, -24, -52, -24, -20, 10, 9, -1, -9, -19, -41, -17, 3, 22, 22, 22, 11, 8, -18, -18, -6, 16, 25, 16, 17, 4, -18, -23, -3, -1, 15, 10, -3, -20, -22, -42, -20, -10, -5, -2, -20, -23, -44, -29, -51, -23, -15, -22, -18, -50, -64],
  [-14, -21, -11, -8, -7, -9, -17, -24, -8, -4, 7, -12, -3, -13, -4, -14, 2, -8, 0, -1, -2, 6, 0, 4, -3, 9, 12, 9, 14, 10, 3, 2, -6, 3, 13, 19, 7, 10, -3, -9, -12, -3, 8, 10, 13, 3, -7, -15, -14, -18, -7, -1, 4, -9, -15, -27, -23, -9, -23, -5, -9, -16, -5, -17],
  [13, 10, 18, 15, 12, 12, 8, 5, 11, 13, 13, 11, -3, 3, 8, 3, 7, 7, 7, 5, 4, -3, -5, -3, 4, 3, 13, 1, 2, 1, -1, 2, 3, 5, 8, 4, -5, -6, -8, -11, -4, 0, -5, -1, -7, -12, -8, -16, -6, -6, 0, 2, -9, -9, -11, -3, -9, 2, 3, -1, -5, -13, 4, -20],
  [-9, 22, 22, 27, 27, 19, 10, 20, -17, 20, 32, 41, 58, 25, 30, 0, -20, 6, 9, 49, 47, 35, 19, 9, 3, 22, 24, 45, 57, 40, 57, 36, -18, 28, 19, 47, 31, 34, 39, 23, -16, -27, 15, 6, 9, 17, 10, 5, -22, -23, -30, -16, -16, -23, -36, -32, -33, -28, -22, -43, -5, -32, -20, -41],
  [-74, -35, -18, -18, -11, 15, 4, -17, -12, 17, 14, 17, 17, 38, 23, 11, 10, 17, 23, 15, 20, 45, 44, 13, -8, 22, 24, 27, 26, 33, 26, 3, -18, -4, 21, 24, 27, 23, 9, -11, -19, -3, 11, 21, 23, 16, 7, -9, -27, -11, 4, 13, 14, 4, -5, -17, -53, -34, -21, -11, -28, -14, -24, -43]
];
var MG = new Int16Array(16 * 128);
var EG = new Int16Array(16 * 128);
for (let t = 1; t <= 6; t++) {
  for (let i = 0; i < 64; i++) {
    const s = sq88(i);
    const rank = i >> 3;
    const file = i & 7;
    const wIdx = (7 - rank) * 8 + file;
    const bIdx = rank * 8 + file;
    MG[t * 128 + s] = MG_VAL[t] + PST_MG[t][wIdx];
    EG[t * 128 + s] = EG_VAL[t] + PST_EG[t][wIdx];
    MG[(t | BLACK_BIT) * 128 + s] = -(MG_VAL[t] + PST_MG[t][bIdx]);
    EG[(t | BLACK_BIT) * 128 + s] = -(EG_VAL[t] + PST_EG[t][bIdx]);
  }
}
var Position = class _Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.stack = [];
    this.hashes = [];
    this.load(fen);
  }
  load(fen) {
    const [placement, side = "w", castling = "-", ep = "-", half = "0", full = "1"] = String(fen).trim().split(/\s+/);
    const b = this.board;
    b.fill(0);
    this.kings = [-1, -1];
    const rows = placement.split("/");
    if (rows.length !== 8) throw new Error("FEN: 8 Reihen erwartet");
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= "1" && ch <= "8") {
          f += Number(ch);
          continue;
        }
        const t = PIECE_CHARS.indexOf(ch.toLowerCase());
        if (t < 1 || f > 7) throw new Error(`FEN: ung\xFCltiges Zeichen ${ch}`);
        const color = ch === ch.toUpperCase() ? WHITE : BLACK;
        const s = 7 - r << 4 | f;
        b[s] = t | (color ? BLACK_BIT : 0);
        if (t === KING) this.kings[color] = s;
        f++;
      }
      if (f !== 8) throw new Error("FEN: Reihe hat nicht 8 Felder");
    }
    if (this.kings[0] < 0 || this.kings[1] < 0) throw new Error("FEN: beide K\xF6nige n\xF6tig");
    this.turn = side === "b" ? BLACK : WHITE;
    this.castling = (castling.includes("K") ? 1 : 0) | (castling.includes("Q") ? 2 : 0) | (castling.includes("k") ? 4 : 0) | (castling.includes("q") ? 8 : 0);
    if (b[4] !== KING) this.castling &= ~3;
    if (b[7] !== ROOK) this.castling &= ~1;
    if (b[0] !== ROOK) this.castling &= ~2;
    if (b[116] !== (KING | BLACK_BIT)) this.castling &= ~12;
    if (b[119] !== (ROOK | BLACK_BIT)) this.castling &= ~4;
    if (b[112] !== (ROOK | BLACK_BIT)) this.castling &= ~8;
    this.ep = ep !== "-" ? sqFromName(ep) : -1;
    this.halfmove = Number(half) || 0;
    this.fullmove = Number(full) || 1;
    this.stack = [];
    this.#recompute();
    this.hashes = [];
  }
  #recompute() {
    let hi = 0;
    let lo = 0;
    let mg = 0;
    let eg = 0;
    let phase = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 136) {
        s += 7;
        continue;
      }
      const p = this.board[s];
      if (!p) continue;
      hi ^= Z_PIECE_HI[p * 128 + s];
      lo ^= Z_PIECE_LO[p * 128 + s];
      mg += MG[p * 128 + s];
      eg += EG[p * 128 + s];
      phase += PHASE_INC[pieceType(p)];
    }
    hi ^= Z_CASTLE_HI[this.castling];
    lo ^= Z_CASTLE_LO[this.castling];
    if (this.ep >= 0) {
      hi ^= Z_EP_HI[this.ep & 7];
      lo ^= Z_EP_LO[this.ep & 7];
    }
    if (this.turn) {
      hi ^= Z_SIDE_HI;
      lo ^= Z_SIDE_LO;
    }
    this.hashHi = hi >>> 0;
    this.hashLo = lo >>> 0;
    this.mg = mg;
    this.eg = eg;
    this.phase = phase;
  }
  get hashKey() {
    return this.hashHi * 4294967296 + this.hashLo;
  }
  fen() {
    let out = "";
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r << 4 | f];
        if (!p) empty++;
        else {
          if (empty) out += empty;
          empty = 0;
          out += charOf(p);
        }
      }
      if (empty) out += empty;
      if (r) out += "/";
    }
    const c = this.castling;
    const cs = (c & 1 ? "K" : "") + (c & 2 ? "Q" : "") + (c & 4 ? "k" : "") + (c & 8 ? "q" : "") || "-";
    return `${out} ${this.turn ? "b" : "w"} ${cs} ${this.epForFen()} ${this.halfmove} ${this.fullmove}`;
  }
  /** En-passant-Feld nur angeben, wenn ein Schlag dort auch möglich ist (wie Lichess/chess.com). */
  epForFen() {
    if (this.ep < 0) return "-";
    const pawn = PAWN | (this.turn ? BLACK_BIT : 0);
    const from = this.ep + (this.turn ? 16 : -16);
    for (const d of [-1, 1]) {
      const s = from + d;
      if (!(s & 136) && this.board[s] === pawn) return sqName(this.ep);
    }
    return "-";
  }
  /** Wird das Feld von der Farbe `by` angegriffen? */
  attacked(sq, by) {
    const b = this.board;
    const cb = by ? BLACK_BIT : 0;
    const pawn = PAWN | cb;
    const pd = by ? 16 : -16;
    let s = sq + pd - 1;
    if (!(s & 136) && b[s] === pawn) return true;
    s = sq + pd + 1;
    if (!(s & 136) && b[s] === pawn) return true;
    const knight = KNIGHT | cb;
    for (let i = 0; i < 8; i++) {
      s = sq + N_DIRS[i];
      if (!(s & 136) && b[s] === knight) return true;
    }
    const king = KING | cb;
    for (let i = 0; i < 8; i++) {
      s = sq + K_DIRS[i];
      if (!(s & 136) && b[s] === king) return true;
    }
    const bishop = BISHOP | cb;
    const queen = QUEEN | cb;
    for (let i = 0; i < 4; i++) {
      const d = B_DIRS[i];
      s = sq + d;
      while (!(s & 136)) {
        const p = b[s];
        if (p) {
          if (p === bishop || p === queen) return true;
          break;
        }
        s += d;
      }
    }
    const rook = ROOK | cb;
    for (let i = 0; i < 4; i++) {
      const d = R_DIRS[i];
      s = sq + d;
      while (!(s & 136)) {
        const p = b[s];
        if (p) {
          if (p === rook || p === queen) return true;
          break;
        }
        s += d;
      }
    }
    return false;
  }
  inCheck(side = this.turn) {
    return this.attacked(this.kings[side], side ^ 1);
  }
  /** Pseudolegale Züge (König darf danach im Schach stehen – makeMove prüft das). */
  generate(out = [], capturesOnly = false) {
    const b = this.board;
    const us = this.turn;
    const cb = us ? BLACK_BIT : 0;
    const fwd = us ? -16 : 16;
    const startRank = us ? 6 : 1;
    const promoRank = us ? 0 : 7;
    for (let from = 0; from < 128; from++) {
      if (from & 136) {
        from += 7;
        continue;
      }
      const p = b[from];
      if (!p || (p & BLACK_BIT) !== cb) continue;
      const t = p & 7;
      if (t === PAWN) {
        const to = from + fwd;
        for (const side of [-1, 1]) {
          const c = to + side;
          if (c & 136) continue;
          const q = b[c];
          if (q && (q & BLACK_BIT) !== cb) {
            if (c >> 4 === promoRank) for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(encode(from, c, pr, F_CAPTURE | F_PROMO));
            else out.push(encode(from, c, 0, F_CAPTURE));
          } else if (c === this.ep) out.push(encode(from, c, 0, F_CAPTURE | F_EP));
        }
        if (!b[to]) {
          if (to >> 4 === promoRank) {
            if (capturesOnly) out.push(encode(from, to, QUEEN, F_PROMO));
            else for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(encode(from, to, pr, F_PROMO));
          } else if (!capturesOnly) {
            out.push(encode(from, to, 0, 0));
            if (from >> 4 === startRank && !b[to + fwd]) out.push(encode(from, to + fwd, 0, F_DOUBLE));
          }
        }
        continue;
      }
      if (t === KNIGHT || t === KING) {
        const dirs2 = t === KNIGHT ? N_DIRS : K_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = from + dirs2[i];
          if (to & 136) continue;
          const q = b[to];
          if (!q) {
            if (!capturesOnly) out.push(encode(from, to, 0, 0));
          } else if ((q & BLACK_BIT) !== cb) out.push(encode(from, to, 0, F_CAPTURE));
        }
        if (t === KING && !capturesOnly) this.#castles(out, from);
        continue;
      }
      const dirs = t === BISHOP ? B_DIRS : t === ROOK ? R_DIRS : K_DIRS;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        let to = from + d;
        while (!(to & 136)) {
          const q = b[to];
          if (!q) {
            if (!capturesOnly) out.push(encode(from, to, 0, 0));
          } else {
            if ((q & BLACK_BIT) !== cb) out.push(encode(from, to, 0, F_CAPTURE));
            break;
          }
          to += d;
        }
      }
    }
    return out;
  }
  #castles(out, from) {
    const b = this.board;
    const us = this.turn;
    const them = us ^ 1;
    if (us === WHITE && from === 4) {
      if (this.castling & 1 && !b[5] && !b[6] && !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them))
        out.push(encode(4, 6, 0, F_CASTLE));
      if (this.castling & 2 && !b[3] && !b[2] && !b[1] && !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them))
        out.push(encode(4, 2, 0, F_CASTLE));
    } else if (us === BLACK && from === 116) {
      if (this.castling & 4 && !b[117] && !b[118] && !this.attacked(116, them) && !this.attacked(117, them) && !this.attacked(118, them))
        out.push(encode(116, 118, 0, F_CASTLE));
      if (this.castling & 8 && !b[115] && !b[114] && !b[113] && !this.attacked(116, them) && !this.attacked(115, them) && !this.attacked(114, them))
        out.push(encode(116, 114, 0, F_CASTLE));
    }
  }
  #put(s, p) {
    this.board[s] = p;
    const i = p * 128 + s;
    this.hashHi ^= Z_PIECE_HI[i];
    this.hashLo ^= Z_PIECE_LO[i];
    this.mg += MG[i];
    this.eg += EG[i];
    this.phase += PHASE_INC[p & 7];
  }
  #remove(s) {
    const p = this.board[s];
    this.board[s] = 0;
    const i = p * 128 + s;
    this.hashHi ^= Z_PIECE_HI[i];
    this.hashLo ^= Z_PIECE_LO[i];
    this.mg -= MG[i];
    this.eg -= EG[i];
    this.phase -= PHASE_INC[p & 7];
    return p;
  }
  /** Zug ausführen. Gibt false zurück (und nimmt ihn zurück), wenn der eigene König danach im Schach steht. */
  makeMove(m) {
    const from = m & 127;
    const to = m >> 7 & 127;
    const flags = m >> 18;
    const us = this.turn;
    this.hashes.push(this.hashKey);
    const undo = { m, captured: 0, castling: this.castling, ep: this.ep, halfmove: this.halfmove, hashHi: this.hashHi, hashLo: this.hashLo };
    this.stack.push(undo);
    this.hashHi ^= Z_CASTLE_HI[this.castling];
    this.hashLo ^= Z_CASTLE_LO[this.castling];
    if (this.ep >= 0) {
      this.hashHi ^= Z_EP_HI[this.ep & 7];
      this.hashLo ^= Z_EP_LO[this.ep & 7];
    }
    const p = this.#remove(from);
    if (flags & F_EP) {
      const cap = to + (us ? 16 : -16);
      undo.captured = this.#remove(cap);
    } else if (flags & F_CAPTURE) undo.captured = this.#remove(to);
    this.#put(to, flags & F_PROMO ? m >> 14 & 15 | (us ? BLACK_BIT : 0) : p);
    if (flags & F_CASTLE) {
      if (to === 6) this.#put(5, this.#remove(7));
      else if (to === 2) this.#put(3, this.#remove(0));
      else if (to === 118) this.#put(117, this.#remove(119));
      else if (to === 114) this.#put(115, this.#remove(112));
    }
    if ((p & 7) === KING) this.kings[us] = to;
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = flags & F_DOUBLE ? from + (us ? -16 : 16) : -1;
    this.halfmove = (p & 7) === PAWN || flags & F_CAPTURE ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.turn = us ^ 1;
    this.hashHi ^= Z_CASTLE_HI[this.castling] ^ Z_SIDE_HI;
    this.hashLo ^= Z_CASTLE_LO[this.castling] ^ Z_SIDE_LO;
    if (this.ep >= 0) {
      this.hashHi ^= Z_EP_HI[this.ep & 7];
      this.hashLo ^= Z_EP_LO[this.ep & 7];
    }
    this.hashHi >>>= 0;
    this.hashLo >>>= 0;
    if (this.attacked(this.kings[us], us ^ 1)) {
      this.unmakeMove();
      return false;
    }
    return true;
  }
  unmakeMove() {
    const undo = this.stack.pop();
    this.hashes.pop();
    const { m } = undo;
    const from = m & 127;
    const to = m >> 7 & 127;
    const flags = m >> 18;
    this.turn ^= 1;
    const us = this.turn;
    if (us === BLACK) this.fullmove--;
    const moved = this.#remove(to);
    this.#put(from, flags & F_PROMO ? PAWN | (us ? BLACK_BIT : 0) : moved);
    if (flags & F_EP) this.#put(to + (us ? 16 : -16), undo.captured);
    else if (undo.captured) this.#put(to, undo.captured);
    if (flags & F_CASTLE) {
      if (to === 6) this.#put(7, this.#remove(5));
      else if (to === 2) this.#put(0, this.#remove(3));
      else if (to === 118) this.#put(119, this.#remove(117));
      else if (to === 114) this.#put(112, this.#remove(115));
    }
    if ((moved & 7) === KING) this.kings[us] = from;
    this.castling = undo.castling;
    this.ep = undo.ep;
    this.halfmove = undo.halfmove;
    this.hashHi = undo.hashHi;
    this.hashLo = undo.hashLo;
  }
  /** Nullzug für die Engine (Seite wechselt, sonst nichts). */
  makeNull() {
    this.hashes.push(this.hashKey);
    this.stack.push({ m: 0, nul: true, ep: this.ep, hashHi: this.hashHi, hashLo: this.hashLo, halfmove: this.halfmove });
    if (this.ep >= 0) {
      this.hashHi ^= Z_EP_HI[this.ep & 7];
      this.hashLo ^= Z_EP_LO[this.ep & 7];
    }
    this.ep = -1;
    this.turn ^= 1;
    this.halfmove++;
    this.hashHi = (this.hashHi ^ Z_SIDE_HI) >>> 0;
    this.hashLo = (this.hashLo ^ Z_SIDE_LO) >>> 0;
  }
  unmakeNull() {
    const u = this.stack.pop();
    this.hashes.pop();
    this.turn ^= 1;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
    this.hashHi = u.hashHi;
    this.hashLo = u.hashLo;
  }
  legalMoves() {
    const out = [];
    for (const m of this.generate()) {
      if (this.makeMove(m)) {
        this.unmakeMove();
        out.push(m);
      }
    }
    return out;
  }
  hasLegalMove() {
    for (const m of this.generate()) {
      if (this.makeMove(m)) {
        this.unmakeMove();
        return true;
      }
    }
    return false;
  }
  /** Wie oft kam die aktuelle Stellung schon vor (inkl. jetzt)? Nur seit dem letzten unumkehrbaren Zug. */
  repetitions() {
    const key2 = this.hashKey;
    let n = 1;
    const h = this.hashes;
    for (let i = h.length - 2, k = 0; i >= 0 && k < this.halfmove - 1; i -= 2, k += 2) if (h[i] === key2) n++;
    return n;
  }
  insufficientMaterial() {
    let minors = 0;
    const bishops = [];
    for (let s = 0; s < 128; s++) {
      if (s & 136) {
        s += 7;
        continue;
      }
      const t = this.board[s] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === BISHOP) bishops.push((s >> 4) + (s & 7) & 1);
    }
    if (minors <= 1) return true;
    return bishops.length === minors && bishops.every((c) => c === bishops[0]);
  }
  /** Ergebnis der Stellung (ohne Uhr): null, oder { result: '1-0'|'0-1'|'1/2-1/2', reason }. */
  outcome() {
    if (!this.hasLegalMove()) {
      if (this.inCheck()) return { result: this.turn === WHITE ? "0-1" : "1-0", reason: "checkmate" };
      return { result: "1/2-1/2", reason: "stalemate" };
    }
    if (this.insufficientMaterial()) return { result: "1/2-1/2", reason: "material" };
    if (this.halfmove >= 100) return { result: "1/2-1/2", reason: "fifty" };
    if (this.repetitions() >= 3) return { result: "1/2-1/2", reason: "repetition" };
    return null;
  }
  // ---------- Notation ----------
  /** Zug → UCI (e2e4, e7e8q) */
  static uci(m) {
    const pr = mPromo(m);
    return sqName(mFrom(m)) + sqName(mTo(m)) + (pr ? " pnbrqk"[pr] : "");
  }
  /** Zug (legal, in dieser Stellung) → SAN */
  san(m, legal = this.legalMoves()) {
    const from = mFrom(m);
    const to = mTo(m);
    const flags = mFlags(m);
    const p = this.board[from];
    const t = p & 7;
    let s;
    if (flags & F_CASTLE) s = (to & 7) === 6 ? "O-O" : "O-O-O";
    else {
      s = "";
      if (t !== PAWN) {
        s = " PNBRQK"[t];
        const others = legal.filter((o) => o !== m && mTo(o) === to && this.board[mFrom(o)] === p);
        if (others.length) {
          const sameFile = others.some((o) => (mFrom(o) & 7) === (from & 7));
          const sameRank = others.some((o) => mFrom(o) >> 4 === from >> 4);
          if (!sameFile) s += "abcdefgh"[from & 7];
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
      } else if (flags & F_CAPTURE) s = "abcdefgh"[from & 7];
      if (flags & F_CAPTURE) s += "x";
      s += sqName(to);
      if (flags & F_PROMO) s += "=" + " PNBRQK"[mPromo(m)];
    }
    if (this.makeMove(m)) {
      if (this.inCheck()) s += this.hasLegalMove() ? "+" : "#";
      this.unmakeMove();
    }
    return s;
  }
  /** UCI- oder SAN-Text → legaler Zug oder 0 */
  parse(text) {
    const legal = this.legalMoves();
    const t = String(text).trim();
    const uci = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/i.exec(t);
    if (uci) {
      const from = sqFromName(uci[1].toLowerCase());
      const to = sqFromName(uci[2].toLowerCase());
      const pr = uci[3] ? " pnbrqk".indexOf(uci[3].toLowerCase()) : 0;
      return legal.find((m) => mFrom(m) === from && mTo(m) === to && (mPromo(m) || 0) === (mFlags(m) & F_PROMO ? pr || QUEEN : 0)) ?? 0;
    }
    const clean = t.replace(/[+#!?]/g, "").replace(/0/g, "O");
    return legal.find((m) => this.san(m, legal).replace(/[+#]/g, "") === clean) ?? 0;
  }
  /** Brett als Liste für die Anzeige: [{sq:'e2', type:'p', color:'w'}] */
  pieces() {
    const out = [];
    for (let s = 0; s < 128; s++) {
      if (s & 136) {
        s += 7;
        continue;
      }
      const p = this.board[s];
      if (p) out.push({ sq: sqName(s), type: PIECE_CHARS[p & 7], color: p & BLACK_BIT ? "b" : "w" });
    }
    return out;
  }
  clone() {
    const c = new _Position(this.fen());
    c.hashes = [...this.hashes];
    return c;
  }
};

// ../shared/chess/ChessGame.js
var ChessError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function parseTimeControl(id) {
  if (!id || id === "none") return null;
  const m = /^(\d{1,3}(?:\.\d+)?)\+(\d{1,3})$/.exec(String(id));
  if (!m) throw new ChessError("BAD_TIME", "Ung\xFCltige Zeitkontrolle.");
  const min = Number(m[1]);
  const inc = Number(m[2]);
  if (!(min > 0 && min <= 180 && inc <= 180)) throw new ChessError("BAD_TIME", "Zeit zwischen 0,5 und 180 Minuten.");
  return { initial: Math.round(min * 6e4), increment: inc * 1e3 };
}
var FIRST_MOVE_MS = 3e4;
function canMate(pos, color) {
  let minors = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 136) {
      s += 7;
      continue;
    }
    const p = pos.board[s];
    if (!p || (p & 8 ? BLACK : WHITE) !== color) continue;
    const t = p & 7;
    if (t === PAWN || t === ROOK || t === QUEEN) return true;
    if (t === KNIGHT || t === BISHOP) minors++;
  }
  return minors >= 2;
}
var ChessGame = class {
  /**
   * @param {{white: string, black: string, time?: string, startFen?: string, now?: number}} opts
   */
  constructor({ white, black, time = "none", startFen, now = Date.now() }) {
    this.kind = "chess";
    this.white = white;
    this.black = black;
    this.order = [white, black];
    this.timeControl = time;
    this.tc = parseTimeControl(time);
    this.startFen = startFen ?? new Position().fen();
    this.pos = new Position(this.startFen);
    this.moves = [];
    this.phase = "playing";
    this.result = null;
    this.drawOffer = null;
    this.seq = 0;
    this.clock = this.tc ? { [WHITE]: this.tc.initial, [BLACK]: this.tc.initial } : null;
    this.turnStarted = now;
    this.clockRunning = false;
  }
  colorOf(playerId) {
    return playerId === this.white ? WHITE : playerId === this.black ? BLACK : -1;
  }
  get currentPlayerId() {
    return this.phase === "playing" ? this.order[this.pos.turn] : null;
  }
  /** Restzeit der Farbe jetzt (läuft nur für den Spieler am Zug). */
  timeLeft(color, now = Date.now()) {
    if (!this.clock) return null;
    const base = this.clock[color];
    if (this.phase !== "playing" || !this.clockRunning || this.pos.turn !== color) return base;
    return base - (now - this.turnStarted);
  }
  /** Wann muss der Server spätestens nachsehen (Zeit/erster Zug)? ms ab jetzt oder null. */
  nextDeadline(now = Date.now()) {
    if (this.phase !== "playing") return null;
    if (this.moves.length < 2) return Math.max(0, FIRST_MOVE_MS - (now - this.turnStarted));
    if (!this.clock) return null;
    return Math.max(0, this.timeLeft(this.pos.turn, now));
  }
  /** Zeit überschritten oder erster Zug verschlafen? Gibt ein Event zurück oder null. */
  checkTime(now = Date.now()) {
    if (this.phase !== "playing") return null;
    if (this.moves.length < 2 && now - this.turnStarted >= FIRST_MOVE_MS) {
      return this.#end({ result: "*", reason: "aborted", winner: null }, { by: this.order[this.pos.turn], firstMove: true });
    }
    if (!this.clock || !this.clockRunning) return null;
    const color = this.pos.turn;
    if (this.timeLeft(color, now) > 0) return null;
    this.clock[color] = 0;
    const other = color ^ 1;
    if (!canMate(this.pos, other)) return this.#end({ result: "1/2-1/2", reason: "timeout_draw", winner: null });
    return this.#end({ result: other === WHITE ? "1-0" : "0-1", reason: "timeout", winner: this.order[other] });
  }
  #end(result, extra = {}) {
    this.phase = "over";
    this.result = result;
    this.drawOffer = null;
    this.seq++;
    return { type: "chess_over", ...result, ...extra };
  }
  /** Zug als UCI (e2e4, e7e8q) oder SAN. */
  play(playerId, text, now = Date.now()) {
    if (this.phase !== "playing") throw new ChessError("OVER", "Die Partie ist vorbei.");
    const color = this.colorOf(playerId);
    if (color < 0) throw new ChessError("NOT_PLAYER", "Du spielst in dieser Partie nicht mit.");
    if (color !== this.pos.turn) throw new ChessError("NOT_YOUR_TURN", "Du bist nicht am Zug.");
    const timeEvent = this.checkTime(now);
    if (timeEvent) return timeEvent;
    const m = this.pos.parse(String(text ?? ""));
    if (!m) throw new ChessError("ILLEGAL", "Ung\xFCltiger Zug.");
    const san = this.pos.san(m);
    const uci = Position.uci(m);
    if (this.clock && this.clockRunning) {
      this.clock[color] = Math.max(0, this.clock[color] - (now - this.turnStarted)) + this.tc.increment;
    }
    this.pos.makeMove(m);
    this.moves.push({ uci, san, from: sqName(mFrom(m)), to: sqName(mTo(m)), at: now, left: this.clock ? this.clock[color] : null });
    if (this.moves.length >= 2) this.clockRunning = Boolean(this.clock);
    this.turnStarted = now;
    if (this.drawOffer && this.drawOffer !== playerId) this.drawOffer = null;
    this.seq++;
    const event = { type: "chess_move", playerId, san, uci, ply: this.moves.length };
    const out = this.pos.outcome();
    if (out) {
      const winner = out.result === "1-0" ? this.white : out.result === "0-1" ? this.black : null;
      return { ...event, over: this.#end({ ...out, winner }) };
    }
    return event;
  }
  resign(playerId) {
    if (this.phase !== "playing") throw new ChessError("OVER", "Die Partie ist vorbei.");
    const color = this.colorOf(playerId);
    if (color < 0) throw new ChessError("NOT_PLAYER", "Du spielst nicht mit.");
    if (this.moves.length < 2) return this.#end({ result: "*", reason: "aborted", winner: null }, { by: playerId });
    const other = color ^ 1;
    return this.#end({ result: other === WHITE ? "1-0" : "0-1", reason: "resign", winner: this.order[other] }, { by: playerId });
  }
  /** Spieler hat den Tisch endgültig verlassen. */
  abandon(playerId) {
    if (this.phase !== "playing") return null;
    const color = this.colorOf(playerId);
    if (color < 0) return null;
    if (this.moves.length < 2) return this.#end({ result: "*", reason: "aborted", winner: null }, { by: playerId });
    const other = color ^ 1;
    return this.#end({ result: other === WHITE ? "1-0" : "0-1", reason: "abandon", winner: this.order[other] }, { by: playerId });
  }
  /** Remis: anbieten / annehmen / ablehnen */
  draw(playerId, action) {
    if (this.phase !== "playing") throw new ChessError("OVER", "Die Partie ist vorbei.");
    if (this.colorOf(playerId) < 0) throw new ChessError("NOT_PLAYER", "Du spielst nicht mit.");
    if (action === "offer") {
      if (this.drawOffer && this.drawOffer !== playerId) return this.#end({ result: "1/2-1/2", reason: "agreement", winner: null });
      if (this.moves.length < 2) throw new ChessError("TOO_EARLY", "Remis erst nach dem ersten Zug.");
      this.drawOffer = playerId;
      this.seq++;
      return { type: "chess_draw_offer", playerId };
    }
    if (action === "accept") {
      if (!this.drawOffer || this.drawOffer === playerId) throw new ChessError("NO_OFFER", "Es liegt kein Remisangebot vor.");
      return this.#end({ result: "1/2-1/2", reason: "agreement", winner: null });
    }
    if (action === "decline") {
      if (!this.drawOffer || this.drawOffer === playerId) return null;
      this.drawOffer = null;
      this.seq++;
      return { type: "chess_draw_declined", playerId };
    }
    throw new ChessError("BAD_ACTION", "Unbekannte Aktion.");
  }
  /** PGN der Partie (für „Partie kopieren“). */
  pgn(names = {}) {
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, ".");
    const res = this.result?.result ?? "*";
    const head = [
      `[Event "L\xFCgen-App Schach"]`,
      `[Date "${date}"]`,
      `[White "${names.white ?? "Wei\xDF"}"]`,
      `[Black "${names.black ?? "Schwarz"}"]`,
      `[Result "${res}"]`,
      `[TimeControl "${this.tc ? `${this.tc.initial / 1e3}+${this.tc.increment / 1e3}` : "-"}"]`
    ];
    const body = this.moves.map((m, i) => i % 2 === 0 ? `${i / 2 + 1}. ${m.san}` : m.san).join(" ");
    return `${head.join("\n")}

${body} ${res}`.trim();
  }
  getStateFor(viewerId, now = Date.now()) {
    const color = this.colorOf(viewerId);
    return {
      kind: "chess",
      phase: this.phase,
      white: this.white,
      black: this.black,
      myColor: color === WHITE ? "w" : color === BLACK ? "b" : null,
      currentPlayerId: this.currentPlayerId,
      turn: this.pos.turn === WHITE ? "w" : "b",
      startFen: this.startFen,
      fen: this.pos.fen(),
      moves: this.moves.map((m) => ({ san: m.san, uci: m.uci, left: m.left })),
      timeControl: this.timeControl,
      clock: this.clock ? { w: this.timeLeft(WHITE, now), b: this.timeLeft(BLACK, now), running: this.phase === "playing" && this.clockRunning, serverNow: now } : null,
      firstMoveLeft: this.phase === "playing" && this.moves.length < 2 ? Math.max(0, FIRST_MOVE_MS - (now - this.turnStarted)) : null,
      drawOffer: this.drawOffer,
      result: this.result,
      check: this.pos.inCheck(),
      seq: this.seq
    };
  }
};

// ../shared/casino/cards.js
var RANKS2 = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
var SUITS2 = ["s", "h", "d", "c"];
var card = (id) => ({ id, rank: id[0], suit: id[1] });
function newDeck(decks = 1) {
  const out = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS2) for (const r of RANKS2) out.push(card(r + s));
  return out;
}
function shuffle2(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand ? Math.floor(rand() * (i + 1)) : randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
var rankValue = (r) => RANKS2.indexOf(r) + 2;
var HAND_NAMES = ["H\xF6chste Karte", "Ein Paar", "Zwei Paare", "Drilling", "Stra\xDFe", "Flush", "Full House", "Vierling", "Straight Flush", "Royal Flush"];
function evaluate(cards) {
  const n = cards.length;
  const vals = cards.map((c) => rankValue(c.rank));
  const bySuit = { s: [], h: [], d: [], c: [] };
  cards.forEach((c, i) => bySuit[c.suit].push(i));
  const count = new Array(15).fill(0);
  vals.forEach((v) => count[v]++);
  const pack = (cat, ks) => {
    let s = cat;
    for (let i = 0; i < 5; i++) s = s * 15 + (ks[i] ?? 0);
    return s;
  };
  const straightHigh = (present) => {
    const has = new Array(15).fill(false);
    for (const v of present) has[v] = true;
    has[1] = has[14];
    for (let h = 14; h >= 5; h--) {
      let ok = true;
      for (let k2 = 0; k2 < 5; k2++) if (!has[h - k2]) ok = false;
      if (ok) return h;
    }
    return 0;
  };
  const pickByValue = (wanted, from = cards.map((_, i) => i)) => {
    const used = /* @__PURE__ */ new Set();
    const out = [];
    for (const v of wanted) {
      const idx = from.find((i) => !used.has(i) && (vals[i] === v || v === 1 && vals[i] === 14));
      if (idx !== void 0) {
        used.add(idx);
        out.push(cards[idx].id);
      }
    }
    return out;
  };
  let flushSuit = null;
  for (const s of SUITS2) if (bySuit[s].length >= 5) flushSuit = s;
  if (flushSuit) {
    const idx = bySuit[flushSuit];
    const fv = idx.map((i) => vals[i]);
    const sh2 = straightHigh(fv);
    if (sh2) {
      const want = [0, 1, 2, 3, 4].map((k2) => sh2 - k2);
      const cat = sh2 === 14 ? 9 : 8;
      return { score: pack(cat, [sh2]), cat, name: HAND_NAMES[cat], best: pickByValue(want, idx) };
    }
  }
  const groups = [];
  for (let v = 14; v >= 2; v--) if (count[v]) groups.push([count[v], v]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kickers = (exclude, k2) => {
    const out = [];
    for (let v = 14; v >= 2 && out.length < k2; v--) if (count[v] && !exclude.includes(v)) out.push(v);
    return out;
  };
  if (groups[0][0] === 4) {
    const q = groups[0][1];
    const k2 = kickers([q], 1);
    return { score: pack(7, [q, ...k2]), cat: 7, name: HAND_NAMES[7], best: pickByValue([q, q, q, q, ...k2]) };
  }
  if (groups[0][0] === 3 && groups.some((g, i) => i > 0 && g[0] >= 2)) {
    const t = groups[0][1];
    const p = groups.filter((g, i) => i > 0 && g[0] >= 2).sort((a, b) => b[1] - a[1])[0][1];
    return { score: pack(6, [t, p]), cat: 6, name: HAND_NAMES[6], best: pickByValue([t, t, t, p, p]) };
  }
  if (flushSuit) {
    const idx = [...bySuit[flushSuit]].sort((a, b) => vals[b] - vals[a]).slice(0, 5);
    const ks = idx.map((i) => vals[i]);
    return { score: pack(5, ks), cat: 5, name: HAND_NAMES[5], best: idx.map((i) => cards[i].id) };
  }
  const sh = straightHigh(vals);
  if (sh) {
    const want = [0, 1, 2, 3, 4].map((k2) => sh - k2 === 1 ? 1 : sh - k2);
    return { score: pack(4, [sh]), cat: 4, name: HAND_NAMES[4], best: pickByValue(want) };
  }
  if (groups[0][0] === 3) {
    const t = groups[0][1];
    const k2 = kickers([t], 2);
    return { score: pack(3, [t, ...k2]), cat: 3, name: HAND_NAMES[3], best: pickByValue([t, t, t, ...k2]) };
  }
  if (groups[0][0] === 2 && groups[1]?.[0] === 2) {
    const [p1, p2] = [groups[0][1], groups[1][1]];
    const k2 = kickers([p1, p2], 1);
    return { score: pack(2, [p1, p2, ...k2]), cat: 2, name: HAND_NAMES[2], best: pickByValue([p1, p1, p2, p2, ...k2]) };
  }
  if (groups[0][0] === 2) {
    const p = groups[0][1];
    const k2 = kickers([p], 3);
    return { score: pack(1, [p, ...k2]), cat: 1, name: HAND_NAMES[1], best: pickByValue([p, p, ...k2]) };
  }
  const k = kickers([], Math.min(5, n));
  return { score: pack(0, k), cat: 0, name: HAND_NAMES[0], best: pickByValue(k) };
}
function describeHand(ev) {
  const top = Math.floor(ev.score / 15 ** 4) % 15;
  const sec = Math.floor(ev.score / 15 ** 3) % 15;
  const nm = (v) => ({ 14: "Asse", 13: "K\xF6nige", 12: "Damen", 11: "Buben", 10: "Zehner" })[v] ?? `${v}er`;
  const hi = (v) => ({ 14: "zum Ass", 13: "zum K\xF6nig", 12: "zur Dame", 11: "zum Buben" })[v] ?? `zur ${v}`;
  switch (ev.cat) {
    case 1:
      return `Paar ${nm(top)}`;
    case 2:
      return `Zwei Paare, ${nm(top)} und ${nm(sec)}`;
    case 3:
      return `Drilling ${nm(top)}`;
    case 4:
      return `Stra\xDFe bis ${hi(top)}`;
    case 6:
      return `Full House, ${nm(top)} \xFCber ${nm(sec)}`;
    case 7:
      return `Vierling ${nm(top)}`;
    case 8:
      return `Straight Flush bis ${hi(top)}`;
    default:
      return ev.name;
  }
}

// ../shared/poker/PokerGame.js
var PokerError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var POKER_DEFAULTS = { startChips: 1e3, sb: 5, bb: 10, mode: "cash", blindEvery: 10, turnMs: 3e4 };
var POKER_MAX_PLAYERS = 9;
var STREETS = ["preflop", "flop", "turn", "river"];
var PokerGame = class {
  /**
   * @param {{id:string,name?:string}[]} players – Sitzreihenfolge im Uhrzeigersinn
   * @param {{startChips?:number,sb?:number,bb?:number,mode?:'cash'|'tournament',blindEvery?:number,turnMs?:number,rand?:Function}} opts
   */
  constructor(players, opts = {}) {
    if (players.length < 2) throw new PokerError("PLAYER_COUNT", "Poker braucht mindestens 2 Spieler.");
    if (players.length > POKER_MAX_PLAYERS) throw new PokerError("PLAYER_COUNT", `H\xF6chstens ${POKER_MAX_PLAYERS} Spieler.`);
    this.kind = "poker";
    this.opts = { ...POKER_DEFAULTS, ...opts };
    this.rand = opts.rand;
    this.order = players.map((p) => p.id);
    this.stacks = Object.fromEntries(players.map((p) => [p.id, this.opts.startChips]));
    this.buyins = Object.fromEntries(players.map((p) => [p.id, 1]));
    this.sb = this.opts.sb;
    this.bb = this.opts.bb;
    this.level = 1;
    this.handNo = 0;
    this.button = -1;
    this.eliminated = [];
    this.seq = 0;
    this.history = [];
    this.startHand();
  }
  get mode() {
    return this.opts.mode;
  }
  /** Spieler, die in dieser Hand Karten haben (nicht pleite/ausgeschieden). */
  #seated() {
    return this.order.filter((id) => this.stacks[id] > 0 && !this.eliminated.includes(id));
  }
  #nextSeat(fromIdx, pred) {
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx + k) % n;
      if (pred(this.order[i])) return i;
    }
    return -1;
  }
  startHand() {
    for (const id of this.order) {
      if (this.stacks[id] > 0 || this.eliminated.includes(id)) continue;
      if (this.mode === "cash") {
        if (this.opts.rebuy === false) continue;
        this.stacks[id] = this.opts.startChips;
        this.buyins[id] += 1;
      } else this.eliminated.push(id);
    }
    const seated = this.#seated();
    if (seated.length < 2) {
      this.phase = "over";
      this.winnerId = seated[0] ?? null;
      this.currentPlayerId = null;
      this.seq++;
      return { type: "poker_over", winnerId: this.winnerId };
    }
    if (this.mode === "tournament" && this.handNo > 0 && this.handNo % this.opts.blindEvery === 0) {
      this.level += 1;
      this.sb = Math.round(this.opts.sb * 1.5 ** (this.level - 1));
      this.bb = this.sb * 2;
    }
    this.handNo += 1;
    const live = (id) => this.stacks[id] > 0 && !this.eliminated.includes(id);
    this.button = this.#nextSeat(this.button < 0 ? this.order.length - 1 : this.button, live);
    this.deck = shuffle2(newDeck(), this.rand);
    this.board = [];
    this.holes = {};
    this.inHand = new Set(seated);
    this.folded = /* @__PURE__ */ new Set();
    this.allIn = /* @__PURE__ */ new Set();
    this.bets = Object.fromEntries(seated.map((id) => [id, 0]));
    this.committed = Object.fromEntries(seated.map((id) => [id, 0]));
    this.shown = {};
    this.result = null;
    this.lastAction = {};
    for (let r = 0; r < 2; r++) for (const id of this.#fromButton(1)) (this.holes[id] ??= []).push(this.deck.pop());
    const headsUp = seated.length === 2;
    const sbIdx = headsUp ? this.button : this.#nextSeat(this.button, live);
    const bbIdx = this.#nextSeat(sbIdx, live);
    this.sbId = this.order[sbIdx];
    this.bbId = this.order[bbIdx];
    this.#post(this.sbId, this.sb);
    this.#post(this.bbId, this.bb);
    this.lastAction[this.sbId] = { type: "sb", amount: this.bets[this.sbId] };
    this.lastAction[this.bbId] = { type: "bb", amount: this.bets[this.bbId] };
    this.street = "preflop";
    this.phase = "betting";
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this.locked = /* @__PURE__ */ new Set();
    this.acted = /* @__PURE__ */ new Set();
    this.needToAct = new Set([...this.inHand].filter((id) => !this.allIn.has(id)));
    const first = this.order[this.#nextSeat(bbIdx, (id) => this.needToAct.has(id))] ?? null;
    this.currentPlayerId = first;
    this.turnStarted = Date.now();
    this.seq++;
    const ev = { type: "poker_hand", handNo: this.handNo, button: this.order[this.button], sbId: this.sbId, bbId: this.bbId, sb: this.sb, bb: this.bb };
    if (this.needToAct.size === 0 || this.needToAct.size === 1 && this.bets[first] >= this.currentBet) return { ...ev, after: this.#endRound() };
    return ev;
  }
  /** Spieler in Reihenfolge ab Button+offset (nur die mit Karten). */
  #fromButton(offset = 1) {
    const out = [];
    const n = this.order.length;
    for (let k = 0; k < n; k++) {
      const id = this.order[(this.button + offset + k) % n];
      if (this.inHand.has(id)) out.push(id);
    }
    return out;
  }
  #post(id, amount) {
    const a = Math.min(amount, this.stacks[id]);
    this.stacks[id] -= a;
    this.bets[id] += a;
    this.committed[id] += a;
    if (this.stacks[id] === 0) this.allIn.add(id);
    return a;
  }
  /** Erlaubte Aktionen für den Spieler am Zug. */
  options(id = this.currentPlayerId) {
    if (this.phase !== "betting" || id !== this.currentPlayerId) return null;
    const toCall = this.currentBet - this.bets[id];
    const stack = this.stacks[id];
    const maxTo = this.bets[id] + stack;
    const canRaise = !this.locked.has(id) && maxTo > this.currentBet && [...this.inHand].some((o) => o !== id && !this.folded.has(o) && !this.allIn.has(o));
    const minTo = Math.min(maxTo, this.currentBet + this.minRaise);
    return {
      toCall: Math.min(toCall, stack),
      canCheck: toCall <= 0,
      canCall: toCall > 0,
      canRaise,
      isBet: this.currentBet === 0,
      minTo: canRaise ? this.currentBet === 0 ? Math.min(maxTo, this.bb) : minTo : null,
      maxTo,
      pot: this.potTotal()
    };
  }
  potTotal() {
    return Object.values(this.committed).reduce((a, b) => a + b, 0);
  }
  /**
   * Aktion: { type: 'fold' | 'check' | 'call' | 'raise' | 'allin', to?: Gesamteinsatz dieser Runde }
   * 'raise' gilt auch für Bet. 'allin' = alles setzen (als Call oder Raise).
   */
  act(id, action) {
    if (this.phase !== "betting") throw new PokerError("NOT_BETTING", "Gerade wird nicht gesetzt.");
    if (id !== this.currentPlayerId) throw new PokerError("NOT_YOUR_TURN", "Du bist nicht dran.");
    const o = this.options(id);
    const type = action?.type;
    let event = { type: "poker_action", playerId: id, action: type };
    if (type === "fold") {
      this.folded.add(id);
      this.needToAct.delete(id);
    } else if (type === "check") {
      if (!o.canCheck) throw new PokerError("CANT_CHECK", "Schieben geht nicht \u2013 es liegt ein Einsatz.");
      this.needToAct.delete(id);
    } else if (type === "call") {
      if (!o.canCall) throw new PokerError("NOTHING_TO_CALL", "Es gibt nichts mitzugehen.");
      event.amount = this.#post(id, o.toCall);
      this.needToAct.delete(id);
    } else if (type === "raise" || type === "allin") {
      let to = type === "allin" ? o.maxTo : Math.floor(Number(action.to));
      if (type === "allin" && !o.canRaise) {
        if (!o.canCall && !o.canCheck) throw new PokerError("BAD_ACTION", "Ung\xFCltig.");
        if (o.canCall) {
          event = { ...event, action: "call", amount: this.#post(id, o.toCall) };
          this.needToAct.delete(id);
          return this.#afterAction(id, event);
        }
        throw new PokerError("CANT_RAISE", "Erh\xF6hen ist hier nicht erlaubt.");
      }
      if (!o.canRaise) throw new PokerError("CANT_RAISE", "Erh\xF6hen ist hier nicht erlaubt.");
      if (!Number.isFinite(to)) throw new PokerError("BAD_AMOUNT", "Ung\xFCltiger Betrag.");
      to = Math.min(to, o.maxTo);
      if (to <= this.currentBet) {
        event = { ...event, action: "call", amount: this.#post(id, Math.max(0, this.currentBet - this.bets[id])) };
        this.needToAct.delete(id);
        return this.#afterAction(id, event);
      }
      if (to < o.minTo && to < o.maxTo) throw new PokerError("RAISE_TOO_SMALL", `Mindestens auf ${o.minTo} erh\xF6hen.`);
      const raiseBy = to - this.currentBet;
      this.#post(id, to - this.bets[id]);
      const full = raiseBy >= this.minRaise || this.currentBet === 0 && to >= this.bb;
      event = { ...event, action: this.currentBet === 0 ? "bet" : "raise", to };
      if (full) {
        this.minRaise = Math.max(this.minRaise, raiseBy);
        this.locked.clear();
        this.acted.clear();
      } else {
        for (const a of this.acted) this.locked.add(a);
      }
      this.currentBet = to;
      this.needToAct = new Set([...this.inHand].filter((p) => p !== id && !this.folded.has(p) && !this.allIn.has(p)));
    } else throw new PokerError("BAD_ACTION", "Unbekannte Aktion.");
    return this.#afterAction(id, event);
  }
  #afterAction(id, event) {
    if (this.stacks[id] === 0 && !this.folded.has(id)) {
      this.allIn.add(id);
      event.allIn = true;
    }
    this.acted.add(id);
    this.lastAction[id] = { type: event.action, amount: event.to ?? event.amount };
    this.seq++;
    const alive = [...this.inHand].filter((p) => !this.folded.has(p));
    if (alive.length === 1) return { ...event, after: this.#award(true) };
    if (this.needToAct.size === 0) return { ...event, after: this.#endRound() };
    const idx = this.order.indexOf(id);
    this.currentPlayerId = this.order[this.#nextSeat(idx, (p) => this.needToAct.has(p))];
    this.turnStarted = Date.now();
    return event;
  }
  #endRound() {
    for (const id of Object.keys(this.bets)) this.bets[id] = 0;
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.locked = /* @__PURE__ */ new Set();
    this.acted = /* @__PURE__ */ new Set();
    const canAct = [...this.inHand].filter((p) => !this.folded.has(p) && !this.allIn.has(p));
    const streetIdx = STREETS.indexOf(this.street);
    if (streetIdx === 3) return this.#award(false);
    this.street = STREETS[streetIdx + 1];
    this.deck.pop();
    if (this.street === "flop") this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else this.board.push(this.deck.pop());
    this.seq++;
    if (canAct.length <= 1) {
      this.allInRunout = true;
      return { type: "poker_street", street: this.street, board: this.board.map((c) => c.id), runout: true, next: this.#endRound() };
    }
    this.needToAct = new Set(canAct);
    const first = this.order[this.#nextSeat(this.button, (p) => this.needToAct.has(p))];
    this.currentPlayerId = first;
    this.turnStarted = Date.now();
    return { type: "poker_street", street: this.street, board: this.board.map((c) => c.id) };
  }
  /** Töpfe bilden und verteilen. */
  #award(uncontested) {
    this.phase = "showdown";
    this.currentPlayerId = null;
    const alive = [...this.inHand].filter((p) => !this.folded.has(p));
    const hands = {};
    if (!uncontested) {
      for (const id of alive) {
        const ev = evaluate([...this.holes[id], ...this.board]);
        hands[id] = { score: ev.score, name: describeHand(ev), best: ev.best };
        this.shown[id] = true;
      }
    }
    const levels = [...new Set(Object.values(this.committed).filter((v) => v > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const id of Object.keys(this.committed)) amount += Math.max(0, Math.min(this.committed[id], lv) - prev);
      const eligible = alive.filter((id) => this.committed[id] >= lv);
      if (amount > 0) {
        const last = pots[pots.length - 1];
        if (last && last.eligible.join() === eligible.join()) last.amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = lv;
    }
    const won = Object.fromEntries(Object.keys(this.committed).map((id) => [id, 0]));
    const potResults = [];
    for (const pot of pots) {
      let winners;
      if (pot.eligible.length === 0) {
        const top = Object.keys(this.committed).sort((a, b) => this.committed[b] - this.committed[a])[0];
        winners = [top];
      } else if (pot.eligible.length === 1) winners = pot.eligible;
      else {
        const best = Math.max(...pot.eligible.map((id) => hands[id].score));
        winners = pot.eligible.filter((id) => hands[id].score === best);
      }
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const ordered = this.#fromButton(1).filter((id) => winners.includes(id));
      for (const id of ordered) {
        won[id] += share + (odd > 0 ? 1 : 0);
        odd = Math.max(0, odd - 1);
      }
      potResults.push({ amount: pot.amount, winners, returned: pot.eligible.length === 1 && pots.length > 1 && pot === pots[pots.length - 1] && !uncontested });
    }
    for (const id of Object.keys(won)) this.stacks[id] += won[id];
    const net = Object.fromEntries(Object.keys(won).map((id) => [id, won[id] - this.committed[id]]));
    this.result = { uncontested, pots: potResults, won, net, hands };
    this.history.unshift({
      handNo: this.handNo,
      board: this.board.map((c) => c.id),
      winners: [...new Set(potResults.flatMap((p) => p.winners))],
      pot: this.potTotal(),
      hand: uncontested ? null : hands[potResults[0]?.winners[0]]?.name
    });
    this.history = this.history.slice(0, 20);
    this.showdownAt = Date.now();
    this.seq++;
    return { type: "poker_showdown", uncontested, pots: potResults, won, hands, board: this.board.map((c) => c.id) };
  }
  /** Nach dem Showdown: Karten freiwillig zeigen. */
  show(id) {
    if (this.phase !== "showdown" || !this.holes[id]) throw new PokerError("NOT_NOW", "Jetzt nicht.");
    this.shown[id] = true;
    this.seq++;
    return { type: "poker_show", playerId: id };
  }
  nextHand() {
    if (this.phase !== "showdown") throw new PokerError("NOT_NOW", "Die Hand l\xE4uft noch.");
    return this.startHand();
  }
  /** Zeit abgelaufen: schieben wenn möglich, sonst aussteigen. */
  timeout(id = this.currentPlayerId) {
    const o = this.options(id);
    if (!o) return null;
    return this.act(id, { type: o.canCheck ? "check" : "fold" });
  }
  /** Taler-Tisch: pleite Spieler kauft nach (wirkt ab der nächsten Hand). */
  rebuy(id, amount) {
    if (!this.order.includes(id) || this.eliminated.includes(id)) throw new PokerError("NOT_SEATED", "Du sitzt nicht am Tisch.");
    if (this.mode !== "cash") throw new PokerError("NO_REBUY", "Im Turnier gibt es kein Nachkaufen.");
    if (this.stacks[id] > 0) throw new PokerError("NOT_BROKE", "Du hast noch Chips.");
    this.stacks[id] = amount;
    this.buyins[id] += 1;
    this.seq++;
    return { type: "poker_rebuy", playerId: id, amount };
  }
  /** Spieler verlässt den Tisch: Karten weg, Chips bleiben verloren. */
  removePlayer(id) {
    if (!this.order.includes(id)) return null;
    let ev = null;
    if (this.phase === "betting" && this.inHand.has(id) && !this.folded.has(id)) {
      if (this.currentPlayerId === id) ev = this.act(id, { type: "fold" });
      else {
        this.folded.add(id);
        this.needToAct.delete(id);
        const alive = [...this.inHand].filter((p) => !this.folded.has(p));
        if (alive.length === 1) ev = this.#award(true);
      }
    }
    this.lastCashout = { id, amount: this.stacks[id] };
    this.stacks[id] = 0;
    if (!this.eliminated.includes(id)) this.eliminated.push(id);
    this.seq++;
    return ev;
  }
  replacePlayer(oldId, newId2) {
    const i = this.order.indexOf(oldId);
    if (i < 0) return;
    this.order[i] = newId2;
    const move = (obj) => {
      if (obj && oldId in obj) {
        obj[newId2] = obj[oldId];
        delete obj[oldId];
      }
    };
    [this.stacks, this.buyins, this.holes, this.bets, this.committed, this.shown, this.lastAction].forEach(move);
    for (const set of [this.inHand, this.folded, this.allIn, this.needToAct, this.locked, this.acted]) if (set?.delete(oldId)) set.add(newId2);
    if (this.currentPlayerId === oldId) this.currentPlayerId = newId2;
    if (this.sbId === oldId) this.sbId = newId2;
    if (this.bbId === oldId) this.bbId = newId2;
    this.seq++;
  }
  getStateFor(viewer) {
    const showAll = this.phase === "showdown";
    return {
      kind: "poker",
      phase: this.phase,
      street: this.street,
      handNo: this.handNo,
      mode: this.mode,
      level: this.level,
      sb: this.sb,
      bb: this.bb,
      order: this.order,
      button: this.order[this.button],
      sbId: this.sbId,
      bbId: this.bbId,
      currentPlayerId: this.currentPlayerId,
      board: this.board.map((c) => c.id),
      stacks: this.stacks,
      bets: this.bets,
      committed: this.committed,
      buyins: this.buyins,
      startChips: this.opts.startChips,
      inHand: [...this.inHand],
      folded: [...this.folded],
      allIn: [...this.allIn],
      eliminated: this.eliminated,
      lastAction: this.lastAction,
      pot: this.potTotal(),
      currentBet: this.currentBet,
      holes: Object.fromEntries(
        Object.entries(this.holes).map(([id, cs]) => [id, id === viewer || showAll && this.shown[id] ? cs.map((c) => c.id) : cs.map(() => null)])
      ),
      options: viewer === this.currentPlayerId ? this.options(viewer) : null,
      myHand: this.holes[viewer] && this.board.length ? describeHand(evaluate([...this.holes[viewer], ...this.board])) : null,
      result: this.result,
      history: this.history.slice(0, 10),
      winnerId: this.winnerId ?? null,
      turnMs: this.opts.turnMs,
      turnLeft: this.phase === "betting" && this.opts.turnMs ? Math.max(0, this.opts.turnMs - (Date.now() - this.turnStarted)) : null,
      seq: this.seq
    };
  }
};

// ../shared/blackjack/BlackjackGame.js
var BlackjackError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var BJ_DEFAULTS = { decks: 6, h17: false, bjPays: "3:2", surrender: true, das: true, maxHands: 4, startChips: 1e3, minBet: 5, maxBet: 1e3, turnMs: 3e4, betMs: 2e4 };
var BJ_MAX_SEATS = 7;
var cardValue = (c) => c.rank === "A" ? 11 : "TJQK".includes(c.rank) ? 10 : Number(c.rank);
var tenValue = (c) => cardValue(c) === 10;
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0, bust: total > 21 };
}
var BlackjackGame = class {
  constructor(players, opts = {}) {
    if (!players.length) throw new BlackjackError("PLAYER_COUNT", "Mindestens ein Spieler.");
    if (players.length > BJ_MAX_SEATS) throw new BlackjackError("PLAYER_COUNT", `H\xF6chstens ${BJ_MAX_SEATS} Pl\xE4tze.`);
    this.kind = "blackjack";
    this.opts = { ...BJ_DEFAULTS, ...opts };
    this.rand = opts.rand;
    this.order = players.map((p) => p.id);
    this.chips = Object.fromEntries(players.map((p) => [p.id, this.opts.startChips]));
    this.refills = Object.fromEntries(players.map((p) => [p.id, 0]));
    this.lastBet = {};
    this.round = 0;
    this.seq = 0;
    this.#newShoe();
    this.startBetting();
  }
  #newShoe() {
    this.shoe = shuffle2(newDeck(this.opts.decks), this.rand);
    this.cut = Math.floor(this.shoe.length * 0.25);
    this.shuffled = true;
  }
  #draw() {
    if (!this.shoe.length) this.#newShoe();
    return this.shoe.pop();
  }
  startBetting() {
    if (this.shoe.length <= this.cut) this.#newShoe();
    for (const id of this.order) {
      if (this.opts.refill !== false && this.chips[id] < this.opts.minBet) {
        this.chips[id] = this.opts.startChips;
        this.refills[id] += 1;
      }
    }
    this.round += 1;
    this.phase = "betting";
    this.bets = {};
    this.ready = /* @__PURE__ */ new Set();
    this.hands = {};
    this.insurance = {};
    this.dealer = [];
    this.holeHidden = true;
    this.active = null;
    this.results = null;
    this.betStarted = Date.now();
    this.seq++;
    return { type: "bj_betting", round: this.round };
  }
  get currentPlayerId() {
    return this.phase === "playing" ? this.active?.id ?? null : null;
  }
  /** Einsatz setzen (0 = diese Runde aussetzen). Sind alle fertig, wird ausgeteilt. */
  bet(id, amount) {
    if (this.phase !== "betting") throw new BlackjackError("NOT_BETTING", "Gerade wird nicht gesetzt.");
    if (!this.order.includes(id)) throw new BlackjackError("NOT_PLAYER", "Du sitzt nicht am Tisch.");
    const a = Math.floor(Number(amount) || 0);
    if (a !== 0 && (a < this.opts.minBet || a > Math.min(this.opts.maxBet, this.chips[id])))
      throw new BlackjackError("BAD_BET", `Einsatz zwischen ${this.opts.minBet} und ${Math.min(this.opts.maxBet, this.chips[id])}.`);
    if (a) {
      this.bets[id] = a;
      this.lastBet[id] = a;
    } else delete this.bets[id];
    this.ready.add(id);
    this.seq++;
    if (this.order.every((p) => this.ready.has(p))) return this.deal();
    return { type: "bj_bet", playerId: id, amount: a };
  }
  /** Austeilen (alle gesetzt oder Zeit für Einsätze abgelaufen). */
  deal() {
    if (this.phase !== "betting") throw new BlackjackError("NOT_BETTING", "Schon ausgeteilt.");
    const players = this.order.filter((id) => this.bets[id] > 0);
    if (!players.length) {
      this.ready = /* @__PURE__ */ new Set();
      this.betStarted = Date.now();
      this.seq++;
      return { type: "bj_nobody" };
    }
    for (const id of players) {
      this.chips[id] -= this.bets[id];
      this.hands[id] = [{ cards: [], bet: this.bets[id], doubled: false, split: false, done: false }];
    }
    this.shuffled = false;
    for (let r = 0; r < 2; r++) {
      for (const id of players) this.hands[id][0].cards.push(this.#draw());
      this.dealer.push(this.#draw());
    }
    this.seq++;
    const up2 = this.dealer[0];
    if (up2.rank === "A") {
      this.phase = "insurance";
      this.insurance = {};
      this.insStarted = Date.now();
      return { type: "bj_deal", insurance: true };
    }
    return { type: "bj_deal", ...this.#afterPeek() };
  }
  /** Versicherung: ja/nein (kostet den halben Einsatz, zahlt 2:1). */
  insure(id, yes) {
    if (this.phase !== "insurance") throw new BlackjackError("NOT_NOW", "Keine Versicherung jetzt.");
    if (!this.hands[id]) throw new BlackjackError("NOT_PLAYER", "Du spielst diese Runde nicht.");
    if (id in this.insurance) return null;
    const cost = Math.floor(this.hands[id][0].bet / 2);
    if (yes && cost > this.chips[id]) throw new BlackjackError("NO_CHIPS", "Nicht genug Chips f\xFCr die Versicherung.");
    this.insurance[id] = yes ? cost : 0;
    if (yes) this.chips[id] -= cost;
    this.seq++;
    if (Object.keys(this.hands).every((p) => p in this.insurance)) return { type: "bj_insured", ...this.#afterPeek() };
    return { type: "bj_insure", playerId: id, yes };
  }
  /** Dealer schaut bei Ass/Zehn nach Blackjack. */
  #afterPeek() {
    const dv = handValue(this.dealer);
    const dealerBJ = dv.total === 21 && this.dealer.length === 2;
    if ((this.dealer[0].rank === "A" || tenValue(this.dealer[0])) && dealerBJ) {
      this.holeHidden = false;
      return { dealerBlackjack: true, settle: this.#settle() };
    }
    this.phase = "playing";
    for (const id of Object.keys(this.hands)) {
      const h = this.hands[id][0];
      if (handValue(h.cards).total === 21) {
        h.done = true;
        h.blackjack = true;
      }
    }
    return { peeked: this.dealer[0].rank === "A" || tenValue(this.dealer[0]), next: this.#advance() };
  }
  /** Nächste offene Hand suchen – sonst spielt der Dealer. */
  #advance() {
    for (const id of this.order) {
      const hs = this.hands[id];
      if (!hs) continue;
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i];
        if (h.done) continue;
        if (h.cards.length === 1) {
          h.cards.push(this.#draw());
          if (h.splitAces || handValue(h.cards).total === 21) {
            h.done = true;
            continue;
          }
        }
        this.active = { id, hand: i };
        this.turnStarted = Date.now();
        this.seq++;
        return { type: "bj_turn", playerId: id, hand: i };
      }
    }
    this.active = null;
    return this.#dealerPlay();
  }
  #dealerPlay() {
    this.phase = "dealer";
    this.holeHidden = false;
    const live = Object.values(this.hands).some((hs) => hs.some((h) => !h.surrendered && !handValue(h.cards).bust && !h.blackjack));
    if (live) {
      for (; ; ) {
        const v = handValue(this.dealer);
        if (v.total > 17 || v.total === 17 && !(v.soft && this.opts.h17)) break;
        this.dealer.push(this.#draw());
      }
    }
    return this.#settle();
  }
  #settle() {
    this.phase = "settled";
    this.holeHidden = false;
    this.active = null;
    const dv = handValue(this.dealer);
    const dealerBJ = dv.total === 21 && this.dealer.length === 2;
    const [num, den] = this.opts.bjPays.split(":").map(Number);
    const results = {};
    for (const [id, hs] of Object.entries(this.hands)) {
      let net = 0;
      const ins = this.insurance[id] ?? 0;
      if (ins) {
        if (dealerBJ) {
          this.chips[id] += ins * 3;
          net += ins * 2;
        } else net -= ins;
      }
      for (const h of hs) {
        const v = handValue(h.cards);
        let pay = 0;
        let res;
        if (h.surrendered) {
          pay = Math.floor(h.bet / 2);
          res = "surrender";
        } else if (v.bust) res = "bust";
        else if (h.blackjack && !h.split) {
          if (dealerBJ) {
            pay = h.bet;
            res = "push";
          } else {
            pay = h.bet + Math.floor(h.bet * num / den);
            res = "blackjack";
          }
        } else if (dealerBJ) res = "lose";
        else if (dv.bust || v.total > dv.total) {
          pay = h.bet * 2;
          res = "win";
        } else if (v.total === dv.total) {
          pay = h.bet;
          res = "push";
        } else res = "lose";
        h.result = res;
        h.payout = pay - h.bet;
        this.chips[id] += pay;
        net += pay - h.bet;
      }
      results[id] = net;
    }
    this.results = { dealer: dv.total, dealerBust: dv.bust, dealerBlackjack: dealerBJ, net: results };
    this.settledAt = Date.now();
    this.seq++;
    return { type: "bj_settle", ...this.results };
  }
  /** Erlaubte Aktionen der aktiven Hand. */
  options(id = this.currentPlayerId) {
    if (this.phase !== "playing" || !this.active || this.active.id !== id) return null;
    const hs = this.hands[id];
    const h = hs[this.active.hand];
    const two = h.cards.length === 2;
    const canAfford = this.chips[id] >= h.bet;
    const pair = two && (h.cards[0].rank === h.cards[1].rank || tenValue(h.cards[0]) && tenValue(h.cards[1]));
    return {
      hit: true,
      stand: true,
      double: two && canAfford && (!h.split || this.opts.das),
      split: pair && canAfford && hs.length < this.opts.maxHands && !(h.splitAces && h.cards[0].rank === "A"),
      surrender: two && hs.length === 1 && !h.split && this.opts.surrender
    };
  }
  act(id, type) {
    const o = this.options(id);
    if (!o) throw new BlackjackError("NOT_YOUR_TURN", "Du bist nicht dran.");
    if (!o[type]) throw new BlackjackError("NOT_ALLOWED", "Das geht hier nicht.");
    const hs = this.hands[id];
    const h = hs[this.active.hand];
    let ev = { type: "bj_action", playerId: id, action: type, hand: this.active.hand };
    if (type === "hit") {
      h.cards.push(this.#draw());
      const v = handValue(h.cards);
      if (v.total >= 21) h.done = true;
      ev.total = v.total;
    } else if (type === "stand") h.done = true;
    else if (type === "double") {
      this.chips[id] -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.#draw());
      h.done = true;
    } else if (type === "split") {
      this.chips[id] -= h.bet;
      const aces = h.cards[0].rank === "A";
      const second = { cards: [h.cards.pop()], bet: h.bet, doubled: false, split: true, splitAces: aces, done: false };
      h.split = true;
      h.splitAces = aces;
      hs.splice(this.active.hand + 1, 0, second);
      h.cards.push(this.#draw());
      if (aces || handValue(h.cards).total === 21) h.done = true;
    } else if (type === "surrender") {
      h.surrendered = true;
      h.done = true;
    }
    this.seq++;
    if (h.done) return { ...ev, next: this.#advance() };
    this.turnStarted = Date.now();
    return ev;
  }
  /** Zeit abgelaufen: stehen bleiben / nicht versichern / aussetzen. */
  timeout() {
    if (this.phase === "playing" && this.active) return this.act(this.active.id, "stand");
    if (this.phase === "insurance") {
      let ev = null;
      for (const id of Object.keys(this.hands)) if (!(id in this.insurance)) ev = this.insure(id, false) ?? ev;
      return ev;
    }
    if (this.phase === "betting") return this.deal();
    return null;
  }
  nextRound() {
    if (this.phase !== "settled") throw new BlackjackError("NOT_NOW", "Die Runde l\xE4uft noch.");
    return this.startBetting();
  }
  /** Wer fehlt noch (für Bots/Anzeige)? */
  waitingOn() {
    if (this.phase === "betting") return this.order.filter((id) => !this.ready.has(id));
    if (this.phase === "insurance") return Object.keys(this.hands).filter((id) => !(id in this.insurance));
    if (this.phase === "playing" && this.active) return [this.active.id];
    return [];
  }
  /** Taler-Tisch: Chips nachkaufen (nur zwischen den Runden). */
  rebuy(id, amount) {
    if (!this.order.includes(id)) throw new BlackjackError("NOT_SEATED", "Du sitzt nicht am Tisch.");
    if (this.phase !== "betting" || this.ready.has(id)) throw new BlackjackError("NOT_NOW", "Nachkaufen geht nur vor dem Setzen.");
    if (this.chips[id] >= this.opts.minBet) throw new BlackjackError("NOT_BROKE", "Du hast noch genug Chips.");
    this.chips[id] += amount;
    this.refills[id] += 1;
    this.seq++;
    return { type: "bj_rebuy", playerId: id, amount };
  }
  addPlayer(id) {
    if (this.order.length >= BJ_MAX_SEATS || this.order.includes(id)) return;
    this.order.push(id);
    this.chips[id] = this.opts.startChips;
    this.refills[id] = 0;
    if (this.phase === "betting") this.seq++;
  }
  removePlayer(id) {
    if (!this.order.includes(id)) return null;
    let ev = null;
    if (this.active?.id === id) {
      for (const h of this.hands[id]) h.done = true;
      ev = this.#advance();
    } else if (this.phase === "insurance" && this.hands[id] && !(id in this.insurance)) ev = this.insure(id, false);
    this.order = this.order.filter((p) => p !== id);
    this.ready?.delete(id);
    delete this.bets[id];
    if (this.phase === "betting" && this.order.length && this.order.every((p) => this.ready.has(p))) ev = this.deal();
    this.seq++;
    return ev;
  }
  replacePlayer(oldId, newId2) {
    const i = this.order.indexOf(oldId);
    if (i < 0) return;
    this.order[i] = newId2;
    for (const obj of [this.chips, this.refills, this.lastBet, this.bets, this.hands, this.insurance]) {
      if (obj && oldId in obj) {
        obj[newId2] = obj[oldId];
        delete obj[oldId];
      }
    }
    if (this.ready?.delete(oldId)) this.ready.add(newId2);
    if (this.active?.id === oldId) this.active.id = newId2;
    if (this.results?.net && oldId in this.results.net) {
      this.results.net[newId2] = this.results.net[oldId];
      delete this.results.net[oldId];
    }
    this.seq++;
  }
  getStateFor(viewer) {
    const show = (h) => ({
      cards: h.cards.map((c) => c.id),
      bet: h.bet,
      doubled: h.doubled,
      split: h.split,
      done: h.done,
      blackjack: Boolean(h.blackjack && !h.split),
      surrendered: Boolean(h.surrendered),
      result: h.result ?? null,
      payout: h.payout ?? null,
      value: handValue(h.cards)
    });
    const dealerShown = this.holeHidden ? this.dealer.slice(0, 1) : this.dealer;
    return {
      kind: "blackjack",
      phase: this.phase,
      round: this.round,
      order: this.order,
      chips: this.chips,
      refills: this.refills,
      bets: this.bets,
      lastBet: this.lastBet,
      ready: [...this.ready ?? []],
      hands: Object.fromEntries(Object.entries(this.hands).map(([id, hs]) => [id, hs.map(show)])),
      insurance: this.insurance,
      dealer: this.holeHidden && this.dealer.length ? [this.dealer[0].id, null] : this.dealer.map((c) => c.id),
      dealerValue: dealerShown.length ? handValue(dealerShown) : null,
      active: this.active,
      currentPlayerId: this.currentPlayerId,
      options: this.options(viewer),
      waiting: this.waitingOn(),
      results: this.results,
      rules: { decks: this.opts.decks, h17: this.opts.h17, bjPays: this.opts.bjPays, surrender: this.opts.surrender, das: this.opts.das, minBet: this.opts.minBet, maxBet: this.opts.maxBet },
      shoeLeft: this.shoe.length,
      shoeSize: this.opts.decks * 52,
      shuffled: this.shuffled,
      turnMs: this.opts.turnMs,
      seq: this.seq
    };
  }
};

// src/rooms/stakes.js
var isWallet = (room) => room.settings.stakes === "wallet";
var acc = (room, id) => room.players.get(id)?.accountId ?? room.walletAccounts?.get(id) ?? null;
function escrowFor(room) {
  const s = stakeOf(room.settings);
  const game = room.settings.game;
  if (!["chess", "poker", "blackjack"].includes(game)) return [];
  const label = game === "chess" ? "Einsatz Schach" : game === "blackjack" ? "Buy-in Blackjack" : room.settings.pokerMode === "tournament" ? "Buy-in Poker-Turnier" : "Buy-in Poker";
  return room.humans.map((p) => ({ playerId: p.id, accountId: p.accountId, amount: s, reason: label }));
}
function prizeShares(n) {
  if (n <= 2) return [1];
  if (n < 6) return [0.65, 0.35];
  return [0.5, 0.3, 0.2];
}
function casinoCashout(room, ids, reason) {
  const g = room.game;
  const chips = g.kind === "poker" ? g.stacks : g.chips;
  const entries = ids.map((id) => ({ playerId: id, accountId: acc(room, id), amount: Math.max(0, Math.round(chips[id] ?? 0)), reason })).filter((e) => e.accountId);
  return { kind: "payout", entries, release: entries.map((e) => e.accountId) };
}
function tournamentChop(room) {
  const g = room.game;
  const pool = room.walletPool ?? 0;
  const live = g.order.filter((id) => g.stacks[id] > 0);
  const total = live.reduce((s, id) => s + g.stacks[id], 0) || 1;
  let given = 0;
  const entries = live.map((id) => {
    const amount = Math.floor(pool * g.stacks[id] / total);
    given += amount;
    return { playerId: id, accountId: acc(room, id), amount, reason: "Turnier abgebrochen \u2013 Aufteilung" };
  });
  if (entries.length && pool - given > 0) entries[0].amount += pool - given;
  return { kind: "payout", entries: entries.filter((e) => e.accountId), release: "all" };
}
function leaveOps(room, playerId) {
  const g = room.game;
  if (!g || !isWallet(room)) return [];
  const accountId = acc(room, playerId);
  if (!accountId) return [];
  const s = stakeOf(room.settings);
  if (g.kind === "poker") return [];
  if (g.kind === "blackjack" && !room.walletClosed) return [casinoCashout(room, [playerId], "Auszahlung Blackjack")];
  if (g.kind === "luegen" && g.phase === "playing" && g.order.includes(playerId)) {
    const others = g.order.filter((id) => id !== playerId && acc(room, id));
    room.walletGameIds = (room.walletGameIds ?? []).filter((id) => id !== playerId);
    return [{ kind: "settle", reason: "L\xFCgen \u2013 Spiel verlassen", entries: [{ playerId, accountId, delta: -s * others.length }, ...others.map((id) => ({ playerId: id, accountId: acc(room, id), delta: s }))] }];
  }
  if (g.kind === "schafkopf" && g.order.includes(playerId) && !["scored"].includes(g.phase)) {
    const others = g.order.filter((id) => id !== playerId && acc(room, id));
    return [{ kind: "settle", reason: "Schafkopf \u2013 Spiel abgebrochen", entries: [{ playerId, accountId, delta: -s * others.length }, ...others.map((id) => ({ playerId: id, accountId: acc(room, id), delta: s }))] }];
  }
  return [];
}
function pokerLeaveOps(room, playerId) {
  const g = room.game;
  if (g?.kind !== "poker" || g.mode !== "cash" || !isWallet(room) || room.walletClosed) return [];
  const accountId = acc(room, playerId);
  if (!accountId || g.lastCashout?.id !== playerId) return [];
  return [{ kind: "payout", entries: [{ playerId, accountId, amount: Math.max(0, g.lastCashout.amount), reason: "Auszahlung Poker" }], release: [accountId] }];
}
function endOps(room) {
  const g = room.game;
  if (!g || !isWallet(room)) return [];
  const s = stakeOf(room.settings);
  const label = GAME_LABELS[g.kind] ?? "Spiel";
  if (g.kind === "luegen") {
    if (g.phase !== "finished" || g.walletDone || !g.loserId) return [];
    g.walletDone = true;
    const ids = (room.walletGameIds ?? g.order).filter((id) => id !== g.loserId && acc(room, id));
    if (!acc(room, g.loserId)) return [];
    return [{ kind: "settle", reason: "L\xFCgen", entries: [{ playerId: g.loserId, accountId: acc(room, g.loserId), delta: -s * ids.length }, ...ids.map((id) => ({ playerId: id, accountId: acc(room, id), delta: s }))] }];
  }
  if (g.kind === "schafkopf") {
    if (g.phase !== "scored" || g.walletRound === g.round || !g.result) return [];
    g.walletRound = g.round;
    const r = g.result;
    if (r.type === "thrown" || r.type === "aborted" || !r.payout) return [];
    const f = s / SK_TARIF_BASE;
    return [{ kind: "settle", reason: "Schafkopf", entries: Object.entries(r.payout).map(([id, cents]) => ({ playerId: id, accountId: acc(room, id), delta: Math.round(cents * f) })) }];
  }
  if (g.kind === "chess") {
    if (g.phase !== "over" || g.walletDone) return [];
    g.walletDone = true;
    const w = g.result?.winner;
    if (w) return [{ kind: "payout", entries: [{ playerId: w, accountId: acc(room, w), amount: s * 2, reason: "Gewinn Schach" }], release: "all" }];
    return [{ kind: "payout", entries: g.order.map((id) => ({ playerId: id, accountId: acc(room, id), amount: s, reason: g.result?.result === "*" ? "Schach abgebrochen \u2013 zur\xFCck" : "Remis \u2013 Einsatz zur\xFCck" })), release: "all" }];
  }
  if (g.kind === "poker" && g.phase === "over" && !room.walletClosed) {
    room.walletClosed = true;
    if (g.mode === "cash") return [casinoCashout(room, g.order.filter((id) => acc(room, id)), "Auszahlung Poker")];
    const pool = room.walletPool ?? 0;
    const places = [g.winnerId, ...[...g.eliminated].reverse()].filter(Boolean);
    const shares = prizeShares(room.walletEntrants ?? places.length);
    let given = 0;
    const entries = shares.map((sh, i) => {
      const id = places[i];
      const amount = Math.floor(pool * sh);
      given += amount;
      return id && { playerId: id, accountId: acc(room, id), amount, reason: `Poker-Turnier \u2013 Platz ${i + 1}` };
    }).filter(Boolean);
    if (entries.length && pool - given > 0) entries[0].amount += pool - given;
    return [{ kind: "payout", entries: entries.filter((e) => e.accountId), release: "all" }];
  }
  return [];
}
function closeOps(room) {
  const g = room.game;
  if (!g || !isWallet(room) || room.walletClosed) return [];
  if (g.kind === "poker") {
    room.walletClosed = true;
    if (g.mode === "cash") return [casinoCashout(room, g.order.filter((id) => acc(room, id) && room.players.has(id)), "Auszahlung Poker")];
    return [tournamentChop(room)];
  }
  if (g.kind === "blackjack") {
    room.walletClosed = true;
    return [casinoCashout(room, g.order.filter((id) => acc(room, id) && room.players.has(id)), "Auszahlung Blackjack")];
  }
  if (g.kind === "chess" && g.phase !== "over" && !g.walletDone) {
    g.walletDone = true;
    return [{ kind: "payout", entries: g.order.map((id) => ({ playerId: id, accountId: acc(room, id), amount: stakeOf(room.settings), reason: "Schach abgebrochen \u2013 zur\xFCck" })), release: "all" }];
  }
  return [];
}

// src/rooms/RoomManager.js
var CASINO = /* @__PURE__ */ new Set(["poker", "blackjack"]);
var POKER_STYLE_ORDER = ["tight", "aggro", "loose", "bluffer"];
var BJ_STYLE_ORDER = ["basic", "cautious", "gambler"];
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
    this.settings = { mode: MODES.SAME, public: true, game: GAMES.LUEGEN, skVariant: "lang", skPass: "ramsch", skExtras: defaultExtras(), chessTime: "5+0", chessColor: "random", pokerMode: "cash", pokerChips: 1e3, pokerBlinds: "5/10", turnSec: 30, bjDecks: 6, bjH17: false, bjPays: "3:2", bjSurrender: true, stakes: "free", stakeLevel: 1 };
    this.walletOps = [];
    this.walletAccounts = /* @__PURE__ */ new Map();
    this.chessWhite = null;
    this.ready = /* @__PURE__ */ new Set();
    this.scores = new ScoreBook();
    this.names = /* @__PURE__ */ new Map();
    this.savedId = null;
    this.gameNames = [];
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
    if (CASINO.has(this.game?.kind)) return p !== "over";
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
        ...p.photo && { photo: p.photoV },
        ...p.bot && { bot: true, difficulty: p.difficulty },
        ...p.autoplay && { autoplay: true },
        ...p.accountId && { account: true },
        ...p.accountId && this.balances?.has(p.accountId) && { balance: this.balances.get(p.accountId) }
      })),
      ready: [...this.ready],
      scores: this.scores.toJSON(80),
      savedId: this.savedId,
      game: this.game ? this.game.getStateFor(viewerId) : null,
      // Spiel pausiert, weil jemand die Verbindung verloren hat (Restzeit in ms)
      pauses: [...this.pauses].map(([playerId, until]) => ({ playerId, remainingMs: Math.max(0, until - Date.now()) })),
      spectating: Boolean(this.game && this.game.phase === "playing" && !this.game.order.includes(viewerId))
    };
  }
};
var RoomManager = class {
  constructor({ wallet = null } = {}) {
    this.rooms = /* @__PURE__ */ new Map();
    this.wallet = wallet;
  }
  /** Buchungsaufträge für den Handler vormerken. */
  #queue(room, ops) {
    if (ops?.length) room.walletOps.push(...ops);
  }
  #unlockAll(room) {
    if (!this.wallet) return;
    for (const p of room.players.values()) if (p.accountId) this.wallet.unlock(p.accountId, room.code);
  }
  #generateCode() {
    for (let attempt = 0; attempt < 1e3; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt2(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError("NO_CODE", "Gerade sind zu viele R\xE4ume offen. Bitte sp\xE4ter erneut versuchen.");
  }
  #addPlayer(room, name, account = null) {
    if (isWallet(room)) {
      if (!account) throw new GameError("NEED_ACCOUNT", "An diesem Tisch wird um Taler gespielt \u2013 bitte erst anmelden.");
      if ([...room.players.values()].some((p) => p.accountId === account.id)) throw new GameError("ALREADY_SEATED", "Du sitzt schon an diesem Tisch.");
      this.wallet?.lock(account.id, room.code);
    }
    const player = {
      id: newId(),
      accountId: account?.id ?? null,
      name: room.uniqueName(sanitizeName(account?.name ?? name)),
      token: newToken(),
      socketId: null,
      connected: false,
      disconnectTimer: null,
      character: room.freeCharacter(room.players.size + 1)
    };
    room.players.set(player.id, player);
    room.names.set(player.id, player.name);
    if (player.accountId) room.walletAccounts.set(player.id, player.accountId);
    room.scores.ensure(player.name);
    if (!room.hostId) room.hostId = player.id;
    return player;
  }
  /** Eigenes Spielerbild setzen (kleines JPEG als Data-URL) oder entfernen. */
  setPhoto(room, playerId, photo) {
    const player = room.players.get(playerId);
    if (!player) throw new GameError("BAD_TARGET", "Ung\xFCltiger Spieler.");
    if (photo == null || photo === "") {
      player.photo = null;
    } else {
      if (typeof photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 4e4) {
        throw new GameError("BAD_PHOTO", "Das Bild ist zu gro\xDF oder ung\xFCltig.");
      }
      player.photo = photo;
    }
    player.photoV = (player.photoV ?? 0) + 1;
  }
  photosOf(room) {
    return Object.fromEntries([...room.players.values()].filter((p) => p.photo).map((p) => [p.id, p.photo]));
  }
  getRoom(code) {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) throw new GameError("ROOM_NOT_FOUND", "Raum nicht gefunden. Code pr\xFCfen?");
    return room;
  }
  /** Neuer Tisch – optional aus einem gespeicherten Tisch (Regeln, Computer-Gegner, Kasse). */
  createRoom(name, restore, settings, account = null) {
    const room = new Room(this.#generateCode());
    this.rooms.set(room.code, room);
    if (restore && typeof restore === "object") room.scores = new ScoreBook(restore.scores);
    let player;
    try {
      player = this.#addPlayer(room, name, account);
    } catch (err) {
      this.rooms.delete(room.code);
      throw err;
    }
    if (settings && typeof settings === "object" && !restore) {
      try {
        this.updateSettings(room, player.id, settings);
      } catch (err) {
        this.rooms.delete(room.code);
        throw err;
      }
    }
    if (restore && typeof restore === "object") {
      try {
        this.updateSettings(room, player.id, { ...restore.settings ?? {} });
      } catch {
      }
      room.savedId = typeof restore.savedId === "string" ? restore.savedId.slice(0, 40) : null;
      for (const b of (Array.isArray(restore.bots) ? restore.bots : []).slice(0, room.maxPlayers - 1)) {
        this.#createBot(room, b?.difficulty, { name: b?.name, character: b?.character });
      }
    }
    return { room, player };
  }
  /** Abgeschlossene Runden in die Kasse eintragen (einmal je Runde). */
  recordIfDone(room) {
    const g = room.game;
    if (!g) return null;
    const nameOf = (id) => room.players.get(id)?.name ?? room.names.get(id) ?? "?";
    if (g.kind === "schafkopf") {
      if (g.phase !== "scored" || g.recordedRound === g.round || !g.result) return null;
      g.recordedRound = g.round;
      const r = g.result;
      if (r.type === "thrown" || r.type === "aborted") return null;
      const deltas = Object.fromEntries(Object.entries(r.payout).map(([id, v]) => [nameOf(id), v]));
      const label = r.type === "ramsch" ? r.durchmarschId ? `Ramsch \u2013 Durchmarsch ${nameOf(r.durchmarschId)}` : `Ramsch \u2013 ${nameOf(r.loserId)} zahlt` : r.type === "stock" ? "Stock (alle weiter)" : `${contractLabel(r.contract)} \xB7 ${nameOf(r.contract.declarerId)} ${r.won ? "gewinnt" : "verliert"}`;
      return room.scores.record({ game: "schafkopf", label, deltas });
    }
    if (g.phase !== PHASES.FINISHED || g.recorded || !g.loserId) return null;
    g.recorded = true;
    const names = room.gameNames.length ? room.gameNames : g.order.map(nameOf);
    const loser = nameOf(g.loserId);
    const reason = { ober: "vier Ober", ober_patt: "Ober-Patt", most_cards: "die meisten Karten" }[g.endReason];
    return room.scores.record({ game: "luegen", label: `L\xFCgen \u2013 ${loser} verliert${reason ? ` (${reason})` : ""}`, deltas: luegenDeltas(names, loser) });
  }
  joinRoom(code, name, account = null) {
    const room = this.getRoom(code);
    if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft bereits.");
    if (room.players.size >= room.maxPlayers) throw new GameError("ROOM_FULL", `Raum ist voll (max. ${room.maxPlayers}).`);
    const player = this.#addPlayer(room, name, account);
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
    const walletLeave = isWallet(room) && room.game ? leaveOps(room, playerId) : [];
    this.#queue(room, walletLeave);
    if (player.accountId) this.wallet?.unlock(player.accountId, room.code);
    if (isWallet(room) && room.game?.kind === "schafkopf" && room.game.order.includes(playerId) && room.game.phase !== "scored") {
      room.game = null;
      event = { type: "sk_aborted", playerId, name: player.name };
    } else if (isWallet(room) && room.game?.kind === "schafkopf") {
      room.game = null;
    } else if (room.game?.kind === "schafkopf" && room.game.order.includes(playerId) && room.humans.length > 0) {
      const bot = this.#createBot(room, "normal");
      room.game.replacePlayer(playerId, bot.id);
      room.personas[bot.id] = makePersona(bot.base, bot.difficulty);
      event = { type: "replaced", playerId, botId: bot.id, name: player.name, botName: bot.name };
    } else if (room.game?.kind === "chess") event = room.game.abandon(playerId);
    else if (CASINO.has(room.game?.kind)) {
      event = room.game.removePlayer(playerId);
      this.#queue(room, pokerLeaveOps(room, playerId));
    } else if (room.game && room.game.phase === PHASES.PLAYING && room.game.kind !== "schafkopf") event = room.game.removePlayer(playerId);
    if (room.hostId === playerId) {
      const humans = room.humans;
      const nextHost = humans.find((p) => p.connected) ?? humans[0];
      room.hostId = nextHost?.id ?? null;
    }
    if (room.humans.length === 0) {
      this.#queue(room, closeOps(room));
      this.#unlockAll(room);
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
    if (room.settings.game === GAMES.CHESS) throw new GameError("NO_BOTS", "Gegen den Computer spielst du Schach \xFCber \u201EGegen Computer\u201C.");
    if (isWallet(room)) throw new GameError("NO_BOTS", "Um Taler spielen nur echte Mitspieler \u2013 keine Computer.");
    if (room.players.size >= room.maxPlayers) throw new GameError("ROOM_FULL", `Raum ist voll (max. ${room.maxPlayers}).`);
    return this.#createBot(room, difficulty);
  }
  #createBot(room, difficulty, preset = {}) {
    if (!DIFFICULTY[difficulty]) difficulty = "normal";
    const usedChars = new Set([...room.players.values()].map((p) => p.character));
    const free = BOT_ROSTER.filter((b) => !usedChars.has(b.character));
    const wanted = BOT_ROSTER.find((b) => b.character === preset.character && !usedChars.has(b.character));
    const pick = wanted ?? (free.length ? free : BOT_ROSTER)[randomInt2((free.length ? free : BOT_ROSTER).length)];
    let presetName = null;
    try {
      presetName = preset.name ? sanitizeName(preset.name) : null;
    } catch {
      presetName = null;
    }
    const bot = {
      id: newId(),
      name: room.uniqueName(presetName ?? pick.name),
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
    room.names.set(bot.id, bot.name);
    room.scores.ensure(bot.name);
    return bot;
  }
  updateSettings(room, playerId, settings) {
    this.#assertHost(room, playerId);
    if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Nur in der Lobby \xE4nderbar.");
    if (settings?.public !== void 0) room.settings.public = Boolean(settings.public);
    if (settings?.game !== void 0) {
      if (!Object.values(GAMES).includes(settings.game)) throw new GameError("BAD_GAME", "Unbekanntes Spiel.");
      if (room.players.size > GAME_MAX_PLAYERS[settings.game])
        throw new GameError("TOO_MANY", `Zu viele Spieler am Tisch \u2013 erst ${room.players.size - GAME_MAX_PLAYERS[settings.game]} entfernen.`);
      if (settings.game === GAMES.CHESS && [...room.players.values()].some((p) => p.bot)) throw new GameError("NO_BOTS", "Beim Schach erst die Computer-Gegner entfernen.");
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
    if (settings?.chessTime !== void 0) {
      try {
        parseTimeControl(settings.chessTime);
      } catch {
        throw new GameError("BAD_TIME", "Ung\xFCltige Zeitkontrolle.");
      }
      room.settings.chessTime = String(settings.chessTime);
    }
    if (settings?.chessColor !== void 0) {
      if (!["white", "black", "random"].includes(settings.chessColor)) throw new GameError("BAD_COLOR", "Unbekannte Farbe.");
      room.settings.chessColor = settings.chessColor;
    }
    if (settings?.pokerMode !== void 0) {
      if (!["cash", "tournament"].includes(settings.pokerMode)) throw new GameError("BAD_MODE", "Unbekannte Spielform.");
      room.settings.pokerMode = settings.pokerMode;
    }
    if (settings?.pokerChips !== void 0) {
      if (!POKER_CHIPS.includes(Number(settings.pokerChips))) throw new GameError("BAD_CHIPS", "Unbekannte Chip-Menge.");
      room.settings.pokerChips = Number(settings.pokerChips);
    }
    if (settings?.pokerBlinds !== void 0) {
      if (!POKER_BLINDS.includes(settings.pokerBlinds)) throw new GameError("BAD_BLINDS", "Unbekannte Blinds.");
      room.settings.pokerBlinds = settings.pokerBlinds;
    }
    if (settings?.turnSec !== void 0) {
      if (!TURN_SECONDS.includes(Number(settings.turnSec))) throw new GameError("BAD_TIME", "Unbekannte Zugzeit.");
      room.settings.turnSec = Number(settings.turnSec);
    }
    if (settings?.bjDecks !== void 0) {
      if (!BJ_DECKS.includes(Number(settings.bjDecks))) throw new GameError("BAD_DECKS", "Unbekannte Deck-Zahl.");
      room.settings.bjDecks = Number(settings.bjDecks);
    }
    if (settings?.bjH17 !== void 0) room.settings.bjH17 = Boolean(settings.bjH17);
    if (settings?.bjSurrender !== void 0) room.settings.bjSurrender = Boolean(settings.bjSurrender);
    if (settings?.bjPays !== void 0) {
      if (!["3:2", "6:5"].includes(settings.bjPays)) throw new GameError("BAD_PAYS", "Unbekannte Auszahlung.");
      room.settings.bjPays = settings.bjPays;
    }
    if (settings?.mode !== void 0) {
      if (!Object.values(MODES).includes(settings.mode)) throw new GameError("BAD_MODE", "Unbekannter Modus.");
      room.settings.mode = settings.mode;
    }
    if (settings?.stakeLevel !== void 0) {
      const lvl = Number(settings.stakeLevel);
      if (!Number.isInteger(lvl) || lvl < 0 || lvl > 3) throw new GameError("BAD_STAKE", "Unbekannter Einsatz.");
      room.settings.stakeLevel = lvl;
    }
    if (settings?.stakes !== void 0 && settings.stakes !== room.settings.stakes) {
      if (!["free", "wallet"].includes(settings.stakes)) throw new GameError("BAD_STAKE", "Unbekannte Spielart.");
      if (settings.stakes === "wallet") {
        if (!this.wallet) throw new GameError("NO_WALLET", "Taler-Tische gibt es hier nicht.");
        const humans = room.humans;
        if ([...room.players.values()].some((p) => p.bot)) throw new GameError("NO_BOTS", "Erst die Computer-Gegner entfernen \u2013 um Taler spielen nur echte Mitspieler.");
        const noAcc = humans.filter((p) => !p.accountId);
        if (noAcc.length) throw new GameError("NEED_ACCOUNT", `${noAcc.map((p) => p.name).join(", ")} ${noAcc.length === 1 ? "hat" : "haben"} noch kein Konto.`);
        const locked = [];
        try {
          for (const p of humans) {
            this.wallet.lock(p.accountId, room.code);
            locked.push(p.accountId);
          }
        } catch (err) {
          locked.forEach((a) => this.wallet.unlock(a, room.code));
          const who = humans.find((p) => this.wallet.lockOf(p.accountId) && this.wallet.lockOf(p.accountId) !== room.code);
          throw new GameError("BUSY_TABLE", `${who?.name ?? "Jemand"} sitzt schon an einem anderen Taler-Tisch.`);
        }
      } else this.#unlockAll(room);
      room.settings.stakes = settings.stakes;
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
      game: r.settings.game,
      ...r.settings.game === GAMES.CHESS && { chessTime: r.settings.chessTime, chessColor: r.settings.chessColor },
      ...r.settings.game === GAMES.POKER && { pokerMode: r.settings.pokerMode, pokerBlinds: r.settings.pokerBlinds },
      ...isWallet(r) && { stake: stakeOf(r.settings) }
    })).slice(0, 50);
  }
  /** Taler-Tisch: Bedingungen vor dem Start (ohne Geld – das prüft der Handler). */
  assertWalletStart(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.active) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft bereits.");
    if ([...room.players.values()].some((p) => p.bot)) throw new GameError("NO_BOTS", "Um Taler spielen nur echte Mitspieler.");
    const humans = room.humans;
    const need = { schafkopf: 4, chess: 2, poker: 2, luegen: MIN_PLAYERS, blackjack: 1 }[room.settings.game] ?? 2;
    if (room.settings.game === GAMES.SCHAFKOPF && humans.length !== 4) throw new GameError("PLAYER_COUNT", "Um Taler braucht Schafkopf 4 echte Spieler.");
    if (humans.length < need) throw new GameError("PLAYER_COUNT", `Mindestens ${need} Spieler n\xF6tig.`);
    const noAcc = humans.filter((p) => !p.accountId);
    if (noAcc.length) throw new GameError("NEED_ACCOUNT", `${noAcc.map((p) => p.name).join(", ")} ${noAcc.length === 1 ? "hat" : "haben"} kein Konto.`);
    return humans;
  }
  escrowFor(room) {
    return isWallet(room) ? escrowFor(room) : [];
  }
  /** Buchungsaufträge abholen (Handler). */
  takeWalletOps(room) {
    this.#queue(room, endOps(room));
    const ops = room.walletOps;
    room.walletOps = [];
    return ops;
  }
  startGame(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.active) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft bereits.");
    if (isWallet(room)) this.assertWalletStart(room, playerId);
    room.pauses.clear();
    room.ready.clear();
    room.walletClosed = false;
    room.walletGameIds = room.humans.map((p) => p.id);
    room.walletEntrants = room.humans.length;
    room.walletPool = room.settings.game === GAMES.POKER && room.settings.pokerMode === "tournament" ? stakeOf(room.settings) * room.humans.length : 0;
    if (room.settings.game === GAMES.CHESS) return this.#startChess(room, false);
    if (CASINO.has(room.settings.game)) return this.#startCasino(room);
    if (room.settings.game === GAMES.SCHAFKOPF) {
      while (!isWallet(room) && room.players.size < GAME_MAX_PLAYERS.schafkopf) this.#createBot(room, "normal");
      room.game = new SchafkopfGame([...room.players.values()], { variant: room.settings.skVariant, pass: room.settings.skPass, extras: room.settings.skExtras });
      room.botKey = null;
      room.personas = Object.fromEntries([...room.players.values()].filter((p) => p.bot).map((p) => [p.id, makePersona(p.base, p.difficulty)]));
      return { type: "sk_deal", dealerId: room.game.dealerId, round: 1 };
    }
    if (room.players.size < MIN_PLAYERS) throw new GameError("PLAYER_COUNT", `Mindestens ${MIN_PLAYERS} Spieler n\xF6tig.`);
    room.game = new LuegenGame([...room.players.values()], { mode: room.settings.mode });
    room.gameNames = [...room.players.values()].map((p) => p.name);
    room.botMemory = { claimed: {} };
    room.botKey = null;
    room.personas = Object.fromEntries(
      [...room.players.values()].filter((p) => p.bot).map((p) => [p.id, makePersona(p.base, p.difficulty)])
    );
    const g = room.game;
    return { type: "started", startPlayerId: g.currentPlayerId, quads: g.initialQuads, oberLoserId: g.endReason === "ober" ? g.loserId : null, ended: g.phase !== "playing" };
  }
  #startCasino(room) {
    const st = room.settings;
    const poker = st.game === GAMES.POKER;
    const wallet = isWallet(room);
    if (poker && !wallet) while (room.players.size < 2) this.#createBot(room, "normal");
    const seats = [...room.players.values()];
    const bots = seats.filter((p) => p.bot);
    room.personas = Object.fromEntries(
      bots.map((p, i) => [
        p.id,
        poker ? { style: POKER_STYLE_ORDER[i % POKER_STYLE_ORDER.length], level: { easy: 0, normal: 1, hard: 2 }[p.difficulty] ?? 1 } : { style: BJ_STYLE_ORDER[i % BJ_STYLE_ORDER.length], betUnit: [10, 25, 50][i % 3] }
      ])
    );
    room.botKey = null;
    const turnMs = st.turnSec ? st.turnSec * 1e3 : 0;
    if (poker) {
      let [sb, bb] = st.pokerBlinds.split("/").map(Number);
      let startChips = st.pokerChips;
      if (wallet && st.pokerMode === "cash") {
        startChips = stakeOf(st);
        ({ sb, bb } = walletBlinds(startChips));
      }
      room.game = new PokerGame(seats, { startChips, sb, bb, mode: st.pokerMode, turnMs, rebuy: !wallet });
      return { type: "poker_start" };
    }
    room.game = new BlackjackGame(seats, { decks: st.bjDecks, h17: st.bjH17, bjPays: st.bjPays, surrender: st.bjSurrender, turnMs, ...wallet && { startChips: stakeOf(st), refill: false } });
    return { type: "bj_start" };
  }
  #startChess(room, swap) {
    const humans = room.humans;
    if (humans.length !== 2) throw new GameError("PLAYER_COUNT", "Schach spielt man zu zweit \u2013 warte auf deinen Gegner.");
    const host = humans.find((p) => p.id === room.hostId) ?? humans[0];
    const guest = humans.find((p) => p !== host);
    let white;
    if (swap && room.chessWhite) white = room.chessWhite === host.id ? guest : host;
    else if (room.settings.chessColor === "white") white = host;
    else if (room.settings.chessColor === "black") white = guest;
    else white = randomInt2(2) ? host : guest;
    const black = white === host ? guest : host;
    room.chessWhite = white.id;
    room.game = new ChessGame({ white: white.id, black: black.id, time: room.settings.chessTime });
    return { type: "chess_start", white: white.id, black: black.id, time: room.settings.chessTime };
  }
  /** Schach: Revanche – sobald beide wollen, neue Partie mit getauschten Farben. */
  chessRematch(room, playerId) {
    const g = room.game;
    if (g?.kind !== "chess" || g.phase !== "over") throw new GameError("NOT_OVER", "Die Partie l\xE4uft noch.");
    if (!g.order.includes(playerId)) throw new GameError("NOT_PLAYER", "Du spielst nicht mit.");
    room.ready.add(playerId);
    const waiting = room.humans.filter((p) => !room.ready.has(p.id));
    if (waiting.length) return { type: "chess_rematch_offer", playerId };
    room.ready.clear();
    return this.#startChess(room, true);
  }
  backToLobby(room, playerId) {
    this.#assertHost(room, playerId);
    if (room.active && !CASINO.has(room.game?.kind)) throw new GameError("ALREADY_STARTED", "Das Spiel l\xE4uft noch.");
    this.#queue(room, closeOps(room));
    clearTimeout(room.casinoTimer);
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
  if (can("sie")) return can("sie");
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
function choosePlayCard(view, me, persona = {}, rand = Math.random, out = null) {
  const R = (card2, reason) => {
    if (out) out.reason = reason;
    return card2;
  };
  const legal = view.hand.filter((c2) => view.legalCardIds.includes(c2.id));
  if (legal.length <= 1) return R(legal[0], "Die einzige Karte, die du legen darfst.");
  if (rand() > (persona.sharp ?? 0.75) + 0.25) return R(legal[Math.floor(rand() * legal.length)], "Aus dem Bauch heraus.");
  const c = view.contract;
  const m = meta(c);
  const rel = relationFn(view, me);
  const trick = view.trick;
  const power = (x) => isTrump(x, c) ? 100 + trumpPower(x, c) : plainPower(x, c);
  const byPower = (a, b) => power(a) - power(b);
  const played = new Set(view.played ?? []);
  if (m.bettel) {
    const declarer = me === c.declarerId;
    if (!trick.length) return R([...legal].sort(byPower)[0], declarer ? "Im Bettel klein ausspielen \u2013 dann sticht sicher ein anderer." : "Klein ausspielen und hoffen, dass der Spieler dr\xFCber muss.");
    const best2 = currentWinner(trick, c);
    const led2 = followSuit(trick[0].card, c);
    const under = legal.filter((x) => !beats(x, best2.card, led2, c)).sort(byPower);
    if (declarer) return under.length ? R(under.at(-1), "Drunter bleiben \u2013 und dabei die h\xF6chste Karte loswerden, die noch nicht sticht.") : R([...legal].sort(byPower)[0], "Du musst leider stechen \u2013 nimm die kleinste Karte.");
    if (best2.playerId === c.declarerId) return under.length ? R(under.at(-1), "Der Spieler liegt vorn \u2013 nicht \xFCberstechen, dann hat er den Stich!") : R([...legal].sort(byPower)[0], "Kleinste Karte.");
    const declarerStillToPlay = !trick.some((t) => t.playerId === c.declarerId);
    return declarerStillToPlay ? R([...legal].sort(byPower)[0], "Klein bleiben, damit der Spieler dr\xFCber muss.") : R([...legal].sort(byPower).at(-1), "Der Spieler hat schon gelegt \u2013 hohe Karte loswerden.");
  }
  if (c.type === "ramsch") {
    if (!trick.length) {
      const plain = legal.filter((x) => !isTrump(x, c)).sort((a, b) => pts(a) - pts(b) || byPower(a, b));
      return R(plain[0] ?? [...legal].sort(byPower)[0], "Im Ramsch kleine Fehlkarten ausspielen \u2013 keine Augen verschenken.");
    }
    const best2 = currentWinner(trick, c);
    const led2 = followSuit(trick[0].card, c);
    const losers2 = legal.filter((x) => !beats(x, best2.card, led2, c));
    if (losers2.length) return R(losers2.sort((a, b) => pts(b) - pts(a) || byPower(b, a))[0], "Nicht stechen \u2013 und dabei m\xF6glichst viele Augen an den anderen loswerden.");
    const winners2 = legal.filter((x) => beats(x, best2.card, led2, c));
    return trick.length === 3 ? R(winners2.sort((a, b) => pts(b) - pts(a))[0], "Den Stich musst du nehmen \u2013 dann wenigstens mit einer hohen Karte, die sp\xE4ter gef\xE4hrlich w\xE4re.") : R(winners2.sort(byPower).at(-1), "Du musst stechen \u2013 nimm die h\xF6chste, damit sie weg ist.");
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
        return higherOut && trumps.length > 1 ? R(trumps[0], "Als Spieler Trumpf spielen, um den Gegnern die Tr\xFCmpfe herauszuziehen \u2013 mit einem kleinen, weil noch h\xF6here drau\xDFen sind.") : R(highest, "Dein h\xF6chster Trumpf ist gerade der h\xF6chste im Spiel \u2013 damit holst du sicher den Stich und ziehst Tr\xFCmpfe.");
      }
      if (aces.length) return R(aces[0], "Die Tr\xFCmpfe sind raus \u2013 jetzt die Sau holen, solange sie noch durchgeht.");
    } else {
      if (c.calledSuit && !view.searched) {
        const search = legal.filter((x) => !isTrump(x, c) && x.suit === c.calledSuit).sort(byPower);
        if (search.length) return R(search[0], "Als Gegenspieler die gerufene Sau suchen \u2013 dann muss sie kommen und du wei\xDFt, wer Partner ist.");
      }
      if (aces.length) return R(aces[0], "Eine Sau ausspielen holt sicher 11 Augen, solange die Farbe noch nicht gestochen wird.");
    }
    const plain = legal.filter((x) => !isTrump(x, c)).sort((a, b) => pts(a) - pts(b) || byPower(a, b));
    return R(plain[0] ?? trumps[0] ?? legal[0], "Eine kleine Karte ohne Augen ausspielen \u2013 nichts verschenken.");
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
    return R([...legal].sort((a, b) => smearScore(b) - smearScore(a))[0], "Dein Partner hat den Stich sicher \u2013 schmier ihm viele Augen (Sau oder Zehner).");
  }
  if (winners.length && r !== "friend") {
    const worth = trickPts >= 4 || last || trick.some((t) => t.card.rank === "A" || t.card.rank === "10");
    if (worth) {
      if (last) return R(winners[0], `Als Letzter mit der kleinsten Karte stechen, die reicht \u2013 ${trickPts} Augen liegen drin.`);
      const safe = winners.filter((x) => isTrump(x, c) && trumpPower(x, c) >= 40);
      return trickPts >= 10 && safe.length ? R(safe[0], `Viele Augen im Stich (${trickPts}) \u2013 mit einem Ober sicher stechen, damit keiner mehr dr\xFCber kommt.`) : R(winners[0], `Den Stich mitnehmen (${trickPts} Augen) \u2013 mit der kleinsten Karte, die reicht.`);
    }
  }
  const pool = losers.length ? losers : legal;
  return R([...pool].sort((a, b) => pts(a) + power(a) * 0.02 - (pts(b) + power(b) * 0.02))[0], r === "friend" ? "Der Stich geh\xF6rt vermutlich deiner Partei \u2013 eine kleine Karte reicht." : "Der Stich lohnt sich nicht oder ist nicht zu holen \u2013 billig abwerfen.");
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
  const card2 = choosePlayCard(view, me, persona);
  return card2 ? { type: "play", cardId: card2.id } : null;
}

// ../shared/poker/bot.js
var POKER_STYLES = {
  tight: { label: "vorsichtig", vpip: -1.5, aggr: 0.35, bluff: 0.03 },
  loose: { label: "locker", vpip: 1.5, aggr: 0.35, bluff: 0.06 },
  aggro: { label: "aggressiv", vpip: 0.5, aggr: 0.75, bluff: 0.12 },
  bluffer: { label: "Bluffer", vpip: 1, aggr: 0.6, bluff: 0.25 }
};
function chen(c1, c2) {
  const v = (r) => ({ 14: 10, 13: 8, 12: 7, 11: 6 })[r] ?? r / 2;
  const a = rankValue(c1[0]);
  const b = rankValue(c2[0]);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  let s = v(hi);
  if (a === b) s = Math.max(5, s * 2);
  if (c1[1] === c2[1]) s += 2;
  const gap = hi - lo - 1;
  if (a !== b) {
    s -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 12) s += 1;
  }
  return Math.ceil(s);
}
function equity(hole, board, opponents, iters = 300, rand = Math.random) {
  const used = /* @__PURE__ */ new Set([...hole, ...board]);
  const rest = newDeck().filter((c) => !used.has(c.id));
  const me = hole.map(card);
  const b0 = board.map(card);
  let win = 0;
  for (let it = 0; it < iters; it++) {
    const need = 5 - b0.length + opponents * 2;
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rand() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const bd = [...b0, ...rest.slice(0, 5 - b0.length)];
    const mine = evaluate([...me, ...bd]).score;
    let best = 0;
    let ties = 0;
    let off = 5 - b0.length;
    for (let o = 0; o < opponents; o++) {
      const sc = evaluate([rest[off], rest[off + 1], ...bd]).score;
      off += 2;
      if (sc > best) {
        best = sc;
        ties = 0;
      }
      if (sc === mine) ties++;
    }
    if (mine > best) win += 1;
    else if (mine === best) win += 1 / (ties + 1);
  }
  return win / iters;
}
function pokerDecide(view, me, persona = {}, rand = Math.random) {
  const o = view.options;
  if (!o) return null;
  const st = POKER_STYLES[persona.style] ?? POKER_STYLES.tight;
  const level = persona.level ?? 1;
  const hole = view.holes[me];
  const active = view.inHand.filter((id) => !view.folded.includes(id));
  const opp = Math.max(1, active.length - 1);
  const pot = view.pot;
  const toCall = o.toCall;
  const odds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const noise = (1 - level * 0.35) * 0.12 * (rand() * 2 - 1);
  const raiseTo = (frac) => {
    const target = view.currentBet + Math.max(o.minTo - view.currentBet, Math.round((pot + toCall) * frac));
    return Math.max(o.minTo, Math.min(o.maxTo, Math.round(target / view.bb) * view.bb || target));
  };
  const stackBB = view.stacks[me] / view.bb;
  if (view.street === "preflop") {
    const c = chen(hole[0], hole[1]) + st.vpip + noise * 10;
    const idx = view.order.indexOf(me);
    const btn = view.order.indexOf(view.button);
    const late = (idx - btn + view.order.length) % view.order.length <= 1;
    const threshold = (opp >= 4 ? 8 : opp >= 2 ? 6.5 : 5) - (late ? 1 : 0);
    const facingRaise = view.currentBet > view.bb;
    if (c >= 12 || c >= 10 && rand() < st.aggr) {
      if (o.canRaise) return stackBB < 15 && c >= 11 ? { type: "allin" } : { type: "raise", to: raiseTo(facingRaise ? 1 : 0.8) };
      return o.canCall ? { type: "call" } : { type: "check" };
    }
    if (c >= threshold + (facingRaise ? 2 : 0)) {
      if (!facingRaise && o.canRaise && rand() < st.aggr * 0.6) return { type: "raise", to: raiseTo(0.7) };
      if (o.canCheck) return { type: "check" };
      if (toCall <= view.stacks[me] * (facingRaise ? 0.15 : 0.3)) return { type: "call" };
      return { type: "fold" };
    }
    if (o.canCheck) return { type: "check" };
    if (o.canRaise && rand() < st.bluff * 0.5 && !facingRaise) return { type: "raise", to: raiseTo(0.7) };
    return { type: "fold" };
  }
  const iters = level === 0 ? 120 : level === 1 ? 250 : 450;
  const eq = Math.max(0, Math.min(1, equity(hole, view.board, opp, iters, rand) + noise));
  const strong = eq > 0.72 - st.aggr * 0.1;
  if (o.canCheck) {
    if (strong && o.canRaise) return { type: "raise", to: raiseTo(eq > 0.85 ? 0.9 : 0.6) };
    if (eq > 0.55 && o.canRaise && rand() < st.aggr) return { type: "raise", to: raiseTo(0.5) };
    if (o.canRaise && rand() < st.bluff && view.street !== "river") return { type: "raise", to: raiseTo(0.5) };
    return { type: "check" };
  }
  if (strong && o.canRaise && rand() < 0.4 + st.aggr * 0.5) return eq > 0.9 && rand() < 0.3 ? { type: "allin" } : { type: "raise", to: raiseTo(0.8) };
  const margin = level === 2 ? 0.02 : 0.05;
  if (eq >= odds + margin) return { type: "call" };
  if (o.canRaise && rand() < st.bluff * 0.4 && view.street === "turn") return { type: "raise", to: raiseTo(0.7) };
  return { type: "fold" };
}

// ../shared/blackjack/strategy.js
var up = (r) => r === "A" ? 11 : "TJQK".includes(r) ? 10 : Number(r);
function basicStrategy(cardIds, dealerUp, options = {}, rules = {}) {
  const cards = cardIds.map((id) => ({ rank: id[0], suit: id[1] }));
  const d = up(dealerUp[0]);
  const v = handValue(cards);
  const two = cards.length === 2;
  const h17 = rules.h17;
  const want = (...prefs) => prefs.find((p) => p === "hit" || p === "stand" || options[p]) ?? "hit";
  if (two && options.surrender && !v.soft) {
    if (v.total === 16 && cards[0].rank !== "8" && d >= 9) return "surrender";
    if (v.total === 15 && d === 10) return "surrender";
    if (h17 && v.total === 15 && d === 11) return "surrender";
  }
  if (two && options.split && up(cards[0].rank) === up(cards[1].rank)) {
    const r = up(cards[0].rank);
    const das = rules.das !== false;
    const split = r === 11 || r === 8 || r === 9 && ![7, 10, 11].includes(d) || r === 7 && d <= 7 || r === 6 && (d <= 6 && (d >= 3 || das)) || r === 4 && das && (d === 5 || d === 6) || (r === 2 || r === 3) && (d <= 7 && (d >= 4 || das));
    if (split) return "split";
  }
  if (v.soft && v.total <= 21) {
    const t2 = v.total;
    if (t2 >= 20) return "stand";
    if (t2 === 19) return d === 6 && two && h17 ? want("double", "stand") : "stand";
    if (t2 === 18) {
      if (d >= 3 && d <= 6) return want("double", "stand");
      if (d === 2 && h17) return want("double", "stand");
      if (d <= 8) return "stand";
      return "hit";
    }
    if (t2 === 17) return d >= 3 && d <= 6 ? want("double", "hit") : "hit";
    if (t2 === 15 || t2 === 16) return d >= 4 && d <= 6 ? want("double", "hit") : "hit";
    if (t2 === 13 || t2 === 14) return d >= 5 && d <= 6 ? want("double", "hit") : "hit";
    return "hit";
  }
  const t = v.total;
  if (t >= 17) return "stand";
  if (t >= 13) return d <= 6 ? "stand" : "hit";
  if (t === 12) return d >= 4 && d <= 6 ? "stand" : "hit";
  if (t === 11) return d === 11 && !h17 ? "hit" : want("double", "hit");
  if (t === 10) return d <= 9 ? want("double", "hit") : "hit";
  if (t === 9) return d >= 3 && d <= 6 ? want("double", "hit") : "hit";
  return "hit";
}
function bjDecide(view, me, persona = {}, rand = Math.random) {
  if (view.phase === "betting" && !view.ready.includes(me)) {
    const unit = persona.betUnit ?? 25;
    const chips = view.chips[me];
    const mult = persona.style === "gambler" ? [1, 2, 4, 8][Math.floor(rand() * 4)] : persona.style === "cautious" ? 1 : [1, 1, 2, 3][Math.floor(rand() * 4)];
    const amount = Math.max(view.rules.minBet, Math.min(chips, view.rules.maxBet, Math.round(unit * mult / 5) * 5));
    return { type: "bet", amount };
  }
  if (view.phase === "insurance" && view.hands[me] && !(me in view.insurance)) {
    return { type: "insure", yes: persona.style === "cautious" && rand() < 0.5 };
  }
  if (view.phase === "playing" && view.currentPlayerId === me && view.options) {
    const h = view.hands[me][view.active.hand];
    let a = basicStrategy(h.cards, view.dealer[0], view.options, view.rules);
    if (persona.style === "cautious" && a === "hit" && h.value.total >= 12 && !h.value.soft) a = "stand";
    if (persona.style === "gambler" && a === "hit" && view.options.double && h.value.total >= 8 && rand() < 0.3) a = "double";
    return { type: "act", action: a };
  }
  return null;
}

// src/socket/handlers.js
var CHESS_ABANDON_MS = 60 * 1e3;
var INVITE_COOLDOWN_MS = 15 * 1e3;
var GRACE_MS = {
  [PHASES.LOBBY]: 60 * 1e3,
  [PHASES.PLAYING]: 3 * 60 * 1e3,
  [PHASES.FINISHED]: 60 * 1e3
};
var DEFAULT_PAUSE_MS = 10 * 1e3;
var RATE_LIMIT = { windowMs: 2e3, max: 30 };
var BOT_TIMING = { min: 900, max: 1700, pending: [1400, 2200], first: [1600, 2300], afterReveal: 3800, afterTrick: 1500 };
function registerSocketHandlers(io, rooms, { pauseMs = DEFAULT_PAUSE_MS, botTiming = BOT_TIMING, chessAbandonMs = CHESS_ABANDON_MS, wallet = null, walletPauseMs = 45 * 1e3 } = {}) {
  const presence = /* @__PURE__ */ new Map();
  const socketAccount = /* @__PURE__ */ new Map();
  const accountSockets = /* @__PURE__ */ new Map();
  function bindAccount(socket, accountId) {
    unbindAccount(socket);
    socketAccount.set(socket.id, accountId);
    if (!accountSockets.has(accountId)) accountSockets.set(accountId, /* @__PURE__ */ new Set());
    accountSockets.get(accountId).add(socket.id);
  }
  function unbindAccount(socket) {
    const prev = socketAccount.get(socket.id);
    if (!prev) return;
    socketAccount.delete(socket.id);
    accountSockets.get(prev)?.delete(socket.id);
    if (!accountSockets.get(prev)?.size) accountSockets.delete(prev);
  }
  async function accountOf(socket) {
    const id = socketAccount.get(socket.id);
    return id && wallet ? wallet.account(id) : null;
  }
  if (wallet) {
    wallet.onChange((balances) => {
      const touched = /* @__PURE__ */ new Set();
      for (const [accountId, balance] of Object.entries(balances)) {
        for (const sid of accountSockets.get(accountId) ?? []) io.to(sid).emit(EVT.ACC_BALANCE, { balance });
        const code = wallet.lockOf(accountId);
        const room = code && rooms.rooms.get(code);
        if (room) {
          (room.balances ??= /* @__PURE__ */ new Map()).set(accountId, balance);
          touched.add(room);
        }
      }
      for (const room of touched) sendState(room);
    });
  }
  async function refreshBalances(room) {
    if (!wallet || !isWallet(room)) return;
    room.balances ??= /* @__PURE__ */ new Map();
    for (const p of room.players.values()) if (p.accountId) room.balances.set(p.accountId, await wallet.balanceOf(p.accountId));
  }
  function flushWallet(room) {
    if (!wallet) return;
    const ops = rooms.takeWalletOps(room);
    if (!ops.length) return;
    room.walletChain = (room.walletChain ?? Promise.resolve()).then(async () => {
      for (const op of ops) {
        try {
          const deltas = {};
          if (op.kind === "payout") {
            await wallet.payout(room.code, op.entries.map((e) => ({ ...e, game: room.settings.game })), op.release);
            for (const e of op.entries) if (e.amount) deltas[e.playerId] = (deltas[e.playerId] ?? 0) + e.amount;
          } else {
            const applied = await wallet.settle(op.entries, op.reason, room.settings.game);
            for (const e of op.entries) if (applied[e.accountId] != null) deltas[e.playerId] = applied[e.accountId];
          }
          if (Object.keys(deltas).length) emitEvent(room, { type: "wallet", kind: op.kind, reason: op.reason ?? op.entries[0]?.reason, deltas });
        } catch (err) {
          console.error("[wallet]", err);
        }
      }
      if (rooms.rooms.has(room.code)) sendState(room);
    });
    return room.walletChain;
  }
  function sendState(room) {
    for (const player of room.players.values()) {
      if (player.socketId) io.to(player.socketId).emit(EVT.ROOM_STATE, room.stateFor(player.id));
    }
  }
  function scheduleChessTimer(room) {
    clearTimeout(room.chessTimer);
    const game = room.game;
    if (game?.kind !== "chess" || !rooms.rooms.has(room.code)) return;
    const wait = game.nextDeadline();
    if (wait == null) return;
    room.chessTimer = setTimeout(() => {
      if (room.game !== game) return;
      const ev = game.checkTime();
      if (ev) {
        emitEvent(room, ev);
        broadcastState(room);
      } else scheduleChessTimer(room);
    }, wait + 25);
    room.chessTimer.unref?.();
  }
  function casinoAction(room, fn) {
    const g = room.game;
    if (g?.kind !== "poker" && g?.kind !== "blackjack") throw new GameError("NOT_PLAYING", "Hier l\xE4uft kein Casino-Spiel.");
    let event;
    try {
      event = fn(g);
    } catch (err) {
      if (err instanceof PokerError || err instanceof BlackjackError) throw new GameError(err.code, err.message);
      throw err;
    }
    const flat = [];
    const walk = (e) => {
      if (!e || typeof e !== "object") return;
      const { after, next, settle, over, ...rest } = e;
      if (rest.type) flat.push(rest);
      [after, next, settle, over].forEach(walk);
    };
    walk(event);
    flat.forEach((e) => emitEvent(room, e));
    broadcastState(room);
  }
  function scheduleCasino(room) {
    const g = room.game;
    if (!g || !rooms.rooms.has(room.code)) return;
    const key2 = `${g.seq}`;
    if (room.casinoKey === key2) return;
    clearTimeout(room.casinoTimer);
    room.casinoKey = key2;
    const now = Date.now();
    let delay = null;
    let run = null;
    const turnMs = g.opts.turnMs;
    const isBot = (id) => room.isAuto(id) || !room.players.get(id);
    const offline = (id) => room.players.get(id)?.connected === false;
    if (g.kind === "poker") {
      if (g.phase === "betting") {
        const id = g.currentPlayerId;
        if (isBot(id)) {
          delay = between([botTiming.min, botTiming.max]);
          run = () => {
            const persona = room.personas?.[id] ?? { style: "tight", level: 1 };
            const a = pokerDecide(g.getStateFor(id), id, persona) ?? { type: "fold" };
            try {
              casinoAction(room, (game) => game.act(id, a));
            } catch {
              casinoAction(room, (game) => game.timeout(id));
            }
          };
        } else if (turnMs || offline(id)) {
          delay = Math.max(0, (offline(id) ? Math.min(turnMs || 8e3, 8e3) : turnMs) - (now - g.turnStarted));
          run = () => casinoAction(room, (game) => game.timeout(id));
        }
      } else if (g.phase === "showdown") {
        delay = Math.max(0, (g.result?.uncontested ? 2600 : 5500) - (now - g.showdownAt));
        run = () => casinoAction(room, (game) => game.nextHand());
      }
    } else {
      const waiting = g.waitingOn();
      const bot = waiting.find(isBot);
      if (bot) {
        delay = g.phase === "betting" ? between([300, 900]) : between([botTiming.min * 0.8, botTiming.max * 0.8]);
        run = () => {
          const d = bjDecide(g.getStateFor(bot), bot, room.personas?.[bot] ?? {});
          casinoAction(room, (game) => {
            if (d?.type === "bet") return game.bet(bot, d.amount);
            if (d?.type === "insure") return game.insure(bot, d.yes);
            if (d?.type === "act") return game.act(bot, d.action);
            return game.timeout();
          });
        };
      } else if (g.phase === "betting" && waiting.length) {
        const allOff = waiting.every(offline);
        delay = Math.max(0, (allOff ? 3e3 : g.opts.betMs) - (now - g.betStarted));
        run = () => casinoAction(room, (game) => game.timeout());
      } else if (g.phase === "insurance") {
        delay = Math.max(0, 15e3 - (now - g.insStarted));
        run = () => casinoAction(room, (game) => game.timeout());
      } else if (g.phase === "playing" && (turnMs || offline(g.currentPlayerId))) {
        delay = Math.max(0, (offline(g.currentPlayerId) ? 6e3 : turnMs) - (now - g.turnStarted));
        run = () => casinoAction(room, (game) => game.timeout());
      } else if (g.phase === "settled") {
        delay = Math.max(0, 4500 - (now - g.settledAt));
        run = () => casinoAction(room, (game) => game.nextRound());
      }
    }
    if (delay == null) return;
    const seq = g.seq;
    room.casinoTimer = setTimeout(() => {
      room.casinoKey = null;
      if (room.game !== g || g.seq !== seq) return scheduleCasino(room);
      try {
        run();
      } catch (err) {
        console.error("[casino]", err);
      }
    }, delay);
    room.casinoTimer.unref?.();
  }
  function chessAction(room, fn) {
    if (room.game?.kind !== "chess") throw new GameError("NOT_PLAYING", "Hier l\xE4uft keine Schachpartie.");
    let event;
    try {
      event = fn(room.game);
    } catch (err) {
      if (err instanceof ChessError) throw new GameError(err.code, err.message);
      throw err;
    }
    if (event?.over) {
      const { over, ...move } = event;
      emitEvent(room, move);
      emitEvent(room, over);
    } else emitEvent(room, event);
    broadcastState(room);
  }
  function broadcastState(room) {
    rooms.recordIfDone(room);
    flushWallet(room);
    for (const player of room.players.values()) {
      if (player.socketId) io.to(player.socketId).emit(EVT.ROOM_STATE, room.stateFor(player.id));
    }
    if (room.game?.kind === "chess") scheduleChessTimer(room);
    else if (room.game?.kind === "poker" || room.game?.kind === "blackjack") scheduleCasino(room);
    else scheduleBot(room);
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
        const card2 = view.hand[0];
        if (card2) applyAction(room, bot.id, { type: "play", cardIds: [card2.id], claimRank: view.requiredRank ?? "K", claimCount: 1 });
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
    if (room.game?.kind === "poker" || room.game?.kind === "blackjack") room.casinoKey = null;
    if (player.abandonTimer) {
      clearTimeout(player.abandonTimer);
      player.abandonTimer = null;
      emitEvent(room, { type: "reconnected", playerId: player.id });
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
    on(socket, EVT.ROOM_CREATE, async ({ name, restore, settings }) => {
      leaveCurrent(socket);
      const account = await accountOf(socket);
      const { room, player } = rooms.createRoom(name, restore, settings, account);
      attach(socket, room, player);
      await refreshBalances(room);
      broadcastState(room);
      return sessionPayload(room, player);
    });
    on(socket, EVT.ROOM_JOIN, async ({ code, name }) => {
      leaveCurrent(socket);
      const account = await accountOf(socket);
      const target = rooms.getRoom(code);
      if (isWallet(target) && account && wallet) {
        const need = minBalanceFor(target.settings, Math.min(target.maxPlayers, target.players.size + 1));
        const bal = await wallet.balanceOf(account.id);
        if (bal < need) throw new GameError("LOW_BALANCE", `F\xFCr diesen Tisch brauchst du mindestens ${fmtTaler(need)} (du hast ${fmtTaler(bal)}).`);
      }
      const { room, player } = rooms.joinRoom(code, name, account);
      attach(socket, room, player);
      await refreshBalances(room);
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
    on(socket, EVT.ROOM_PHOTO, ({ photo } = {}) => {
      const { room, player } = ctx(socket);
      rooms.setPhoto(room, player.id, photo);
      broadcastState(room);
      return {};
    });
    on(socket, EVT.ROOM_PHOTOS, () => {
      const { room } = ctx(socket);
      return { photos: rooms.photosOf(room) };
    });
    on(socket, EVT.ROOM_LEAVE, () => {
      leaveCurrent(socket);
      return {};
    });
    on(socket, EVT.ROOM_SETTINGS, async (settings) => {
      const { room, player } = ctx(socket);
      rooms.updateSettings(room, player.id, settings);
      await refreshBalances(room);
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
    on(socket, EVT.GAME_START, async () => {
      const { room, player } = ctx(socket);
      if (isWallet(room)) {
        if (!wallet) throw new GameError("NO_WALLET", "Taler-Tische gibt es hier nicht.");
        if (room.starting) throw new GameError("BUSY", "Wird schon gestartet \u2026");
        const humans = rooms.assertWalletStart(room, player.id);
        room.starting = true;
        try {
          await room.walletChain;
          const need = minBalanceFor(room.settings, humans.length);
          for (const p of humans) {
            const bal = await wallet.balanceOf(p.accountId);
            if (bal < need) throw new GameError("LOW_BALANCE", `${p.name} hat zu wenig Taler (${fmtTaler(bal)}, n\xF6tig: ${fmtTaler(need)}).`);
          }
          const escrow = rooms.escrowFor(room).map((e) => ({ ...e, game: room.settings.game }));
          await wallet.escrow(room.code, escrow);
          let ev;
          try {
            ev = rooms.startGame(room, player.id);
          } catch (err) {
            await wallet.payout(room.code, escrow.map((e) => ({ ...e, reason: "Start abgebrochen \u2013 zur\xFCck" })), "all");
            throw err;
          }
          if (escrow.length) emitEvent(room, { type: "wallet", kind: "escrow", reason: escrow[0].reason, deltas: Object.fromEntries(escrow.map((e) => [e.playerId, -e.amount])) });
          emitEvent(room, ev);
        } finally {
          room.starting = false;
        }
        await refreshBalances(room);
        broadcastState(room);
        return {};
      }
      emitEvent(room, rooms.startGame(room, player.id));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.CASINO_REBUY, async () => {
      const { room, player } = ctx(socket);
      const g = room.game;
      if (!isWallet(room) || !wallet || g?.kind !== "poker" && g?.kind !== "blackjack") throw new GameError("NO_REBUY", "Nachkaufen gibt es nur an Taler-Tischen.");
      const amount = stakeOf(room.settings);
      if (g.kind === "poker" && (g.mode !== "cash" || g.stacks[player.id] > 0 || g.phase === "over")) throw new GameError("NOT_NOW", "Nachkaufen geht erst, wenn du pleite bist.");
      if (g.kind === "blackjack" && (g.phase !== "betting" || g.ready.has(player.id) || g.chips[player.id] >= g.opts.minBet)) throw new GameError("NOT_NOW", "Nachkaufen geht nur vor dem Setzen, wenn deine Chips nicht mehr reichen.");
      await wallet.escrow(room.code, [{ accountId: player.accountId, amount, reason: `Nachkauf ${g.kind === "poker" ? "Poker" : "Blackjack"}`, game: g.kind }]);
      try {
        casinoAction(room, (game) => game.rebuy(player.id, amount));
      } catch (err) {
        await wallet.payout(room.code, [{ accountId: player.accountId, amount, reason: "Nachkauf zur\xFCck" }], []);
        throw err;
      }
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
    on(socket, EVT.SK_NEXT, async () => {
      const { room, player } = ctx(socket);
      if (isWallet(room) && wallet && room.game?.kind === "schafkopf" && room.game.phase === "scored") {
        const waiting = room.humans.filter((p) => p.id !== player.id && p.connected && !room.ready.has(p.id));
        if (!waiting.length) {
          await room.walletChain;
          const need = minBalanceFor(room.settings, 4);
          for (const p of room.humans) {
            const bal = await wallet.balanceOf(p.accountId);
            if (bal < need) {
              room.game = null;
              room.ready.clear();
              emitEvent(room, { type: "wallet_broke", playerId: p.id, name: p.name, need });
              broadcastState(room);
              return {};
            }
          }
        }
      }
      const event = rooms.readyNext(room, player.id);
      emitEvent(room, event);
      broadcastState(room);
      return {};
    });
    on(socket, EVT.CHESS_MOVE, ({ move }) => {
      const { room, player } = ctx(socket);
      chessAction(room, (g) => g.play(player.id, String(move ?? "").slice(0, 10)));
      return {};
    });
    on(socket, EVT.CHESS_RESIGN, () => {
      const { room, player } = ctx(socket);
      chessAction(room, (g) => g.resign(player.id));
      return {};
    });
    on(socket, EVT.CHESS_DRAW, ({ action }) => {
      const { room, player } = ctx(socket);
      chessAction(room, (g) => g.draw(player.id, String(action)));
      return {};
    });
    on(socket, EVT.CHESS_REMATCH, async () => {
      const { room, player } = ctx(socket);
      if (isWallet(room) && wallet && room.game?.kind === "chess" && room.game.phase === "over") {
        const waiting = room.humans.filter((p) => p.id !== player.id && !room.ready.has(p.id));
        if (!waiting.length) {
          if (room.starting) throw new GameError("BUSY", "Wird schon gestartet \u2026");
          room.starting = true;
          try {
            await room.walletChain;
            const escrow = rooms.escrowFor(room).map((e) => ({ ...e, game: "chess" }));
            await wallet.escrow(room.code, escrow);
            emitEvent(room, rooms.chessRematch(room, player.id));
            emitEvent(room, { type: "wallet", kind: "escrow", reason: "Einsatz Schach", deltas: Object.fromEntries(escrow.map((e) => [e.playerId, -e.amount])) });
          } catch (err) {
            room.ready.clear();
            throw err;
          } finally {
            room.starting = false;
          }
          broadcastState(room);
          return {};
        }
      }
      emitEvent(room, rooms.chessRematch(room, player.id));
      broadcastState(room);
      return {};
    });
    on(socket, EVT.POKER_ACT, ({ action } = {}) => {
      const { room, player } = ctx(socket);
      const a = { type: String(action?.type ?? ""), to: Number(action?.to) };
      casinoAction(room, (g) => g.act(player.id, a));
      return {};
    });
    on(socket, EVT.POKER_SHOW, () => {
      const { room, player } = ctx(socket);
      casinoAction(room, (g) => g.show(player.id));
      return {};
    });
    on(socket, EVT.BJ_BET, ({ amount } = {}) => {
      const { room, player } = ctx(socket);
      casinoAction(room, (g) => g.bet(player.id, Number(amount)));
      return {};
    });
    on(socket, EVT.BJ_INSURE, ({ yes } = {}) => {
      const { room, player } = ctx(socket);
      casinoAction(room, (g) => g.insure(player.id, Boolean(yes)));
      return {};
    });
    on(socket, EVT.BJ_ACT, ({ action } = {}) => {
      const { room, player } = ctx(socket);
      casinoAction(room, (g) => g.act(player.id, String(action)));
      return {};
    });
    on(socket, EVT.PRESENCE_HELLO, ({ cid, name, activity }) => {
      const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, n);
      const id = clean(cid, 40);
      if (!id) throw new GameError("BAD_ID", "Ung\xFCltige Kennung.");
      presence.set(socket.id, { cid: id, name: clean(name, 20) || "Gast", activity: clean(activity, 60) || "Im Men\xFC" });
      return {};
    });
    on(socket, EVT.PRESENCE_LIST, () => {
      const me = presence.get(socket.id);
      const byCid = /* @__PURE__ */ new Map();
      for (const [sid, p] of presence) {
        if (me && p.cid === me.cid) continue;
        const s2 = io.sockets.sockets.get(sid);
        if (!s2) continue;
        const room = s2.data?.code ? rooms.rooms.get(s2.data.code) : null;
        let status = p.activity;
        let busy = false;
        if (room) {
          const label = GAME_LABELS[room.settings.game] ?? "Spiel";
          busy = room.phase !== PHASES.LOBBY;
          status = busy ? `Spielt ${label}` : `Wartet am ${label}-Tisch`;
        }
        const prev = byCid.get(p.cid);
        if (!prev || prev.busy && !busy) byCid.set(p.cid, { cid: p.cid, name: room?.players.get(s2.data.playerId)?.name ?? p.name, status, busy, sameRoom: Boolean(room && room.code === socket.data?.code) });
      }
      return { users: [...byCid.values()].filter((u) => !u.sameRoom).sort((a, b) => a.busy - b.busy || a.name.localeCompare(b.name)).slice(0, 100) };
    });
    on(socket, EVT.INVITE_SEND, ({ cids, all }) => {
      const { room, player } = ctx(socket);
      if (room.phase !== PHASES.LOBBY) throw new GameError("ALREADY_STARTED", "Einladen geht nur, solange der Tisch wartet.");
      if (room.players.size >= room.maxPlayers) throw new GameError("ROOM_FULL", "Der Tisch ist schon voll.");
      const wanted = all ? null : new Set((Array.isArray(cids) ? cids : []).map(String).slice(0, 50));
      const me = presence.get(socket.id);
      room.invited ??= /* @__PURE__ */ new Map();
      const now = Date.now();
      const reached = /* @__PURE__ */ new Set();
      for (const [sid, p] of presence) {
        if (me && p.cid === me.cid) continue;
        if (wanted && !wanted.has(p.cid)) continue;
        const s2 = io.sockets.sockets.get(sid);
        if (!s2 || s2.data?.code === room.code) continue;
        if (all && s2.data?.code && rooms.rooms.get(s2.data.code)?.phase !== PHASES.LOBBY) continue;
        const last = room.invited.get(p.cid) ?? 0;
        if (now - last < INVITE_COOLDOWN_MS && !reached.has(p.cid)) continue;
        room.invited.set(p.cid, now);
        reached.add(p.cid);
        s2.emit(EVT.INVITE, {
          code: room.code,
          from: player.name,
          game: room.settings.game,
          label: GAME_LABELS[room.settings.game] ?? "Spiel",
          ...room.settings.game === "chess" && { chessTime: room.settings.chessTime },
          at: now
        });
      }
      return { sent: reached.size };
    });
    const needWallet = async () => {
      if (!wallet) throw new GameError("NO_WALLET", "Konten gibt es auf diesem Server nicht.");
      try {
        await wallet.ready;
      } catch {
        throw new GameError("WALLET_DOWN", "Die Konten sind gerade nicht erreichbar.");
      }
    };
    on(socket, EVT.ACC_REGISTER, async ({ name, pin }) => {
      await needWallet();
      const res = await wallet.register(name, pin);
      bindAccount(socket, res.account.id);
      return { ...res, persistent: wallet.persistent };
    });
    on(socket, EVT.ACC_LOGIN, async ({ name, pin }) => {
      await needWallet();
      const res = await wallet.login(name, pin);
      bindAccount(socket, res.account.id);
      return { ...res, persistent: wallet.persistent };
    });
    on(socket, EVT.ACC_RESUME, async ({ token }) => {
      await needWallet();
      const res = await wallet.resume(String(token ?? ""));
      if (!res) throw new GameError("SESSION_EXPIRED", "Bitte neu anmelden.");
      bindAccount(socket, res.account.id);
      return { ...res, persistent: wallet.persistent };
    });
    on(socket, EVT.ACC_LOGOUT, async ({ token }) => {
      await needWallet();
      const accId = socketAccount.get(socket.id);
      if (accId && wallet.lockOf(accId)) throw new GameError("BUSY_TABLE", "Erst den Taler-Tisch verlassen.");
      await wallet.logout(String(token ?? ""));
      unbindAccount(socket);
      return {};
    });
    on(socket, EVT.ACC_HISTORY, async () => {
      await needWallet();
      const accId = socketAccount.get(socket.id);
      if (!accId) throw new GameError("NOT_LOGGED_IN", "Nicht angemeldet.");
      return { account: await wallet.account(accId), history: await wallet.history(accId, 60) };
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
      presence.delete(socket.id);
      unbindAccount(socket);
      const { code, playerId } = socket.data ?? {};
      if (!code) return;
      const room = rooms.rooms.get(code);
      const player = room?.players.get(playerId);
      if (!player || player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      if (room.game?.kind === "chess" && room.game.phase === "playing" && room.game.order.includes(player.id)) {
        emitEvent(room, { type: "disconnected", playerId: player.id, name: player.name, pauseMs: chessAbandonMs, chess: true });
        clearTimeout(player.abandonTimer);
        player.abandonTimer = setTimeout(() => {
          player.abandonTimer = null;
          if (player.connected || room.game?.kind !== "chess") return;
          const ev = room.game.abandon(player.id);
          if (ev) {
            emitEvent(room, ev);
            broadcastState(room);
          }
        }, chessAbandonMs);
        player.abandonTimer.unref?.();
      } else if (room.game?.kind === "poker" || room.game?.kind === "blackjack") {
        emitEvent(room, { type: "disconnected", playerId: player.id, name: player.name, casino: true });
        room.casinoKey = null;
      } else if (room.active && room.game.order.includes(player.id)) {
        const wait = isWallet(room) ? Math.max(pauseMs, walletPauseMs) : pauseMs;
        room.pauses.set(player.id, Date.now() + wait);
        emitEvent(room, { type: "disconnected", playerId: player.id, name: player.name, pauseMs: wait });
        clearTimeout(player.pauseTimer);
        player.pauseTimer = setTimeout(() => {
          if (player.connected || !room.pauses.has(player.id)) return;
          room.pauses.delete(player.id);
          if (isWallet(room)) {
            const event = rooms.removePlayer(room, player.id);
            emitEvent(room, { type: "left", playerId: player.id, timeout: true });
            emitEvent(room, event);
          } else if (room.game?.kind === "schafkopf" && room.game.order.includes(player.id)) {
            player.autoplay = true;
            emitEvent(room, { type: "autoplay", playerId: player.id, name: player.name });
          } else if (room.game?.phase === PHASES.PLAYING && room.game.order.includes(player.id)) {
            emitEvent(room, { ...room.game.removePlayer(player.id), reason: "timeout", name: player.name });
          }
          broadcastState(room);
        }, wait);
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
var TOPICS = {
  mix: "deutsch | auf deutsch #shorts",
  comedy: "comedy deutsch | lustig deutsch #shorts",
  fussball: "fu\xDFball | bundesliga #shorts",
  gaming: "gaming deutsch | zocken #shorts",
  tiere: "tiere lustig | hund | katze #shorts",
  fails: "fails deutsch | lustige fails #shorts",
  musik: "musik deutsch | deutschrap #shorts"
};
var FOREIGN_SCRIPT = /[\u0400-\u04FF\u0590-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
function youtubeRouter() {
  const router = express.Router();
  const cache = /* @__PURE__ */ new Map();
  async function api(path4, params) {
    const url = `${API}/${path4}?${new URLSearchParams({ ...params, key: key() })}`;
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
      const topic = TOPICS[req.query.topic] ? String(req.query.topic) : "mix";
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1e3);
      since.setUTCMinutes(0, 0, 0);
      const data = await api("search", {
        part: "snippet",
        type: "video",
        q: TOPICS[topic],
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
        // Titel in fremden Schriften (Devanagari, Arabisch, Kyrillisch, CJK …) aussortieren → deutschsprachiger Feed
        items: (data.items ?? []).filter((v) => !FOREIGN_SCRIPT.test(`${v.snippet?.title ?? ""} ${v.snippet?.channelTitle ?? ""}`)).map((v) => toItem(v.id?.videoId, v.snippet)).filter(Boolean),
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

// src/wallet/Wallet.js
import { createHash, randomBytes as randomBytes3, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// src/wallet/store.js
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
var StoreError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var TX_KEEP = 200;
var FileStore = class {
  constructor(file = null) {
    this.file = file;
    this.persistent = Boolean(file);
    this.data = { accounts: {}, tx: {}, sessions: {}, holds: [], seq: 0 };
    this.timer = null;
  }
  async init() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    if (existsSync(this.file)) {
      try {
        const d = JSON.parse(readFileSync(this.file, "utf8"));
        this.data = { accounts: d.accounts ?? {}, tx: d.tx ?? {}, sessions: d.sessions ?? {}, holds: d.holds ?? [], seq: d.seq ?? 0 };
      } catch (err) {
        console.error("[wallet] Datei unlesbar, starte leer:", err.message);
      }
    }
    process.once("exit", () => {
      if (!this.timer) return;
      try {
        this.flush();
      } catch {
      }
    });
  }
  #save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      try {
        this.flush();
      } catch (err) {
        console.error("[wallet] Speichern fehlgeschlagen:", err.message);
      }
    }, 250);
    this.timer.unref?.();
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
  async findAccountByName(name) {
    const low = String(name).toLowerCase();
    return Object.values(this.data.accounts).find((a) => a.nameLower === low) ?? null;
  }
  async getAccount(id) {
    return this.data.accounts[id] ?? null;
  }
  async insertAccount(acc2) {
    if (await this.findAccountByName(acc2.name)) throw new StoreError("NAME_TAKEN", "Diesen Namen gibt es schon.");
    this.data.accounts[acc2.id] = { ...acc2, balance: 0 };
    this.data.tx[acc2.id] = [];
    this.#save();
  }
  async updateAccount(id, fields) {
    const a = this.data.accounts[id];
    if (!a) return;
    for (const k of ["failed", "lockedUntil", "dailyDay"]) if (k in fields) a[k] = fields[k];
    this.#save();
  }
  /** Mehrere Buchungen auf einmal – alle oder keine. */
  async applyTransactions(list, { allowNegative = false } = {}) {
    const next = {};
    for (const t of list) {
      const a = this.data.accounts[t.accountId];
      if (!a) throw new StoreError("NO_ACCOUNT", "Konto nicht gefunden.");
      const cur = next[t.accountId] ?? a.balance;
      const val = cur + t.amount;
      if (val < 0 && !allowNegative) throw new StoreError("INSUFFICIENT", `${a.name} hat nicht genug Taler.`);
      next[t.accountId] = val;
    }
    const at = Date.now();
    const running = {};
    for (const t of list) {
      const a = this.data.accounts[t.accountId];
      running[t.accountId] = (running[t.accountId] ?? a.balance) + t.amount;
      const rows = this.data.tx[t.accountId] ??= [];
      rows.push({ id: ++this.data.seq, amount: t.amount, balanceAfter: running[t.accountId], reason: String(t.reason).slice(0, 80), game: t.game ?? null, at });
      if (rows.length > TX_KEEP) rows.splice(0, rows.length - TX_KEEP);
    }
    for (const [id, val] of Object.entries(next)) this.data.accounts[id].balance = val;
    this.#save();
    return next;
  }
  async listTransactions(id, limit = 50) {
    return (this.data.tx[id] ?? []).slice(-limit).reverse();
  }
  async putSession(tokenHash, accountId) {
    this.data.sessions[tokenHash] = { accountId, at: Date.now() };
    this.#save();
  }
  async getSession(tokenHash) {
    return this.data.sessions[tokenHash]?.accountId ?? null;
  }
  async deleteSession(tokenHash) {
    delete this.data.sessions[tokenHash];
    this.#save();
  }
  // Gesicherte Einsätze (liegen gerade auf einem Tisch) – nach einem Neustart zurückbuchen
  async addHolds(code, rows) {
    for (const r of rows) this.data.holds.push({ code, accountId: r.accountId, amount: r.amount });
    this.#save();
  }
  async removeHolds(code, accountIds = null) {
    this.data.holds = this.data.holds.filter((h) => h.code !== code || accountIds && !accountIds.includes(h.accountId));
    this.#save();
  }
  async takeAllHolds() {
    const all = this.data.holds;
    this.data.holds = [];
    this.#save();
    return all;
  }
};
var rowToAccount = (r) => r && {
  id: r.id,
  name: r.name,
  nameLower: r.name_lower,
  pinHash: r.pin_hash,
  salt: r.salt,
  balance: Number(r.balance),
  dailyDay: r.daily_day,
  failed: r.failed,
  lockedUntil: Number(r.locked_until),
  createdAt: Number(r.created_at)
};
var PgStore = class {
  constructor(url, pgModule = null) {
    this.url = url;
    this.persistent = true;
    this.pool = null;
    this.pgModule = pgModule;
  }
  async init() {
    const pg = this.pgModule ?? (await import("pg")).default;
    const local = /localhost|127\.0\.0\.1/.test(this.url);
    this.pool = new pg.Pool({ connectionString: this.url, max: 5, ssl: local ? false : { rejectUnauthorized: false }, idleTimeoutMillis: 3e4 });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY, name text NOT NULL, name_lower text UNIQUE NOT NULL,
        pin_hash text NOT NULL, salt text NOT NULL, balance bigint NOT NULL DEFAULT 0,
        daily_day text, failed int NOT NULL DEFAULT 0, locked_until bigint NOT NULL DEFAULT 0, created_at bigint NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_tx (
        id bigserial PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        amount bigint NOT NULL, balance_after bigint NOT NULL, reason text NOT NULL, game text, created_at bigint NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_tx_acc ON wallet_tx (account_id, id DESC);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at bigint NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_holds (
        id bigserial PRIMARY KEY, code text NOT NULL, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, amount bigint NOT NULL);
    `);
  }
  async findAccountByName(name) {
    const { rows } = await this.pool.query("SELECT * FROM accounts WHERE name_lower = $1", [String(name).toLowerCase()]);
    return rowToAccount(rows[0]) ?? null;
  }
  async getAccount(id) {
    const { rows } = await this.pool.query("SELECT * FROM accounts WHERE id = $1", [id]);
    return rowToAccount(rows[0]) ?? null;
  }
  async insertAccount(a) {
    try {
      await this.pool.query("INSERT INTO accounts (id, name, name_lower, pin_hash, salt, balance, daily_day, created_at) VALUES ($1,$2,$3,$4,$5,0,$6,$7)", [
        a.id,
        a.name,
        a.nameLower,
        a.pinHash,
        a.salt,
        a.dailyDay ?? null,
        a.createdAt
      ]);
    } catch (err) {
      if (err.code === "23505") throw new StoreError("NAME_TAKEN", "Diesen Namen gibt es schon.");
      throw err;
    }
  }
  async updateAccount(id, fields) {
    const map = { failed: "failed", lockedUntil: "locked_until", dailyDay: "daily_day" };
    const keys = Object.keys(fields).filter((k) => map[k]);
    if (!keys.length) return;
    await this.pool.query(`UPDATE accounts SET ${keys.map((k, i) => `${map[k]} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
  }
  async applyTransactions(list, { allowNegative = false } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ids = [...new Set(list.map((t) => t.accountId))].sort();
      for (const id of ids) await client.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [id]);
      const out = {};
      const at = Date.now();
      for (const t of list) {
        const { rows } = await client.query(`UPDATE accounts SET balance = balance + $2 WHERE id = $1 ${allowNegative ? "" : "AND balance + $2 >= 0"} RETURNING balance, name`, [t.accountId, t.amount]);
        if (!rows.length) {
          const { rows: who } = await client.query("SELECT name FROM accounts WHERE id = $1", [t.accountId]);
          throw new StoreError(who.length ? "INSUFFICIENT" : "NO_ACCOUNT", who.length ? `${who[0].name} hat nicht genug Taler.` : "Konto nicht gefunden.");
        }
        const bal = Number(rows[0].balance);
        out[t.accountId] = bal;
        await client.query("INSERT INTO wallet_tx (account_id, amount, balance_after, reason, game, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [t.accountId, t.amount, bal, String(t.reason).slice(0, 80), t.game ?? null, at]);
      }
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      throw err;
    } finally {
      client.release();
    }
  }
  async listTransactions(id, limit = 50) {
    const { rows } = await this.pool.query("SELECT id, amount, balance_after, reason, game, created_at FROM wallet_tx WHERE account_id = $1 ORDER BY id DESC LIMIT $2", [id, limit]);
    return rows.map((r) => ({ id: Number(r.id), amount: Number(r.amount), balanceAfter: Number(r.balance_after), reason: r.reason, game: r.game, at: Number(r.created_at) }));
  }
  async putSession(tokenHash, accountId) {
    await this.pool.query("INSERT INTO sessions (token_hash, account_id, created_at) VALUES ($1,$2,$3) ON CONFLICT (token_hash) DO NOTHING", [tokenHash, accountId, Date.now()]);
  }
  async getSession(tokenHash) {
    const { rows } = await this.pool.query("SELECT account_id FROM sessions WHERE token_hash = $1", [tokenHash]);
    return rows[0]?.account_id ?? null;
  }
  async deleteSession(tokenHash) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }
  async addHolds(code, rows) {
    for (const r of rows) await this.pool.query("INSERT INTO wallet_holds (code, account_id, amount) VALUES ($1,$2,$3)", [code, r.accountId, r.amount]);
  }
  async removeHolds(code, accountIds = null) {
    if (accountIds) await this.pool.query("DELETE FROM wallet_holds WHERE code = $1 AND account_id = ANY($2)", [code, accountIds]);
    else await this.pool.query("DELETE FROM wallet_holds WHERE code = $1", [code]);
  }
  async takeAllHolds() {
    const { rows } = await this.pool.query("DELETE FROM wallet_holds RETURNING code, account_id, amount");
    return rows.map((r) => ({ code: r.code, accountId: r.account_id, amount: Number(r.amount) }));
  }
};
function createStore({ databaseUrl = process.env.DATABASE_URL, dataDir = process.env.DATA_DIR, memory = false } = {}) {
  if (memory) return new FileStore(null);
  if (databaseUrl) return new PgStore(databaseUrl);
  const store = new FileStore(path.join(dataDir || path.resolve(process.cwd(), "data"), "wallet.json"));
  if (process.env.RENDER) store.persistent = false;
  return store;
}

// src/wallet/Wallet.js
var scrypt = promisify(scryptCb);
var MAX_FAILS = 5;
var LOCK_MS = 5 * 60 * 1e3;
var hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");
var berlinDay = (d = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
function cleanName(raw) {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  if (name.length < 2) throw new GameError("BAD_NAME", "Der Name braucht mindestens 2 Zeichen.");
  return name;
}
function checkPin(pin) {
  const p = String(pin ?? "");
  if (!/^\d+$/.test(p) || p.length < WALLET.pinMin || p.length > WALLET.pinMax) throw new GameError("BAD_PIN", `Die PIN muss aus ${WALLET.pinMin}\u2013${WALLET.pinMax} Ziffern bestehen.`);
  return p;
}
async function hashPin(pin, salt) {
  return (await scrypt(pin, salt, 32)).toString("hex");
}
var publicAccount = (a) => ({ id: a.id, name: a.name, balance: a.balance });
var Wallet = class {
  constructor(store) {
    this.store = store;
    this.locks = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  get persistent() {
    return this.store.persistent;
  }
  async init() {
    await this.store.init();
    const holds = await this.store.takeAllHolds();
    if (holds.length) {
      const sum = {};
      for (const h of holds) sum[h.accountId] = (sum[h.accountId] ?? 0) + h.amount;
      await this.store.applyTransactions(Object.entries(sum).map(([accountId, amount]) => ({ accountId, amount, reason: "R\xFCckbuchung nach Server-Neustart" })), { allowNegative: true }).catch((err) => console.error("[wallet] R\xFCckbuchung fehlgeschlagen", err));
    }
  }
  /** Einsatz/Buy-in vom Konto auf den Tisch (alle oder keiner). */
  async escrow(code, entries) {
    const rows = entries.filter((e) => e.accountId && e.amount > 0);
    if (!rows.length) return {};
    const out = await this.transfer(rows.map((e) => ({ accountId: e.accountId, amount: -e.amount, reason: e.reason, game: e.game })));
    await this.store.addHolds(code, rows);
    return out;
  }
  /** Geld vom Tisch zurück aufs Konto; Sicherung freigeben (release: Konten oder 'all'). */
  async payout(code, entries, release = "all") {
    const out = await this.transfer(entries.filter((e) => e.accountId && e.amount > 0).map((e) => ({ accountId: e.accountId, amount: e.amount, reason: e.reason, game: e.game })));
    await this.store.removeHolds(code, release === "all" ? null : release);
    return out;
  }
  /** Bescheid geben, wenn sich ein Kontostand ändert (für Live-Anzeige). */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #changed(balances) {
    for (const fn of this.listeners) fn(balances);
  }
  #wrap(err) {
    if (err instanceof StoreError) return new GameError(err.code, err.message);
    return err;
  }
  async #newSession(accountId) {
    const token = randomBytes3(24).toString("hex");
    await this.store.putSession(hashToken(token), accountId);
    return token;
  }
  async register(rawName, rawPin) {
    const name = cleanName(rawName);
    const pin = checkPin(rawPin);
    if (await this.store.findAccountByName(name)) throw new GameError("NAME_TAKEN", "Diesen Namen gibt es schon \u2013 melde dich an oder nimm einen anderen.");
    const salt = randomBytes3(16).toString("hex");
    const acc2 = { id: randomBytes3(10).toString("hex"), name, nameLower: name.toLowerCase(), pinHash: await hashPin(pin, salt), salt, dailyDay: berlinDay(), failed: 0, lockedUntil: 0, createdAt: Date.now() };
    try {
      await this.store.insertAccount(acc2);
      await this.store.applyTransactions([{ accountId: acc2.id, amount: WALLET.start, reason: "Startguthaben" }]);
    } catch (err) {
      throw this.#wrap(err);
    }
    const token = await this.#newSession(acc2.id);
    return { account: publicAccount(await this.store.getAccount(acc2.id)), token, daily: 0 };
  }
  async login(rawName, rawPin) {
    const acc2 = await this.store.findAccountByName(String(rawName ?? "").trim());
    const pin = String(rawPin ?? "");
    if (!acc2) throw new GameError("BAD_LOGIN", "Name oder PIN stimmt nicht.");
    if (acc2.lockedUntil > Date.now()) {
      const min = Math.ceil((acc2.lockedUntil - Date.now()) / 6e4);
      throw new GameError("LOCKED", `Zu viele Fehlversuche \u2013 bitte in ${min} Min. nochmal.`);
    }
    const hash = Buffer.from(await hashPin(pin, acc2.salt), "hex");
    const ok = hash.length === 32 && timingSafeEqual(hash, Buffer.from(acc2.pinHash, "hex"));
    if (!ok) {
      const failed = (acc2.failed ?? 0) + 1;
      await this.store.updateAccount(acc2.id, failed >= MAX_FAILS ? { failed: 0, lockedUntil: Date.now() + LOCK_MS } : { failed });
      throw new GameError("BAD_LOGIN", "Name oder PIN stimmt nicht.");
    }
    if (acc2.failed) await this.store.updateAccount(acc2.id, { failed: 0 });
    const daily = await this.claimDaily(acc2.id);
    const token = await this.#newSession(acc2.id);
    return { account: publicAccount(await this.store.getAccount(acc2.id)), token, daily };
  }
  /** Gespeicherte Sitzung fortsetzen. */
  async resume(token) {
    if (!token) return null;
    const id = await this.store.getSession(hashToken(token));
    if (!id) return null;
    const daily = await this.claimDaily(id);
    const acc2 = await this.store.getAccount(id);
    return acc2 ? { account: publicAccount(acc2), daily } : null;
  }
  async logout(token) {
    if (token) await this.store.deleteSession(hashToken(token));
  }
  /** Einmal am Tag: +Bonus, und wer danach unter der Grenze liegt, wird aufgefüllt. */
  async claimDaily(id) {
    const acc2 = await this.store.getAccount(id);
    if (!acc2) return 0;
    const today = berlinDay();
    if (acc2.dailyDay === today) return 0;
    await this.store.updateAccount(id, { dailyDay: today });
    const amount = Math.max(WALLET.daily, WALLET.floor - acc2.balance);
    const out = await this.store.applyTransactions([{ accountId: id, amount, reason: acc2.balance + WALLET.daily < WALLET.floor ? "Tagesbonus + Auff\xFCllen" : "Tagesbonus" }]);
    this.#changed(out);
    return amount;
  }
  async account(id) {
    const a = await this.store.getAccount(id);
    return a ? publicAccount(a) : null;
  }
  async balanceOf(id) {
    return (await this.store.getAccount(id))?.balance ?? 0;
  }
  async history(id, limit = 50) {
    return this.store.listTransactions(id, Math.min(100, limit));
  }
  /** Buchungen – alle oder keine; schlägt fehl, wenn jemand zu wenig hat. */
  async transfer(list) {
    const clean = list.filter((t) => t && t.accountId && Number.isFinite(t.amount) && t.amount !== 0).map((t) => ({ ...t, amount: Math.round(t.amount) }));
    if (!clean.length) return {};
    try {
      const out = await this.store.applyTransactions(clean);
      this.#changed(out);
      return out;
    } catch (err) {
      throw this.#wrap(err);
    }
  }
  /**
   * Nullsummen-Abrechnung (Schafkopf, Lügen): Verlierer zahlen höchstens, was sie haben;
   * Gewinner bekommen anteilig weniger, falls jemand nicht voll zahlen kann. Es entsteht kein Geld.
   * @param {{accountId:string, delta:number}[]} entries
   * @returns {Promise<Record<string, number>>} tatsächlich gebuchte Beträge
   */
  async settle(entries, reason, game) {
    const rows = entries.filter((e) => e.accountId && Number.isFinite(e.delta) && Math.round(e.delta) !== 0).map((e) => ({ ...e, delta: Math.round(e.delta) }));
    if (!rows.length) return {};
    const balances = {};
    for (const r of rows) balances[r.accountId] ??= await this.balanceOf(r.accountId);
    let paid = 0;
    const applied = {};
    for (const r of rows.filter((x) => x.delta < 0)) {
      const amount = -Math.min(-r.delta, balances[r.accountId]);
      applied[r.accountId] = (applied[r.accountId] ?? 0) + amount;
      paid += -amount;
    }
    const owed = rows.filter((x) => x.delta > 0).reduce((s, x) => s + x.delta, 0);
    const factor = owed > 0 ? Math.min(1, paid / owed) : 0;
    let given = 0;
    const winners = rows.filter((x) => x.delta > 0);
    winners.forEach((r) => {
      const amount = Math.floor(r.delta * factor);
      applied[r.accountId] = (applied[r.accountId] ?? 0) + amount;
      given += amount;
    });
    if (winners.length && paid - given > 0) applied[winners[0].accountId] += paid - given;
    await this.transfer(Object.entries(applied).map(([accountId, amount]) => ({ accountId, amount, reason, game })));
    return applied;
  }
  // ---------- Tisch-Sperre ----------
  lockOf(accountId) {
    return this.locks.get(accountId) ?? null;
  }
  lock(accountId, code) {
    const cur = this.locks.get(accountId);
    if (cur && cur !== code) throw new GameError("BUSY_TABLE", "Du sitzt schon an einem anderen Taler-Tisch.");
    this.locks.set(accountId, code);
  }
  unlock(accountId, code) {
    if (!code || this.locks.get(accountId) === code) this.locks.delete(accountId);
  }
};

// src/app.js
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var CLIENT_ORIGIN = process.env.CLIENT_ORIGIN?.split(",").map((s) => s.trim());
function createLuegenServer({ clientDir, pauseMs, botTiming, chessAbandonMs, walletMemory = Boolean(process.env.NODE_TEST_CONTEXT), walletPauseMs } = {}) {
  const app = express2();
  const httpServer2 = createServer(app);
  const io = new Server(httpServer2, {
    cors: { origin: CLIENT_ORIGIN ?? true },
    // in Produktion auf die echte Domain setzen
    // Abbrüche (WLAN weg, Handy gesperrt) schnell bemerken: spätestens nach ~9 s
    pingInterval: 4e3,
    pingTimeout: 5e3
  });
  const wallet = new Wallet(createStore({ memory: walletMemory }));
  wallet.ready = wallet.init().catch((err) => {
    console.error("[wallet] Speicher nicht erreichbar:", err.message);
    throw err;
  });
  wallet.ready.catch(() => {
  });
  if (!walletMemory) wallet.ready.then(() => console.log(`[wallet] Konten: ${process.env.DATABASE_URL ? "Datenbank" : wallet.persistent ? "Datei" : "nur bis zum n\xE4chsten Neustart (DATABASE_URL fehlt)"}`)).catch(() => {
  });
  const rooms = new RoomManager({ wallet });
  registerSocketHandlers(io, rooms, { pauseMs, botTiming, chessAbandonMs, wallet, walletPauseMs });
  app.set("trust proxy", true);
  app.use(youtubeRouter());
  app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
  if (clientDir) {
    const PUBLIC = ["manifest.webmanifest", "icon-192.png", "icon-512.png", "favicon.svg"];
    for (const f of PUBLIC) app.get(`/${f}`, (_req, res) => res.sendFile(path2.join(clientDir, f)));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => res.sendFile(path2.join(clientDir, "index.html")));
    return { app, httpServer: httpServer2, io, rooms, wallet };
  }
  const clientDist = path2.resolve(__dirname, "../../client/dist");
  if (existsSync2(clientDist)) {
    app.use(express2.static(clientDist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => res.sendFile(path2.join(clientDist, "index.html")));
  }
  return { app, httpServer: httpServer2, io, rooms, wallet };
}

// src/deploy-entry.js
var dir = path3.dirname(fileURLToPath2(import.meta.url));
var PORT = Number(process.env.PORT ?? 3001);
var { httpServer } = createLuegenServer({ clientDir: dir });
httpServer.listen(PORT, () => console.log(`L\xFCgen l\xE4uft auf Port ${PORT}`));
