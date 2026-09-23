import { randomInt, randomUUID } from "node:crypto";
import {
  CLICK_TIMEOUT_MS,
  MAX_PLAYERS,
  POINTS,
  RECONNECT_GRACE_MS,
  RESULT_DISPLAY_MS,
  ROOM_IDLE_TTL_MS,
  ROUND_MAX_DELAY_MS,
  ROUND_MIN_DELAY_MS,
  TOTAL_ROUNDS,
  type GameState,
  type Phase,
  type PlayerPublic,
  type RoundResultPublic,
} from "@reaction-rush/shared";

type Player = {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
  socketId?: string;
  sessionId: string;
  lastSeenAt: number;
  status: PlayerPublic["status"];
  reactionTime?: number;
  roundPoints?: number;
  reconnectTimer?: NodeJS.Timeout;
};

type Room = {
  id: string;
  code: string;
  hostPlayerId: string;
  phase: Phase;
  round: number;
  roundTriggerAt?: number;
  roundEndsAt?: number;
  players: Map<string, Player>;
  eligiblePlayerIds: Set<string>;
  timers: NodeJS.Timeout[];
  roundResults: RoundResultPublic[];
  createdAt: number;
  lastActivityAt: number;
};

export const rooms = new Map<string, Room>();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NAME_MAX = 18;

function touch(room: Room) {
  room.lastActivityAt = Date.now();
}

export function sanitizeNickname(input: string) {
  const value = String(input ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, NAME_MAX);
  if (!value) throw new Error("Enter a nickname.");
  return value;
}

function validCode(code: string) {
  return /^[A-Z2-9]{6}$/.test(code);
}

function generateCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (![...rooms.values()].every((room) => room.code !== code)) return code;
  }
}

function publicPlayer(player: Player, hostId: string): PlayerPublic {
  return {
    id: player.id,
    nickname: player.nickname,
    score: player.score,
    connected: player.connected,
    isHost: player.id === hostId,
    status: player.connected ? player.status : "DISCONNECTED",
    reactionTime: player.reactionTime,
    roundPoints: player.roundPoints,
  };
}

export function publicState(room: Room, selfPlayerId?: string): GameState {
  const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
  const winner = room.phase === "FINISHED"
    ? [...room.players.values()].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))[0]
    : undefined;

  return {
    roomCode: room.code,
    hostPlayerId: room.hostPlayerId,
    phase: room.phase,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    players: [...room.players.values()].map((p) => publicPlayer(p, room.hostPlayerId)),
    roundResults: room.roundResults,
    roundEndsAt: room.roundEndsAt,
    clickAt: room.phase === "CLICK" ? room.roundTriggerAt : undefined,
    winnerId: winner?.id,
    selfPlayerId,
  };
}

export function createRoom(nickname: string) {
  const now = Date.now();
  const player: Player = {
    id: randomUUID(),
    nickname: sanitizeNickname(nickname),
    score: 0,
    connected: false,
    sessionId: randomUUID(),
    lastSeenAt: now,
    status: "WAITING",
  };
  const room: Room = {
    id: randomUUID(),
    code: generateCode(),
    hostPlayerId: player.id,
    phase: "LOBBY",
    round: 0,
    players: new Map([[player.id, player]]),
    eligiblePlayerIds: new Set(),
    timers: [],
    roundResults: [],
    createdAt: now,
    lastActivityAt: now,
  };
  rooms.set(room.id, room);
  return { room, player };
}

export function getRoom(code: string) {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!validCode(normalized)) return undefined;
  return [...rooms.values()].find((room) => room.code === normalized);
}

export function findPlayerBySession(room: Room, sessionId: string) {
  return [...room.players.values()].find((player) => player.sessionId === sessionId);
}

export function joinRoom(room: Room, nickname: string) {
  if (room.phase !== "LOBBY" && room.phase !== "FINISHED") {
    throw new Error("This game is already in progress. Join after the current match finishes.");
  }
  if (room.players.size >= MAX_PLAYERS) throw new Error("This room is full (maximum 8 players).");
  const name = sanitizeNickname(nickname);
  if ([...room.players.values()].some((p) => p.nickname.toLowerCase() === name.toLowerCase())) {
    throw new Error("That nickname is already being used in this room.");
  }
  const now = Date.now();
  const player: Player = {
    id: randomUUID(),
    nickname: name,
    score: 0,
    connected: false,
    sessionId: randomUUID(),
    lastSeenAt: now,
    status: "WAITING",
  };
  room.players.set(player.id, player);
  touch(room);
  return player;
}

