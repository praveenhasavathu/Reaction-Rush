export const TOTAL_ROUNDS = 5;
export const MAX_PLAYERS = 8;
export const ROUND_MIN_DELAY_MS = 2000;
export const ROUND_MAX_DELAY_MS = 6000;
export const CLICK_TIMEOUT_MS = 5000;
export const RESULT_DISPLAY_MS = 3500;
export const RECONNECT_GRACE_MS = 60_000;
export const ROOM_IDLE_TTL_MS = 30 * 60_000;
export const POINTS = [100, 70, 50, 30, 20] as const;

export type Phase = "LOBBY" | "WAITING" | "CLICK" | "RESULT" | "FINISHED";
export type PlayerStatus = "WAITING" | "CLICKED" | "FALSE_START" | "DISCONNECTED";

export interface PlayerPublic {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  status: PlayerStatus;
  reactionTime?: number;
  roundPoints?: number;
}

export interface RoundResultPublic {
  playerId: string;
  nickname: string;
  reactionTime?: number;
  position?: number;
  points: number;
  falseStart: boolean;
  timedOut: boolean;
}

export interface GameState {
  roomCode: string;
  hostPlayerId: string;
  phase: Phase;
  round: number;
  totalRounds: number;
  players: PlayerPublic[];
  roundResults: RoundResultPublic[];
  roundEndsAt?: number;
  clickAt?: number;
  winnerId?: string;
  selfPlayerId?: string;
}
