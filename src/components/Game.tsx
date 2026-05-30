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

// ─── helpers ──────────────────────────────────────────────────────────
function getCanvasDimensions(): { canvasW: number; canvasH: number; scale: number } {
  const maxW = 600;
  const vw = typeof window !== "undefined" ? Math.min(window.innerWidth, maxW) : 360;
  const aspect = GAME_HEIGHT / GAME_WIDTH;
  return { canvasW: vw, canvasH: vw * aspect, scale: vw / GAME_WIDTH };
}

function isLandscapeMode(): boolean {
  return typeof window !== "undefined" && window.innerWidth > window.innerHeight && window.innerHeight < 400;
}

// ─── sub-component: Multiplayer Overlay ────────────────────────────────

function MultiplayerOverlay({
  hostId,
  onCancel,
}: {
  hostId: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = (typeof window !== "undefined" ? window.location.origin + window.location.pathname : "") + "?join=" + hostId;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&bgcolor=000000&color=ffffff`;

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
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50 px-4 gap-4 overflow-y-auto">
      <p className="text-white font-mono text-base text-center shrink-0">Share with your opponent</p>
      <div className="bg-white rounded-xl p-2 shrink-0">
        <img src={qrUrl} alt="Scan to join" width={180} height={180} className="block" />
      </div>
      <div className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 flex items-center gap-2">
        <p className="text-gray-300 font-mono text-[10px] break-all flex-1 leading-relaxed select-all">{url}</p>
        <button onClick={handleCopy} className="bg-white text-black font-mono text-xs font-bold px-3 py-1.5 rounded-lg active:bg-gray-300 shrink-0">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <button onClick={onCancel} className="text-gray-500 font-mono text-sm px-6 py-2 shrink-0">
        Cancel
      </button>
    </div>
  );
}

// ─── sub-component: Win Target Picker ──────────────────────────────────

function WinTargetPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (t: WinTarget) => void;
  onCancel: () => void;
}) {
  return (
    <div className="w-full bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col items-center gap-3">
      <p className="text-white font-mono text-base font-bold">Win Target</p>
      <div className="flex flex-col gap-2 w-full">
        {([3, 7, 15] as WinTarget[]).map((t) => (
          <button
            key={t}
            onClick={() => onSelect(t)}
            className="w-full bg-gray-800 text-white font-mono py-2.5 rounded-lg active:bg-gray-600 transition-colors border border-gray-600 text-sm"
          >
            {t === 3 ? "Short — First to 3" : t === 7 ? "Mid — First to 7" : "Classic — First to 15"}
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="text-gray-500 font-mono text-xs mt-1 py-1">
        Cancel
      </button>
    </div>
  );
}

// ─── sub-component: Round Over UI ──────────────────────────────────────

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
    <div className="w-full bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col items-center gap-3">
      <p className={`font-mono text-xl font-bold ${iWon ? "text-green-400" : "text-red-400"}`}>
        {iWon ? "You Win" : "You Lose"} {myScore}&ndash;{theirScore}
      </p>
      {canPlayAgain && (
        <button onClick={onPlayAgain} className="w-full bg-white text-black font-mono py-2.5 rounded-lg font-bold active:bg-gray-300">
          Play Again
        </button>
      )}
      {!canPlayAgain && mode === "multi-guest" && (
        <p className="text-gray-500 font-mono text-sm text-center">Waiting for host to start next round&hellip;</p>
      )}
      {scoreHistory.length > 1 && (
        <>
          <button onClick={onToggleHistory} className="text-gray-500 font-mono text-xs">
            {showHistory ? "Hide" : "Show"} History ({scoreHistory.length} rounds)
          </button>
          {showHistory && (
            <div className="w-full max-h-32 overflow-y-auto px-1">
              {scoreHistory.map((r, i) => {
                const won = iAmPlayer1 ? r.winner === 1 : r.winner === 2;
                return (
                  <div key={i} className="text-gray-400 font-mono text-[11px] py-1 border-b border-gray-800 flex justify-between">
                    <span>R{i + 1}</span>
                    <span>{r.score1}&ndash;{r.score2}</span>
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

// ─── main component ────────────────────────────────────────────────────

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createInitialState());
  const keysRef = useRef(new Set<string>());
  const rendererRef = useRef<Renderer | null>(null);
  const rafRef = useRef(0);
  const peerRef = useRef<MultiplayerPeer | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const hostIdRef = useRef("");
  const aiInstanceRef = useRef(new AI());
  const modeRef = useRef<GameMode>("single");

  const [mode, setMode] = useState<GameMode>("single");
  const [landscape, setLandscape] = useState(false);
  const [mpStatus, setMpStatus] = useState("");
  const [mpConnected, setMpConnected] = useState(false);
  const [hostId, setHostId] = useState("");
  const [, forceRender] = useState(0);

  const [showWinTarget, setShowWinTarget] = useState(false);
  const [winTarget, setWinTarget] = useState<WinTarget | null>(null);
  const [roundOver, setRoundOver] = useState<RoundResult | null>(null);
  const [scoreHistory, setScoreHistory] = useState<RoundResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [canvasDims, setCanvasDims] = useState(getCanvasDimensions);

  // Keep modeRef in sync
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ── init single player ──────────────────────────────────────────────
  const initSinglePlayer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.disconnect();
      peerRef.current = null;
    }
    hostIdRef.current = "";
    const state = createInitialState();
    stateRef.current = state;
    aiInstanceRef.current = new AI();
    serveBall(state); // <-- THIS starts the ball moving
    setMode("single");
    modeRef.current = "single";
    setMpConnected(false);
    setRoundOver(null);
    setDisconnected(false);
    setWinTarget(null);
    setShowHistory(false);
    setMpStatus("");
  }, []);

  // ── start hosting ───────────────────────────────────────────────────
  const handleStartHost = useCallback(async (target: WinTarget) => {
    setWinTarget(target);
    setShowWinTarget(false);

    const state = createInitialState();
    stateRef.current = state;
    aiInstanceRef.current = new AI();

    const peer = new MultiplayerPeer();
    peerRef.current = peer;
    setMode("multi-host");
    modeRef.current = "multi-host";
    setMpStatus("Creating session...");
    setDisconnected(false);
    setRoundOver(null);
    setScoreHistory([]);

    peer.onMessage((msg: { type: string; [key: string]: unknown }) => {
      if (msg.type === "ready") {
        // Guest has connected and is ready — serve the ball
        serveBall(stateRef.current);
        peer.sendState(stateRef.current);
      }
      if (msg.type === "input" && msg.paddleX !== undefined) {
        stateRef.current.paddle2X = msg.paddleX as number;
      }
    });

    peer.onStatus((status: string) => {
      if (status === "connected") {
        setMpConnected(true);
        setMpStatus("");
      }
      if (status === "disconnected") {
        setDisconnected(true);
        setMpConnected(false);
        setMpStatus("Opponent disconnected");
      }
      if (status === "error") {
        setMpStatus("Error creating session");
      }
    });

    try {
      const id = await peer.createHost();
      hostIdRef.current = id;
      setHostId(id);
      peer.sendWinTarget(target);
      forceRender((n) => n + 1);
      setMpStatus("Share the URL or QR code");
    } catch (err: unknown) {
      setMpStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // ── join host ───────────────────────────────────────────────────────
  const joinMultiplayer = useCallback(async (joinHostId: string) => {
    const state = createInitialState();
    stateRef.current = state;
    setMode("multi-guest");
    modeRef.current = "multi-guest";
    setMpStatus("Joining session...");
    setDisconnected(false);
    setRoundOver(null);
    setScoreHistory([]);

    const peer = new MultiplayerPeer();
    peerRef.current = peer;

    peer.onMessage((msg: { type: string; [key: string]: unknown }) => {
      const s = stateRef.current;
      switch (msg.type) {
        case "state": {
          if (msg.state) {
            const myPaddle2 = s.paddle2X;
            Object.assign(s, msg.state);
            s.paddle2X = myPaddle2;
            if (s.ballVX !== 0 || s.ballVY !== 0) s.paused = false;
          }
          break;
        }
        case "win-target": {
          if (msg.winTarget) setWinTarget(msg.winTarget as WinTarget);
          break;
        }
        case "round-over": {
          if (msg.winner !== undefined && msg.score1 !== undefined && msg.score2 !== undefined) {
            const result: RoundResult = { winner: msg.winner as 1 | 2, score1: msg.score1 as number, score2: msg.score2 as number };
            setRoundOver(result);
            setScoreHistory((prev) => [...prev, result]);
            s.paused = true;
            if (msg.winner === 2) playWin(); else playLose();
          }
          break;
        }
        case "play-again": {
          s.score1 = 0;
          s.score2 = 0;
          s.paused = false;
          resetBall(s);
          setRoundOver(null);
          break;
        }
      }
    });

    peer.onStatus((status: string) => {
      if (status === "connected") {
        setMpConnected(true);
        setMpStatus("");
        peer.sendReady();
      }
      if (status === "disconnected") {
        setDisconnected(true);
        setMpStatus("Host disconnected");
      }
      if (status === "error") {
        setMpStatus("Error joining session");
      }
    });

    try {
      await peer.joinHost(joinHostId);
    } catch (err: unknown) {
      setMpStatus(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      setDisconnected(true);
    }
  }, []);

  // ── cancel MP ───────────────────────────────────────────────────────
  const cancelMultiplayer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.disconnect();
      peerRef.current = null;
    }
    hostIdRef.current = "";
    setHostId("");
    initSinglePlayer();
  }, [initSinglePlayer]);

  // ── play again ─────────────────────────────────────────────────────
  const handlePlayAgain = useCallback(() => {
    const s = stateRef.current;
    s.score1 = 0;
    s.score2 = 0;
    s.paused = false;
    resetBall(s);
    setRoundOver(null);
    peerRef.current?.send({ type: "play-again" } as import("@/game/types").MultiplayerMessage);
  }, []);

  // ── initial serve on mount ─────────────────────────────────────────
  useEffect(() => {
    // Serve ball immediately when component mounts for single player
    const state = stateRef.current;
    if (state.paused) {
      serveBall(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── check URL for ?join= ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get("join");
    if (joinId) joinMultiplayer(joinId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── game loop ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dims = canvasDims;
    canvas.width = dims.canvasW;
    canvas.height = dims.canvasH;
    rendererRef.current = new Renderer(ctx, dims.scale);

    let running = true;

    const loop = () => {
      if (!running) return;

      const state = stateRef.current;
      if (state.paused) {
        rendererRef.current?.draw(state);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const keys = keysRef.current;
      let moveP1 = 0;
      let moveP2 = 0;

      // Bottom paddle (player 1 = local)
      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) moveP1 = -1;
      else if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) moveP1 = 1;

      const currentMode = modeRef.current;

      if (currentMode === "single") {
        moveP2 = aiInstanceRef.current.update(state);
      } else if (currentMode === "multi-host") {
        moveP2 = 0;
        peerRef.current?.sendState(state);
      } else if (currentMode === "multi-guest") {
        moveP1 = 0;
        peerRef.current?.sendInput(state.paddle2X);
      }

      const soundEvent = update(state, moveP1, moveP2);

      switch (soundEvent) {
        case "paddle-hit": playPaddleHit(); break;
        case "wall": playWallHit(); break;
        case "score1": case "score2": playScore(); break;
      }

      // Win check
      const currentWinTarget = winTarget;
      const currentRoundOver = roundOver;
      if (currentWinTarget && !currentRoundOver) {
        const gameOver = state.score1 >= currentWinTarget || state.score2 >= currentWinTarget;
        if (gameOver) {
          const winner: 1 | 2 = state.score1 >= currentWinTarget ? 1 : 2;
          const result: RoundResult = { winner, score1: state.score1, score2: state.score2 };
          setRoundOver(result);
          setScoreHistory((prev) => [...prev, result]);
          state.paused = true;

          if (currentMode === "single") {
            playLose();
          } else if (currentMode === "multi-host") {
            peerRef.current?.sendRoundOver(winner, state.score1, state.score2);
            if (winner === 1) playWin(); else playLose();
          } else if (currentMode === "multi-guest") {
            if (winner === 2) playWin(); else playLose();
          }
        }
      }

      rendererRef.current?.draw(state);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [canvasDims, winTarget, roundOver]);

  // ── keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── resize / orientation ───────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      setCanvasDims(getCanvasDimensions());
      setLandscape(isLandscapeMode());
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── touch: direct paddle control via non-passive listener ──────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      touchStartXRef.current = e.touches[0].clientX;
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Now safe — listener is non-passive
      const cvs = canvasRef.current;
      if (!cvs || touchStartXRef.current === null) return;
      const t = e.touches[0];
      const rect = cvs.getBoundingClientRect();
      const touchXInCanvas = t.clientX - rect.left;
      const s = stateRef.current;
      const dims = canvasDims;
      const targetCenter = (touchXInCanvas / (GAME_WIDTH * dims.scale)) * GAME_WIDTH;
      s.paddle1X = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, targetCenter - PADDLE_WIDTH / 2));
      touchStartXRef.current = t.clientX;
    };

    const onTouchEnd = () => {
      touchStartXRef.current = null;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [canvasDims]);

  // ── landscape warning ──────────────────────────────────────────────
  if (landscape) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-white text-2xl font-mono font-bold px-8 text-center">Portrait mode only</p>
      </div>
    );
  }

  const showOverlay = mode === "multi-host" && !mpConnected && hostId.length > 0;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center overflow-hidden">
      {showOverlay && (
        <MultiplayerOverlay hostId={hostId} onCancel={cancelMultiplayer} />
      )}

      <canvas
        ref={canvasRef}
        className="block shrink-0"
        style={{ touchAction: "none" }}
      />

      <div className="w-full max-w-[600px] px-4 pb-4 flex flex-col items-center gap-2 shrink-0">
        {mpStatus && <p className="text-yellow-400 text-xs font-mono text-center">{mpStatus}</p>}

        {mode === "single" && (
          <button
            onClick={() => setShowWinTarget(true)}
            className="w-full bg-white text-black font-mono text-base py-2.5 rounded-lg font-bold active:bg-gray-300 transition-colors"
          >
            Start Multiplayer Session
          </button>
        )}

        {showWinTarget && (
          <WinTargetPicker
            onSelect={handleStartHost}
            onCancel={() => setShowWinTarget(false)}
          />
        )}

        {roundOver && (
          <RoundOverUI
            result={roundOver}
            mode={mode}
            onPlayAgain={handlePlayAgain}
            scoreHistory={scoreHistory}
            showHistory={showHistory}
            onToggleHistory={() => setShowHistory(!showHistory)}
          />
        )}

        {disconnected && (
          <div className="w-full bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col items-center gap-3">
            <p className="text-red-400 font-mono text-center font-bold">Opponent disconnected</p>
            <button
              onClick={initSinglePlayer}
              className="w-full bg-white text-black font-mono py-2.5 rounded-lg font-bold active:bg-gray-300"
            >
              Back to Single Player
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