export function attachPlayer(room: Room, player: Player, socketId: string) {
  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  player.reconnectTimer = undefined;
  player.connected = true;
  player.socketId = socketId;
  player.lastSeenAt = Date.now();
  touch(room);
}

function transferHostIfNeeded(room: Room) {
  const host = room.players.get(room.hostPlayerId);
  if (host?.connected) return;
  const replacement = [...room.players.values()].find((p) => p.connected);
  if (replacement) room.hostPlayerId = replacement.id;
}

export function detachPlayer(room: Room, player: Player) {
  player.connected = false;
  player.socketId = undefined;
  player.lastSeenAt = Date.now();
  transferHostIfNeeded(room);
  touch(room);

  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  player.reconnectTimer = setTimeout(() => {
    if (!rooms.has(room.id) || player.connected) return;
    room.players.delete(player.id);
    room.eligiblePlayerIds.delete(player.id);
    if (room.hostPlayerId === player.id) transferHostIfNeeded(room);
    touch(room);
    if (room.players.size === 0) removeRoom(room);
  }, RECONNECT_GRACE_MS);
}

export function startGame(room: Room) {
  if (room.phase !== "LOBBY") throw new Error("The game has already started.");
  const connected = [...room.players.values()].filter((p) => p.connected);
  if (connected.length < 2) throw new Error("At least 2 connected players are required.");
  room.round = 1;
  for (const player of room.players.values()) {
    player.score = 0;
    player.reactionTime = undefined;
    player.roundPoints = undefined;
  }
  scheduleWaiting(room);
}

function clearTimers(room: Room) {
  for (const timer of room.timers) clearTimeout(timer);
  room.timers = [];
}

function scheduleWaiting(room: Room) {
  clearTimers(room);
  room.phase = "WAITING";
  room.roundTriggerAt = undefined;
  room.roundEndsAt = Date.now() + ROUND_MAX_DELAY_MS + CLICK_TIMEOUT_MS;
  room.roundResults = [];
  room.eligiblePlayerIds = new Set([...room.players.values()].filter((p) => p.connected).map((p) => p.id));

  for (const player of room.players.values()) {
    player.reactionTime = undefined;
    player.roundPoints = undefined;
    if (room.eligiblePlayerIds.has(player.id)) player.status = "WAITING";
    else player.status = "DISCONNECTED";
  }

  touch(room);
  const delay = randomInt(ROUND_MIN_DELAY_MS, ROUND_MAX_DELAY_MS + 1);
  room.timers.push(setTimeout(() => beginClick(room), delay));
}

function beginClick(room: Room) {
  if (!rooms.has(room.id) || room.phase !== "WAITING") return;
  room.phase = "CLICK";
  room.roundTriggerAt = Date.now();
  room.roundEndsAt = room.roundTriggerAt + CLICK_TIMEOUT_MS;
  touch(room);
  room.timers.push(setTimeout(() => finishRound(room), CLICK_TIMEOUT_MS));
}

function pointsFor(position: number) {
  return POINTS[Math.min(position - 1, POINTS.length - 1)] ?? POINTS[POINTS.length - 1];
}

function allEligibleDone(room: Room) {
  return [...room.eligiblePlayerIds].every((id) => {
    const player = room.players.get(id);
    return !player || player.status === "CLICKED" || player.status === "FALSE_START";
  });
}

export function playerClick(room: Room, player: Player, round: number) {
  if (round !== room.round) throw new Error("That round is no longer active.");
  if (!room.eligiblePlayerIds.has(player.id)) throw new Error("You are not active in this round.");
  if (!player.connected) throw new Error("You are disconnected.");
  if (player.status === "CLICKED" || player.status === "FALSE_START") return;

  if (room.phase === "WAITING") {
    player.status = "FALSE_START";
    player.roundPoints = -30;
    player.score -= 30;
    touch(room);
    if (allEligibleDone(room)) finishRound(room);
    return;
  }

  if (room.phase !== "CLICK") throw new Error("The round is not accepting clicks.");
  player.status = "CLICKED";
  player.reactionTime = Math.max(0, Date.now() - (room.roundTriggerAt ?? Date.now()));
  player.roundPoints = 0;
  touch(room);
  if (allEligibleDone(room)) finishRound(room);
}

