import {
  GameState,
  GAME_WIDTH,
  PADDLE_WIDTH,
  PADDLE_HEIGHT,
  BALL_RADIUS,
} from "./types";

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D, _scale: number) {
    this.ctx = ctx;
  }

  draw(state: GameState): void {
    const s = 1; // scaling handled by ctx.setTransform in game loop
    const W = GAME_WIDTH;

    // Background
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, W, W);

    // Center line
    this.ctx.setLineDash([10, 10]);
    this.ctx.strokeStyle = "#444";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, W / 2);
    this.ctx.lineTo(W, W / 2);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Center circle
    this.ctx.strokeStyle = "#333";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(W / 2, W / 2, 50, 0, Math.PI * 2);
    this.ctx.stroke();

    // Scores
    this.ctx.fillStyle = "#888";
    this.ctx.font = "bold 72px monospace";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(String(state.score2), W / 2, W / 2 - 60);
    this.ctx.fillText(String(state.score1), W / 2, W / 2 + 60);

    // Paddle 2 (top — AI / opponent)
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(state.paddle2X, 10, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Paddle 1 (bottom — player)
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(state.paddle1X, GAME_WIDTH - PADDLE_HEIGHT - 10, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Ball
    this.ctx.fillStyle = "#fff";
    this.ctx.beginPath();
    this.ctx.arc(state.ballX, state.ballY, BALL_RADIUS, 0, Math.PI * 2);
    this.ctx.fill();

    // Paused indicator
    if (state.paused) {
      this.ctx.fillStyle = "#666";
      this.ctx.font = "bold 40px monospace";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText("?", W / 2, W / 2);
    }
  }
}
