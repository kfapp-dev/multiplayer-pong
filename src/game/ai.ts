import { GameState, GAME_WIDTH, PADDLE_WIDTH, PADDLE_SPEED, AI_REACTION_DELAY } from "./types";

export class AI {
  private targetX: number = GAME_WIDTH / 2;
  private frameCount: number = 0;
  private predictedBallX: number = GAME_WIDTH / 2;
  private predictionFrames: number = 0;

  reset(): void {
    this.targetX = GAME_WIDTH / 2;
    this.frameCount = 0;
    this.predictedBallX = GAME_WIDTH / 2;
    this.predictionFrames = 0;
  }

  update(state: GameState): number {
    this.frameCount++;

    // Only predict every N frames (simulates delayed reaction)
    if (this.frameCount % AI_REACTION_DELAY === 0 || this.predictionFrames <= 0) {
      // Predict where ball will be when it reaches top paddle level
      if (state.ballVY < 0) {
        // Ball moving toward AI (top)
        const framesToReach = Math.abs((10 + PADDLE_WIDTH / 2 - state.ballY) / state.ballVY);
        let predictedX = state.ballX + state.ballVX * framesToReach;

        // Account for bounces off walls
        while (predictedX < 0 || predictedX > GAME_WIDTH) {
          if (predictedX < 0) predictedX = -predictedX;
          if (predictedX > GAME_WIDTH) predictedX = 2 * GAME_WIDTH - predictedX;
        }

        this.predictedBallX = predictedX;
        this.predictionFrames = AI_REACTION_DELAY;
      } else {
        // Ball moving away, just center up
        this.predictedBallX = GAME_WIDTH / 2;
        this.predictionFrames = AI_REACTION_DELAY * 2;
      }
    }

    this.predictionFrames--;

    // Target is prediction minus half paddle width (center paddle on ball)
    this.targetX = this.predictedBallX - PADDLE_WIDTH / 2;

    // Add slight imperfection
    this.targetX += (Math.random() - 0.5) * 8;

    // Clamp
    this.targetX = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, this.targetX));

    const currentCenter = state.paddle2X + PADDLE_WIDTH / 2;
    const targetCenter = this.targetX + PADDLE_WIDTH / 2;
    const diff = targetCenter - currentCenter;

    const maxMove = PADDLE_SPEED;

    if (Math.abs(diff) <= maxMove) return 0; // already close enough
    return diff > 0 ? 1 : -1;
  }
}