function finishRound(room: Room) {
  if (!rooms.has(room.id) || (room.phase !== "WAITING" && room.phase !== "CLICK")) return;
  clearTimers(room);

  const clicked = [...room.eligiblePlayerIds]
    .map((id) => room.players.get(id))
    .filter((player): player is Player => Boolean(player && player.status === "CLICKED" && typeof player.reactionTime === "number"))
    .sort((a, b) => a.reactionTime! - b.reactionTime!);

  clicked.forEach((player, index) => {
    player.roundPoints = pointsFor(index + 1);
    player.score += player.roundPoints;
  });

  for (const id of room.eligiblePlayerIds) {
    const player = room.players.get(id);
    if (!player) continue;
    if (player.status === "WAITING") player.roundPoints = 0;
    if (player.status === "FALSE_START") player.roundPoints = -30;
  }

  room.roundResults = [...room.eligiblePlayerIds]
    .map((id) => room.players.get(id))
    .filter((player): player is Player => Boolean(player))
    .sort((a, b) => {
      const rankA = a.status === "CLICKED" ? a.reactionTime ?? Infinity : a.status === "FALSE_START" ? Infinity + 1 : Infinity + 2;
      const rankB = b.status === "CLICKED" ? b.reactionTime ?? Infinity : b.status === "FALSE_START" ? Infinity + 1 : Infinity + 2;
      return rankA - rankB;
    })
    .map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      reactionTime: player.reactionTime,
      position: player.status === "CLICKED" ? clicked.findIndex((p) => p.id === player.id) + 1 : undefined,
      points: player.roundPoints ?? 0,
      falseStart: player.status === "FALSE_START",
      timedOut: player.status === "WAITING",
    }));

  room.phase = "RESULT";
  room.roundEndsAt = Date.now() + RESULT_DISPLAY_MS;
  touch(room);

  room.timers.push(setTimeout(() => {
    if (!rooms.has(room.id) || room.phase !== "RESULT") return;
    if (room.round >= TOTAL_ROUNDS) {
      room.phase = "FINISHED";
      room.roundEndsAt = undefined;
      room.roundResults = room.roundResults;
      touch(room);
      return;
    }
    room.round += 1;
    scheduleWaiting(room);
  }, RESULT_DISPLAY_MS));
}

export function playAgain(room: Room) {
  if (room.phase !== "FINISHED") throw new Error("The current game is not finished.");
  const connected = [...room.players.values()].filter((p) => p.connected);
  if (connected.length < 2) throw new Error("At least 2 connected players are required.");
  room.round = 1;
  room.roundResults = [];
  for (const player of room.players.values()) {
    player.score = 0;
    player.reactionTime = undefined;
    player.roundPoints = undefined;
  }
  scheduleWaiting(room);
}

export function leaveRoom(room: Room, player: Player) {
  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  room.players.delete(player.id);
  room.eligiblePlayerIds.delete(player.id);
  if (room.hostPlayerId === player.id) transferHostIfNeeded(room);
  touch(room);
  if (room.players.size === 0) removeRoom(room);
}

export function removeRoom(room: Room) {
  clearTimers(room);
  for (const player of room.players.values()) {
    if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  }
  rooms.delete(room.id);
}

export function returnLobby(room: Room) {
  if (room.phase !== "FINISHED") throw new Error("The current game is not finished.");
  clearTimers(room);
  room.phase = "LOBBY";
  room.round = 0;
  room.roundTriggerAt = undefined;
  room.roundEndsAt = undefined;
  room.roundResults = [];
  room.eligiblePlayerIds.clear();
  for (const player of room.players.values()) {
    player.score = 0;
    player.reactionTime = undefined;
    player.roundPoints = undefined;
    player.status = player.connected ? "WAITING" : "DISCONNECTED";
  }
  touch(room);
}

export function cleanupRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const nobodyConnected = ![...room.players.values()].some((p) => p.connected);
    if (nobodyConnected && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) removeRoom(room);
  }
}
