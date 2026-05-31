let audioCtx: AudioContext | null = null;
let audioEnabled = false;

export function setAudioEnabled(enabled: boolean): void {
  audioEnabled = enabled;
}

export function isAudioEnabled(): boolean {
  return audioEnabled;
}

/**
 * Unlock the AudioContext — must be called from a user gesture (click/touch).
 * On iOS Safari, AudioContext starts in 'suspended' state and can only be
 * resumed inside a user gesture handler.
 */
export function unlockAudio(): void {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, volume: number = 0.15, type: OscillatorType = "square"): void {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio not available
  }
}

export function playPaddleHit(): void {
  playTone(440, 0.08, 0.12, "square");
}

export function playWallHit(): void {
  playTone(300, 0.06, 0.1, "square");
}

export function playScore(): void {
  playTone(600, 0.15, 0.12, "square");
  setTimeout(() => playTone(400, 0.2, 0.12, "square"), 100);
}

export function playWin(): void {
  playTone(523, 0.15, 0.15, "square");
  setTimeout(() => playTone(659, 0.15, 0.15, "square"), 150);
  setTimeout(() => playTone(784, 0.3, 0.15, "square"), 300);
}

export function playLose(): void {
  playTone(400, 0.2, 0.12, "square");
  setTimeout(() => playTone(300, 0.2, 0.12, "square"), 200);
  setTimeout(() => playTone(200, 0.4, 0.12, "square"), 400);
}
