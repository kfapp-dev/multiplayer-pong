"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameMode,
  WinTarget,
  RoundResult,
  GAME_WIDTH,
  GAME_HEIGHT,
  PADDLE_WIDTH,
} from "@/game/types";
import {
  createInitialState,
  resetBall,
  serveBall,
  update,
} from "@/game/engine";
import { AI } from "@/game/ai";
import { Renderer } from "@/game/renderer";
import {
  playPaddleHit,
  playWallHit,
  playScore,
  playWin,
  playLose,
} from "@/game/sounds";
import { MultiplayerPeer } from "@/multiplayer/peer";

/*
 * Layout: the canvas is always SQUARE (GAME_WIDTH × GAME_WIDTH).
 * GAME_HEIGHT (800) is the internal coordinate space height for game logic,
 * but the visible canvas is square. The rendering code draws the full
 * game field into a square canvas, with the play area taking the full square.
 * This means we clamp the canvas to min(screenW, screenH) so everything fits.
 */

function getCanvasSize(): { size: number; scale: number } {
  if (typeof window === "undefined") return { size: 360, scale: 0.6 };
  // Reserve space for controls on mobile: ~120px for button bar
  const reserved = 120;
  const availableW = window.innerWidth;
  const availableH = window.innerHeight - reserved;
  const maxW = 600;
  const size = Math.min(availableW, availableH, maxW);
  return { size, scale: size / GAME_WIDTH };
}

function isLandscape(): boolean {
  return typeof window !== "undefined" && window.innerWidth > window.innerHeight && window.innerHeight < 400;
}

// ─── Win Target Picker (full-screen overlay) ────────────────────────────

