import {
  GameState,
  GAME_WIDTH,
  GAME_HEIGHT,
  PADDLE_WIDTH,
  PADDLE_HEIGHT,
  BALL_RADIUS,
} from "./types";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale: number;

  constructor(ctx: CanvasRenderingContext2D, scale: number) {
    this.ctx = ctx;
    this.scale = scale;
  }

  clear(): void {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, GAME_WIDTH * this.scale, GAME_HEIGHT * this.scale);
  }

  draw(state: GameState): void {
    const s = this.scale;

    // Background
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, GAME_WIDTH * s, GAME_HEIGHT * s);

    // Center line
    this.ctx.setLineDash([10 * s, 10 * s]);
    this.ctx.strokeStyle = "#444";
    this.ctx.lineWidth = 2 * s;
    this.ctx.beginPath();
    this.ctx.moveTo(0, (GAME_HEIGHT / 2) * s);
    this.ctx.lineTo(GAME_WIDTH * s, (GAME_HEIGHT / 2) * s);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Center circle
    this.ctx.strokeStyle = "#333";
    this.ctx.lineWidth = 2 * s;
    this.ctx.beginPath();
    this.ctx.arc((GAME_WIDTH / 2) * s, (GAME_HEIGHT / 2) * s, 50 * s, 0, Math.PI * 2);
    this.ctx.stroke();

    // Scores
    this.ctx.fillStyle = "#888";
    this.ctx.font = `bold ${72 * s}px monospace`;
    this.ctx.textAlign = "center";
    this.ctx.fillText(String(state.score2), (GAME_WIDTH / 2) * s, (GAME_HEIGHT / 2 - 40) * s);
    this.ctx.fillText(String(state.score1), (GAME_WIDTH / 2) * s, (GAME_HEIGHT / 2 + 90) * s);

    // Paddle 2 (top - AI / opponent)
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(
      state.paddle2X * s,
      10 * s,
      PADDLE_WIDTH * s,
      PADDLE_HEIGHT * s
    );

    // Paddle 1 (bottom - player)
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(
      state.paddle1X * s,
      (GAME_HEIGHT - PADDLE_HEIGHT - 10) * s,
      PADDLE_WIDTH * s,
      PADDLE_HEIGHT * s
    );

    // Ball
    this.ctx.fillStyle = "#fff";
    this.ctx.beginPath();
    this.ctx.arc(state.ballX * s, state.ballY * s, BALL_RADIUS * s, 0, Math.PI * 2);
    this.ctx.fill();

    // Paused "?" indicator
    if (state.paused) {
      this.ctx.fillStyle = "#666";
      this.ctx.font = `bold ${40 * s}px monospace`;
      this.ctx.textAlign = "center";
      this.ctx.fillText("?", (GAME_WIDTH / 2) * s, (GAME_HEIGHT / 2 + 15) * s);
    }
  }
}
