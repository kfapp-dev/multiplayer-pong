import {
  GameState,
  GAME_WIDTH,
  GAME_HEIGHT,
  PADDLE_WIDTH,
  PADDLE_HEIGHT,
  BALL_RADIUS,
  PADDLE_SPEED,
  INITIAL_BALL_SPEED,
  MAX_BALL_SPEED,
  BALL_SPEED_INCREMENT,
} from "./types";

export function createInitialState(): GameState {
  return {
    ballX: GAME_WIDTH / 2,
    ballY: GAME_HEIGHT / 2,
    ballVX: 0,
    ballVY: 0,
    paddle1X: GAME_WIDTH / 2 - PADDLE_WIDTH / 2,
    paddle2X: GAME_WIDTH / 2 - PADDLE_WIDTH / 2,
    score1: 0,
    score2: 0,
    serving: 1,
    paused: true,
  };
}

export function resetBall(state: GameState): void {
  state.ballX = GAME_WIDTH / 2;
  state.ballY = GAME_HEIGHT / 2;
  const speed = INITIAL_BALL_SPEED;
  const angle = (Math.random() * Math.PI) / 4 - Math.PI / 8; // -22.5 to +22.5 degrees
  state.serving = state.score1 > state.score2 + 2 ? 2 : state.score2 > state.score1 + 2 ? 1 : (Math.random() > 0.5 ? 1 : 2) as 1 | 2;
  const direction = state.serving === 1 ? 1 : -1;
  state.ballVX = Math.sin(angle) * speed;
  state.ballVY = Math.cos(angle) * speed * direction;
}

export function serveBall(state: GameState): void {
  resetBall(state);
  state.paused = false;
}

export function update(
  state: GameState,
  movePaddle1: number, // -1 left, 0 none, +1 right
  movePaddle2: number
): "paddle-hit" | "wall" | "score1" | "score2" | null {
  let soundEvent: "paddle-hit" | "wall" | "score1" | "score2" | null = null;

  // Move paddles
  state.paddle1X = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, state.paddle1X + movePaddle1 * PADDLE_SPEED));
  state.paddle2X = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, state.paddle2X + movePaddle2 * PADDLE_SPEED));

  // Move ball
  state.ballX += state.ballVX;
  state.ballY += state.ballVY;

  // Wall collisions (left/right)
  if (state.ballX - BALL_RADIUS <= 0) {
    state.ballX = BALL_RADIUS;
    state.ballVX = Math.abs(state.ballVX);
    soundEvent = "wall";
  }
  if (state.ballX + BALL_RADIUS >= GAME_WIDTH) {
    state.ballX = GAME_WIDTH - BALL_RADIUS;
    state.ballVX = -Math.abs(state.ballVX);
    soundEvent = "wall";
  }

  // Paddle 1 collision (bottom) - player
  if (
    state.ballVY > 0 &&
    state.ballY + BALL_RADIUS >= GAME_HEIGHT - PADDLE_HEIGHT - 10 &&
    state.ballY + BALL_RADIUS <= GAME_HEIGHT - 8 &&
    state.ballX >= state.paddle1X - 4 &&
    state.ballX <= state.paddle1X + PADDLE_WIDTH + 4
  ) {
    state.ballY = GAME_HEIGHT - PADDLE_HEIGHT - 10 - BALL_RADIUS;
    const hitPos = (state.ballX - state.paddle1X) / PADDLE_WIDTH; // 0 to 1
    const angle = (hitPos - 0.5) * Math.PI * 0.7; // -63 to +63 degrees
    const speed = Math.min(
      Math.sqrt(state.ballVX * state.ballVX + state.ballVY * state.ballVY) + BALL_SPEED_INCREMENT,
      MAX_BALL_SPEED
    );
    state.ballVX = Math.sin(angle) * speed;
    state.ballVY = -Math.cos(angle) * speed;
    soundEvent = "paddle-hit";
  }

  // Paddle 2 collision (top) - opponent / AI
  if (
    state.ballVY < 0 &&
    state.ballY - BALL_RADIUS <= 10 + PADDLE_HEIGHT &&
    state.ballY - BALL_RADIUS >= 8 &&
    state.ballX >= state.paddle2X - 4 &&
    state.ballX <= state.paddle2X + PADDLE_WIDTH + 4
  ) {
    state.ballY = 10 + PADDLE_HEIGHT + BALL_RADIUS;
    const hitPos = (state.ballX - state.paddle2X) / PADDLE_WIDTH;
    const angle = (hitPos - 0.5) * Math.PI * 0.7;
    const speed = Math.min(
      Math.sqrt(state.ballVX * state.ballVX + state.ballVY * state.ballVY) + BALL_SPEED_INCREMENT,
      MAX_BALL_SPEED
    );
    state.ballVX = Math.sin(angle) * speed;
    state.ballVY = Math.cos(angle) * speed;
    soundEvent = "paddle-hit";
  }

  // Score: ball past top
  if (state.ballY < -BALL_RADIUS * 2) {
    state.score1++;
    soundEvent = "score1";
    resetBall(state);
  }

  // Score: ball past bottom
  if (state.ballY > GAME_HEIGHT + BALL_RADIUS * 2) {
    state.score2++;
    soundEvent = "score2";
    resetBall(state);
  }

  return soundEvent;
}
