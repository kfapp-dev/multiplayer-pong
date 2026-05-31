"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameMode,
  WinTarget,
  RoundResult,
  GAME_WIDTH,
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
  setAudioEnabled,
  unlockAudio,
} from "@/game/sounds";
import { MultiplayerPeer } from "@/multiplayer/peer";

function isLandscape(): boolean {
  return typeof window !== "undefined" && window.innerWidth > window.innerHeight && window.innerHeight < 400;
}

function log(tag: string, ...args: unknown[]) {
  console.log(`[pong:${tag}]`, ...args);
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
  connStatus,
}: {
  hostId: string;
  onCancel: () => void;
  connStatus: string;
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
      {connStatus && (
        <p className="text-yellow-400 font-mono text-sm text-center shrink-0">{connStatus}</p>
      )}
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
  const iAmHost = mode !== "multi-guest";
  const iWon = iAmHost ? result.winner === 1 : result.winner === 2;
  const myScore = iAmHost ? result.score1 : result.score2;
  const theirScore = iAmHost ? result.score2 : result.score1;
  const canPlayAgain = mode === "single" || mode === "multi-host";

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4 flex flex-col items-center gap-3 z-40">
      <p className={`font-mono text-2xl font-bold ${iWon ? "text-green-400" : "text-red-400"}`}>
        {iWon ? "You Win" : "You Lose"} {myScore}&ndash;{theirScore}
      </p>
      {canPlayAgain && (
        <button onClick={onPlayAgain} className="w-full max-w-xs bg-white text-black font-mono py-3 rounded-xl font-bold active:bg-gray-300">
          Play Again
        </button>
      )}
      {!canPlayAgain && mode === "multi-guest" && (
        <p className="text-gray-500 font-mono text-sm">Waiting for host to start next round&hellip;</p>
      )}
      {scoreHistory.length > 1 && (
        <>
          <button onClick={onToggleHistory} className="text-gray-500 font-mono text-xs">
            {showHistory ? "Hide" : "Show"} History ({scoreHistory.length})
          </button>
          {showHistory && (
            <div className="w-full max-w-xs max-h-24 overflow-y-auto">
              {scoreHistory.map((r, i) => {
                const won = iAmHost ? r.winner === 1 : r.winner === 2;
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
  const paddleXRef = useRef(GAME_WIDTH / 2 - PADDLE_WIDTH / 2);
  const prevScoreRef = useRef({ score1: 0, score2: 0 });
  const isGuestRef = useRef(false);

  const [mode, setMode] = useState<GameMode>("single");
  const [landscape, setLandscape] = useState(false);
  const [showWinTarget, setShowWinTarget] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [winTarget, setWinTarget] = useState<WinTarget | null>(null);
  const [roundOver, setRoundOver] = useState<RoundResult | null>(null);
  const [scoreHistory, setScoreHistory] = useState<RoundResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [connStatus, setConnStatus] = useState("");
  const [micEnabled, setMicEnabled] = useState(false);
  const [remoteVoiceActive, setRemoteVoiceActive] = useState(false);
  const [audioEnabled, setAudioEnabledState] = useState(false);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  const toggleAudio = useCallback(() => {
    // Resume/unlock AudioContext on user gesture (required for iOS Safari)
    unlockAudio();
    setAudioEnabledState((prev) => {
      const next = !prev;
      setAudioEnabled(next);
      return next;
    });
  }, []);

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
    isGuestRef.current = false;
    setShowWinTarget(false);
    setShowQR(false);
    setRoundOver(null);
    setDisconnected(false);
    setWinTarget(null);
    setScoreHistory([]);
    setShowHistory(false);
    setConnStatus("");
    setMicEnabled(false);
    setRemoteVoiceActive(false);
    setAudioEnabledState(false);
    setAudioEnabled(false);
  }, []);

  // ── Start hosting ───────────────────────────────────────────────────
  const handleSelectTarget = useCallback(async (target: WinTarget) => {
    setWinTarget(target);
    setShowWinTarget(false);
    setConnStatus("Connecting to signaling server...");

    const state = createInitialState();
    stateRef.current = state;
    aiRef.current = new AI();
    isGuestRef.current = false;

    const peer = new MultiplayerPeer();
    peerRef.current = peer;
    setMode("multi-host");
    modeRef.current = "multi-host";
    setDisconnected(false);
    setRoundOver(null);
    setScoreHistory([]);

    peer.onMessage((msg: { type: string; [key: string]: unknown }) => {
      if (msg.type === "ready") {
        log("onMessage", "guest ready, serving ball");
        serveBall(stateRef.current);
      }
      if (msg.type === "input" && msg.paddleX !== undefined) {
        stateRef.current.paddle2X = msg.paddleX as number;
      }
    });

    peer.onConnect(() => {
      log("onConnect", "guest connected!");
      setConnStatus("Guest connected!");
      setShowQR(false);
    });

    peer.onStatus((status: string) => {
      log("onStatus", status);
      if (status === "connected") setConnStatus("Connected — waiting for guest...");
      if (status === "disconnected") { setDisconnected(true); setConnStatus(""); setMicEnabled(false); setRemoteVoiceActive(false); }
      if (status === "error") { setConnStatus("Connection error — check console"); }
    });

    peer.onVoiceTrack((_stream: MediaStream) => {
      log("onVoiceTrack", "remote voice stream received");
      setRemoteVoiceActive(true);
    });

    try {
      const id = await peer.createHost();
      hostIdRef.current = id;
      log("createHost", "host id:", id);
      peer.sendWinTarget(target);
      setConnStatus("Connected — waiting for guest to join...");
      setShowQR(true);
    } catch (err) {
      log("createHost", "error:", err);
      setConnStatus("Failed to create session: " + (err instanceof Error ? err.message : String(err)));
      setShowQR(false);
      setShowWinTarget(true);
    }
  }, []);

  // ── Join host ───────────────────────────────────────────────────────
  const joinMultiplayer = useCallback(async (joinHostId: string) => {
    const state = createInitialState();
    stateRef.current = state;
    prevScoreRef.current = { score1: 0, score2: 0 };
    isGuestRef.current = true;

    setMode("multi-guest");
    modeRef.current = "multi-guest";
    setDisconnected(false);
    setRoundOver(null);
    setScoreHistory([]);
    setConnStatus("Connecting to host...");

    const peer = new MultiplayerPeer();
    peerRef.current = peer;

    peer.onMessage((msg: { type: string; [key: string]: unknown }) => {
      const s = stateRef.current;
      switch (msg.type) {
        case "state": {
          if (msg.state) {
            // Guest: don't overwrite paddle2X — local touch is authoritative
            const savedPaddle2X = s.paddle2X;
            Object.assign(s, msg.state);
            s.paddle2X = savedPaddle2X;
            if (s.score1 > prevScoreRef.current.score1) playScore();
            if (s.score2 > prevScoreRef.current.score2) playScore();
            prevScoreRef.current = { score1: s.score1, score2: s.score2 };
          }
          break;
        }
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
          resetBall(s);
          setRoundOver(null);
          prevScoreRef.current = { score1: 0, score2: 0 };
          break;
      }
    });

    peer.onConnect(() => {
      log("joinHost onConnect", "connected to host!");
      setConnStatus("Connected to host!");
      peer.sendReady();
    });

    peer.onStatus((status: string) => {
      log("joinHost onStatus", status);
      if (status === "connected") setConnStatus("Connected to signaling server, opening data channel...");
      if (status === "disconnected") { setDisconnected(true); setConnStatus(""); setMicEnabled(false); setRemoteVoiceActive(false); }
      if (status === "error") { setConnStatus("Connection error — check console"); }
    });

    peer.onVoiceTrack((_stream: MediaStream) => {
      log("joinHost onVoiceTrack", "remote voice stream received");
      setRemoteVoiceActive(true);
    });

    try {
      await peer.joinHost(joinHostId);
      log("joinHost", "data channel open!");
    } catch (err) {
      log("joinHost", "error:", err);
      setConnStatus("Failed to connect: " + (err instanceof Error ? err.message : String(err)));
      setDisconnected(true);
    }
  }, []);

  // ── Play again (host only) ─────────────────────────────────────────
  const handlePlayAgain = useCallback(() => {
    const s = stateRef.current;
    s.score1 = 0; s.score2 = 0; s.paused = false;
    resetBall(s);
    setRoundOver(null);
    peerRef.current?.sendPlayAgain();
  }, []);

  // ── Initial serve ──────────────────────────────────────────────────
  useEffect(() => { serveBall(stateRef.current); }, []);

  // ── Join via URL ───────────────────────────────────────────────────
  useEffect(() => {
    const joinId = new URLSearchParams(window.location.search).get("join");
    if (joinId) joinMultiplayer(joinId);
  }, [joinMultiplayer]);

  // ── Host game loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "multi-host") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const loop = () => {
      if (!running) return;
      const state = stateRef.current;
      state.paddle1X = paddleXRef.current;

      if (state.paused) {
        rendererRef.current?.draw(state);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const keys = keysRef.current;
      let moveP1 = 0;
      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) moveP1 = -1;
      else if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) moveP1 = 1;

      const soundEvent = update(state, moveP1, 0);
      switch (soundEvent) {
        case "paddle-hit": playPaddleHit(); break;
        case "wall": playWallHit(); break;
        case "score1": case "score2": playScore(); break;
      }

      paddleXRef.current = state.paddle1X;
      peerRef.current?.sendState(state);

      if (winTarget && !roundOver) {
        const gameOver = state.score1 >= winTarget || state.score2 >= winTarget;
        if (gameOver) {
          const winner: 1 | 2 = state.score1 >= winTarget ? 1 : 2;
          const result: RoundResult = { winner, score1: state.score1, score2: state.score2 };
          setRoundOver(result);
          setScoreHistory((prev) => [...prev, result]);
          state.paused = true;
          peerRef.current?.sendRoundOver(winner, state.score1, state.score2);
          winner === 1 ? playWin() : playLose();
        }
      }

      rendererRef.current?.draw(state);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [mode, winTarget, roundOver]);

  // ── Guest game loop ────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "multi-guest") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const loop = () => {
      if (!running) return;
      rendererRef.current?.draw(stateRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [mode]);

  // ── Single player game loop ────────────────────────────────────────
  useEffect(() => {
    if (mode !== "single") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const loop = () => {
      if (!running) return;
      const state = stateRef.current;
      state.paddle1X = paddleXRef.current;

      if (state.paused) {
        rendererRef.current?.draw(state);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const keys = keysRef.current;
      let moveP1 = 0;
      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) moveP1 = -1;
      else if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) moveP1 = 1;

      const moveP2 = aiRef.current.update(state);

      const soundEvent = update(state, moveP1, moveP2);
      switch (soundEvent) {
        case "paddle-hit": playPaddleHit(); break;
        case "wall": playWallHit(); break;
        case "score1": case "score2": playScore(); break;
      }

      paddleXRef.current = state.paddle1X;

      if (winTarget) {
        const gameOver = state.score1 >= winTarget || state.score2 >= winTarget;
        if (gameOver) { state.paused = true; playLose(); }
      }

      rendererRef.current?.draw(state);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [mode, winTarget]);

  // ── Canvas setup ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setupCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const size = Math.min(rect.width, rect.height);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(size * dpr / GAME_WIDTH, 0, 0, size * dpr / GAME_WIDTH, 0, 0);
        rendererRef.current = new Renderer(ctx, 1, isGuestRef.current);
      }
    };

    setupCanvas();

    const onResize = () => {
      setLandscape(isLandscape());
      setupCanvas();
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode]);

  // ── Unlock audio on any user interaction ───────────────────────────
  // iOS Safari requires a user gesture to resume AudioContext.
  // Unlock on any pointer down or keyboard event so sound effects
  // work even if the player never clicks the audio button explicitly.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // ── Keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current.add(e.key); };
    const up = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ── Touch ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const screenW = window.innerWidth;
      let gameX = (t.clientX / screenW) * GAME_WIDTH;
      gameX = Math.max(PADDLE_WIDTH / 2, Math.min(GAME_WIDTH - PADDLE_WIDTH / 2, gameX));
      paddleXRef.current = gameX - PADDLE_WIDTH / 2;

      if (modeRef.current === "multi-guest") {
        stateRef.current.paddle2X = paddleXRef.current;
        peerRef.current?.sendInput(stateRef.current.paddle2X);
      } else {
        stateRef.current.paddle1X = paddleXRef.current;
      }
    };
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => window.removeEventListener("touchmove", onTouchMove);
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
          connStatus={connStatus}
        />
      )}
      {disconnected && !showQR && <DisconnectedOverlay onBack={initSinglePlayer} />}
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

      {/* Connection status bar */}
      {connStatus && mode !== "single" && !showQR && (
        <div className="w-full bg-yellow-900/80 px-3 py-1 shrink-0">
          <p className="text-yellow-300 font-mono text-xs text-center">{connStatus}</p>
        </div>
      )}

      {/* Button bar at top */}
      {mode === "single" && !showWinTarget && !showQR && (
        <div className="w-full flex justify-center py-1.5 shrink-0">
          <button
            onClick={() => setShowWinTarget(true)}
            className="bg-white text-black font-mono text-sm py-1.5 px-5 rounded-xl font-bold active:bg-gray-300"
          >
            Start Multiplayer Session
          </button>
        </div>
      )}

      {/* Square game canvas */}
      <div className="flex-1 min-h-0 relative">
        {/* Audio button — top right, always visible (not during overlays) */}
        {!showQR && !showWinTarget && (mode === "single" || (!disconnected && peerRef.current?.connected)) && (
          <button
            onClick={toggleAudio}
            className="absolute top-3 right-3 z-30 bg-black/60 border border-gray-600 rounded-full w-11 h-11 flex items-center justify-center active:bg-gray-800"
            title={audioEnabled ? "Mute sound effects" : "Enable sound effects"}
          >
            {audioEnabled ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#4ade80" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>
        )}
        {/* Mic button — top right, multiplayer connected only, above audio button */}
        {mode !== "single" && !showQR && !showWinTarget && !disconnected && peerRef.current?.connected && (
          <div className="absolute top-3 right-16 z-30 flex flex-col gap-2">
            <button
              onClick={async () => {
                const peer = peerRef.current;
                if (!peer) return;
                if (micEnabled) {
                  peer.disableVoice();
                  setMicEnabled(false);
                } else {
                  const ok = await peer.enableVoice();
                  if (ok) setMicEnabled(true);
                }
              }}
              className="bg-black/60 border border-gray-600 rounded-full w-11 h-11 flex items-center justify-center active:bg-gray-800"
              title={micEnabled ? "Mute microphone" : "Enable voice chat"}
            >
              {micEnabled ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#4ade80" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          </div>
        )}
        {/* Remote voice indicator */}
        {remoteVoiceActive && (
          <div className="absolute top-3 left-3 z-30 bg-black/60 border border-green-600 rounded-full px-3 py-1.5 flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#4ade80" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
            <span className="text-green-400 font-mono text-[10px]">VOICE</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          style={{ touchAction: "none", objectFit: "contain" }}
        />
      </div>

      {/* Bottom bar — single player only */}
      {mode === "single" && !showWinTarget && !showQR && (
        <div className="w-full flex justify-center items-center gap-3 py-1.5 shrink-0">
          <button
            onClick={() => {
              stateRef.current.paused = !stateRef.current.paused;
              setMode((m) => m);
            }}
            className="text-gray-500 font-mono text-xs py-1.5 px-3 active:text-gray-300 flex items-center gap-1.5"
          >
            {stateRef.current.paused ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Play
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Pause
              </>
            )}
          </button>
          <span className="text-gray-700 text-[10px]">|</span>
          <button
            onClick={() => {
              stateRef.current.score1 = 0;
              stateRef.current.score2 = 0;
            }}
            className="text-gray-500 font-mono text-xs py-1.5 px-3 active:text-gray-300"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