function WinTargetOverlay({
  onSelect,
  onCancel,
}: {
  onSelect: (t: WinTarget) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center px-6 gap-4">
      <p className="text-white font-mono text-xl font-bold">Select Win Target</p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {([3, 7, 15] as WinTarget[]).map((t) => (
          <button
            key={t}
            onClick={() => onSelect(t)}
            className="w-full bg-white text-black font-mono py-4 rounded-xl font-bold text-lg active:bg-gray-300"
          >
            {t === 3 ? "Short — First to 3" : t === 7 ? "Mid — First to 7" : "Classic — First to 15"}
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="text-gray-400 font-mono text-base mt-4 px-8 py-3">
        Cancel
      </button>
    </div>
  );
}

// ─── Multiplayer QR Overlay ─────────────────────────────────────────────

function MultiplayerOverlay({
  hostId,
  onCancel,
}: {
  hostId: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = (typeof window !== "undefined" ? window.location.origin + window.location.pathname : "") + "?join=" + hostId;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}&bgcolor=000000&color=ffffff`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center px-6 gap-5 overflow-y-auto py-8">
      <p className="text-white font-mono text-lg text-center shrink-0">Share with your opponent</p>

      <div className="bg-white rounded-2xl p-3 shrink-0">
        <img src={qrUrl} alt="Scan to join" width={200} height={200} className="block" />
      </div>

      <div className="w-full max-w-sm bg-gray-900 border border-gray-600 rounded-xl p-3 flex items-center gap-3">
        <p className="text-gray-300 font-mono text-xs break-all flex-1 select-all leading-relaxed">{url}</p>
        <button onClick={handleCopy} className="bg-white text-black font-mono text-xs font-bold px-4 py-2 rounded-lg shrink-0 active:bg-gray-300">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <button onClick={onCancel} className="text-gray-400 font-mono text-base mt-2 px-8 py-3 shrink-0">
        Cancel
      </button>
    </div>
  );
}

// ─── Round Over UI ──────────────────────────────────────────────────────

function RoundOverUI({
  result,
  mode,
  onPlayAgain,
  scoreHistory,
  showHistory,
  onToggleHistory,
}: {
  result: RoundResult;
  mode: GameMode;
  onPlayAgain: () => void;
  scoreHistory: RoundResult[];
  showHistory: boolean;
  onToggleHistory: () => void;
}) {
  const iAmPlayer1 = mode !== "multi-guest";
  const iWon = iAmPlayer1 ? result.winner === 1 : result.winner === 2;
  const myScore = iAmPlayer1 ? result.score1 : result.score2;
  const theirScore = iAmPlayer1 ? result.score2 : result.score1;
  const canPlayAgain = mode === "single" || mode === "multi-host";

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4 flex flex-col items-center gap-3 z-40">
      <p className={`font-mono text-2xl font-bold ${iWon ? "text-green-400" : "text-red-400"}`}>
        {iWon ? "You Win" : "You Lose"} {myScore}–{theirScore}
      </p>
      {canPlayAgain && (
        <button onClick={onPlayAgain} className="w-full max-w-xs bg-white text-black font-mono py-3 rounded-xl font-bold active:bg-gray-300">
          Play Again
        </button>
      )}
      {!canPlayAgain && mode === "multi-guest" && (
        <p className="text-gray-500 font-mono text-sm">Waiting for host to start next round…</p>
      )}
      {scoreHistory.length > 1 && (
        <>
          <button onClick={onToggleHistory} className="text-gray-500 font-mono text-xs">
            {showHistory ? "Hide" : "Show"} History ({scoreHistory.length})
          </button>
          {showHistory && (
            <div className="w-full max-w-xs max-h-24 overflow-y-auto">
              {scoreHistory.map((r, i) => {
                const won = iAmPlayer1 ? r.winner === 1 : r.winner === 2;
                return (
                  <div key={i} className="text-gray-400 font-mono text-[11px] py-1 border-b border-gray-800 flex justify-between">
                    <span>R{i + 1}</span>
                    <span>{r.score1}–{r.score2}</span>
                    <span className={won ? "text-green-400" : "text-red-400"}>{won ? "W" : "L"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Disconnected Overlay ───────────────────────────────────────────────

function DisconnectedOverlay({ onBack }: { onBack: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center px-6 gap-4">
      <p className="text-red-400 font-mono text-xl font-bold text-center">Opponent disconnected</p>
      <button onClick={onBack} className="bg-white text-black font-mono py-3 px-8 rounded-xl font-bold active:bg-gray-300">
        Back to Single Player
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createInitialState());
  const keysRef = useRef(new Set<string>());
  const rendererRef = useRef<Renderer | null>(null);
  const rafRef = useRef(0);
  const peerRef = useRef<MultiplayerPeer | null>(null);
  const hostIdRef = useRef("");
  const aiRef = useRef(new AI());
  const modeRef = useRef<GameMode>("single");

  // Paddle position tracked separately for direct touch control
  const paddleXRef = useRef(GAME_WIDTH / 2 - PADDLE_WIDTH / 2);
  // For relative touch tracking
  const lastTouchXRef = useRef<number | null>(null);

  const [mode, setMode] = useState<GameMode>("single");
  const [landscape, setLandscape] = useState(false);
  const [showWinTarget, setShowWinTarget] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [winTarget, setWinTarget] = useState<WinTarget | null>(null);
  const [roundOver, setRoundOver] = useState<RoundResult | null>(null);
  const [scoreHistory, setScoreHistory] = useState<RoundResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [canvasSize, setCanvasSize] = useState(getCanvasSize);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ── Init single player ──────────────────────────────────────────────
  const initSinglePlayer = useCallback(() => {
    if (peerRef.current) { peerRef.current.disconnect(); peerRef.current = null; }
    hostIdRef.current = "";
    const state = createInitialState();
    stateRef.current = state;
    aiRef.current = new AI();
    serveBall(state);
    setMode("single");
    modeRef.current = "single";
    setShowWinTarget(false);
    setShowQR(false);
    setRoundOver(null);
    setDisconnected(false);
    setWinTarget(null);
    setScoreHistory([]);
    setShowHistory(false);
  }, []);

  // ── Start hosting ───────────────────────────────────────────────────
  const handleSelectTarget = useCallback(async (target: WinTarget) => {
    setWinTarget(target);
    setShowWinTarget(false);

    const state = createInitialState();
    stateRef.current = state;
    aiRef.current = new AI();

    const peer = new MultiplayerPeer();
    peerRef.current = peer;
    setMode("multi-host");
    modeRef.current = "multi-host";
    setDisconnected(false);
    setRoundOver(null);
    setScoreHistory([]);

    peer.onMessage((msg: { type: string; [key: string]: unknown }) => {
      if (msg.type === "ready") {
        serveBall(stateRef.current);
        peer.sendState(stateRef.current);
      }
      if (msg.type === "input" && msg.paddleX !== undefined) {
        stateRef.current.paddle2X = msg.paddleX as number;
      }
    });

    peer.onStatus((status: string) => {
      if (status === "disconnected") {
        setDisconnected(true);
      }
      if (status === "error") {
        // Keep showing QR, let user cancel
      }
    });

    try {
      const id = await peer.createHost();
      hostIdRef.current = id;
      peer.sendWinTarget(target);
      // Now show the QR overlay
      setShowQR(true);
    } catch (err: unknown) {
      setShowQR(false);
      // Fall back to single player on error
      setShowWinTarget(true);
    }
  }, []);

  // ── Join host ───────────────────────────────────────────────────────
  const joinMultiplayer = useCallback(async (joinHostId: string) => {
    const state = createInitialState();
    stateRef.current = state;
    setMode("multi-guest");
    modeRef.current = "multi-guest";
    setDisconnected(false);
    setRoundOver(null);
    setScoreHistory([]);

    const peer = new MultiplayerPeer();
    peerRef.current = peer;

    peer.onMessage((msg: { type: string; [key: string]: unknown }) => {
      const s = stateRef.current;
      switch (msg.type) {
        case "state":
          if (msg.state) {
            const myPaddle2 = s.paddle2X;
            Object.assign(s, msg.state);
            s.paddle2X = myPaddle2;
            if (s.ballVX !== 0 || s.ballVY !== 0) s.paused = false;
          }
          break;
        case "win-target":
          if (msg.winTarget) setWinTarget(msg.winTarget as WinTarget);
          break;
        case "round-over":
          if (msg.winner !== undefined && msg.score1 !== undefined && msg.score2 !== undefined) {
            const result: RoundResult = { winner: msg.winner as 1 | 2, score1: msg.score1 as number, score2: msg.score2 as number };
            setRoundOver(result);
            setScoreHistory((prev) => [...prev, result]);
            s.paused = true;
            if (msg.winner === 2) playWin(); else playLose();
          }
          break;
        case "play-again":
          s.score1 = 0; s.score2 = 0; s.paused = false;
          resetBall(s); setRoundOver(null);
          break;
      }
    });

    peer.onStatus((status: string) => {
      if (status === "connected") { peer.sendReady(); }
      if (status === "disconnected") { setDisconnected(true); }
    });

    try {
      await peer.joinHost(joinHostId);
    } catch {
      setDisconnected(true);
    }
  }, []);

  // ── Play again ─────────────────────────────────────────────────────
  const handlePlayAgain = useCallback(() => {
    const s = stateRef.current;
    s.score1 = 0; s.score2 = 0; s.paused = false;
    resetBall(s);
    setRoundOver(null);
    peerRef.current?.send({ type: "play-again" } as import("@/game/types").MultiplayerMessage);
  }, []);

  // ── Initial serve ──────────────────────────────────────────────────
  useEffect(() => {
    serveBall(stateRef.current);
  }, []);

  // ── Join via URL ───────────────────────────────────────────────────
  useEffect(() => {
    const joinId = new URLSearchParams(window.location.search).get("join");
    if (joinId) joinMultiplayer(joinId);
  }, [joinMultiplayer]);

  // ── Game loop ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { size, scale } = canvasSize;
    canvas.width = size;
    canvas.height = size;
    rendererRef.current = new Renderer(ctx, scale);

    let running = true;

    const loop = () => {
      if (!running) return;

      const state = stateRef.current;
      state.paddle1X = paddleXRef.current; // Always sync from touch ref

      if (state.paused) {
        rendererRef.current?.draw(state);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const keys = keysRef.current;
      let moveP1 = 0;
      let moveP2 = 0;

      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) moveP1 = -1;
      else if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) moveP1 = 1;

      const m = modeRef.current;
      if (m === "single") {
        moveP2 = aiRef.current.update(state);
      } else if (m === "multi-host") {
        moveP2 = 0;
        peerRef.current?.sendState(state);
      } else if (m === "multi-guest") {
        moveP1 = 0;
        peerRef.current?.sendInput(state.paddle2X);
      }

      const soundEvent = update(state, moveP1, moveP2);
      switch (soundEvent) {
        case "paddle-hit": playPaddleHit(); break;
        case "wall": playWallHit(); break;
        case "score1": case "score2": playScore(); break;
      }

      // Sync paddle back from engine (in case engine clamped it)
      paddleXRef.current = state.paddle1X;

      if (winTarget && !roundOver) {
        const gameOver = state.score1 >= winTarget || state.score2 >= winTarget;
        if (gameOver) {
          const winner: 1 | 2 = state.score1 >= winTarget ? 1 : 2;
          const result: RoundResult = { winner, score1: state.score1, score2: state.score2 };
          setRoundOver(result);
          setScoreHistory((prev) => [...prev, result]);
          state.paused = true;
          if (m === "single") { playLose(); }
          else if (m === "multi-host") {
            peerRef.current?.sendRoundOver(winner, state.score1, state.score2);
            winner === 1 ? playWin() : playLose();
          } else {
            winner === 2 ? playWin() : playLose();
          }
        }
      }

      rendererRef.current?.draw(state);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [canvasSize, winTarget, roundOver]);

  // ── Keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current.add(e.key); };
    const up = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ── Resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      setCanvasSize(getCanvasSize());
      setLandscape(isLandscape());
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Touch on whole screen ──────────────────────────────────────────
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      lastTouchXRef.current = e.touches[0].clientX;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (lastTouchXRef.current === null) return;
      const t = e.touches[0];
      // Relative movement: diff controls paddle velocity
      const diff = t.clientX - lastTouchXRef.current;
      const sensitivity = 0.02; // pixels → game units
      const s = stateRef.current;
      s.paddle1X = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, s.paddle1X + diff * sensitivity));
      paddleXRef.current = s.paddle1X;
      lastTouchXRef.current = t.clientX;
    };
    const onTouchEnd = () => { lastTouchXRef.current = null; };

    // Attach to window for whole-screen touch
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────
  if (landscape) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-white text-2xl font-mono font-bold px-8 text-center">Portrait mode only</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black flex flex-col overflow-hidden">
      {/* Overlays */}
      {showWinTarget && !showQR && (
        <WinTargetOverlay
          onSelect={handleSelectTarget}
          onCancel={() => setShowWinTarget(false)}
        />
      )}
      {showQR && (
        <MultiplayerOverlay
          hostId={hostIdRef.current}
          onCancel={() => { setShowQR(false); initSinglePlayer(); }}
        />
      )}
      {disconnected && !showQR && (
        <DisconnectedOverlay onBack={initSinglePlayer} />
      )}
      {roundOver && !showQR && (
        <RoundOverUI
          result={roundOver}
          mode={mode}
          onPlayAgain={handlePlayAgain}
          scoreHistory={scoreHistory}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(!showHistory)}
        />
      )}

      {/* Controls ABOVE canvas */}
      {mode === "single" && !showWinTarget && !showQR && (
        <div className="w-full flex justify-center py-3 shrink-0">
          <button
            onClick={() => setShowWinTarget(true)}
            className="bg-white text-black font-mono text-lg py-3 px-8 rounded-xl font-bold active:bg-gray-300"
          >
            Start Multiplayer Session
          </button>
        </div>
      )}

      {/* Square game canvas — fills remaining space */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block"
          style={{ touchAction: "none" }}
        />
      </div>
    </div>
  );
}
