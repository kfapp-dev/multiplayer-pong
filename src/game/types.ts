export const GAME_WIDTH = 600;
export const GAME_HEIGHT = 600; // Square canvas
export const PADDLE_WIDTH = 100;
export const PADDLE_HEIGHT = 14;
export const BALL_RADIUS = 8;
export const PADDLE_SPEED = 8;
export const INITIAL_BALL_SPEED = 5;
export const MAX_BALL_SPEED = 12;
export const BALL_SPEED_INCREMENT = 0.3;
export const AI_REACTION_DELAY = 8;

export type GameMode = "single" | "multi-host" | "multi-guest";
export type WinTarget = 3 | 7 | 15;

export interface GameState {
  ballX: number;
  ballY: number;
  ballVX: number;
  ballVY: number;
  paddle1X: number; // player 1 (bottom)
  paddle2X: number; // player 2 / AI (top)
  score1: number;
  score2: number;
  serving: 1 | 2;
  paused: boolean;
}

export interface RoundResult {
  winner: 1 | 2;
  score1: number;
  score2: number;
}

export interface MultiplayerMessage {
  type: string;
  [key: string]: unknown;
}
