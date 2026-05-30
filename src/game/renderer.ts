import {
  GameState,
  GAME_WIDTH,
  PADDLE_WIDTH,
  PADDLE_HEIGHT,
  BALL_RADIUS,
} from "./types";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private flip: boolean;

  constructor(ctx: CanvasRenderingContext2D, _scale: number, flip: boolean = false) {
    this.ctx = ctx;
    this.flip = flip;
  }

  draw(state: GameState): void {
    const W = GAME_WIDTH;
    const ctx = this.ctx;

    ctx.save();

    // If flip, mirror vertically around centre so guest sees own paddle at bottom
    if (this.flip) {
      ctx.translate(0, W);
      ctx.scale(1, -1);
    }

    // Background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, W);

    // Center line
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, W / 2);
    ctx.lineTo(W, W / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Scores — in flipped view, score positions are mirrored so they read correctly
    ctx.fillStyle = "#888";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // score2 (opponent) shown at top, score1 (self) at bottom — same positions, just flipped
    ctx.fillText(String(state.score2), W / 2, W / 2 - 60);
    ctx.fillText(String(state.score1), W / 2, W / 2 + 60);

    // Paddle 2 (top — opponent in host view, self in guest view)
    ctx.fillStyle = "#fff";
    ctx.fillRect(state.paddle2X, 10, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Paddle 1 (bottom — self in host view, opponent in guest view)
    ctx.fillStyle = "#fff";
    ctx.fillRect(state.paddle1X, GAME_WIDTH - PADDLE_HEIGHT - 10, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Ball
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Paused indicator
    if (state.paused) {
      ctx.fillStyle = "#666";
      ctx.font = "bold 40px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", W / 2, W / 2);
    }

    ctx.restore();
  }
}
