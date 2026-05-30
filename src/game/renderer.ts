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

    // Paused indicator (drawn in flipped space so it's upright for both views)
    if (state.paused) {
      if (this.flip) {
        // Counter-flip the text so it reads correctly for guest
        ctx.save();
        ctx.scale(1, -1);
        ctx.fillStyle = "#666";
        ctx.font = "bold 40px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", W / 2, -(W / 2));
        ctx.restore();
      } else {
        ctx.fillStyle = "#666";
        ctx.font = "bold 40px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", W / 2, W / 2);
      }
    }

    ctx.restore();

    // Draw scores OUTSIDE the flip transform so text is always upright
    // Host (no flip): score2 (opponent, top) at top, score1 (self, bottom) at bottom
    // Guest (flipped): score2 (self, top in world coords) should appear at bottom of screen,
    //   score1 (opponent) at top — swap positions so "my score is always at bottom"
    ctx.fillStyle = "#888";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (this.flip) {
      ctx.fillText(String(state.score1), W / 2, W / 2 - 60);
      ctx.fillText(String(state.score2), W / 2, W / 2 + 60);
    } else {
      ctx.fillText(String(state.score2), W / 2, W / 2 - 60);
      ctx.fillText(String(state.score1), W / 2, W / 2 + 60);
    }
  }
}
