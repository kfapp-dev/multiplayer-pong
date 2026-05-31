import { GameState, MultiplayerMessage } from "../game/types";

type MessageHandler = (msg: MultiplayerMessage) => void;
type StatusHandler = (status: string) => void;
type ConnectHandler = () => void;
type VoiceTrackHandler = (stream: MediaStream) => void;

function log(tag: string, ...args: unknown[]) {
  console.log(`[pong:${tag}]`, ...args);
}

export class MultiplayerPeer {
  private peer: any = null;
  private conn: any = null;
  private isHostPeer: boolean = false;
  private messageHandler: MessageHandler | null = null;
  private statusHandler: StatusHandler | null = null;
  private connectHandler: ConnectHandler | null = null;
  private voiceTrackHandler: VoiceTrackHandler | null = null;
  private _peerId: string = "";
  private micStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStatus(handler: StatusHandler): void {
    this.statusHandler = handler;
  }

  onConnect(handler: ConnectHandler): void {
    this.connectHandler = handler;
  }

  onVoiceTrack(handler: VoiceTrackHandler): void {
    this.voiceTrackHandler = handler;
  }

  get isHost(): boolean {
    return this.isHostPeer;
  }

  get id(): string {
    return this._peerId;
  }

  get connected(): boolean {
    return this.conn !== null && this.conn.open;
  }

  /** Get the underlying RTCPeerConnection from the active data channel. */
  getPeerConnection(): RTCPeerConnection | null {
    if (!this.conn) return null;
    const c = this.conn as any;
    return c.peerConnection || c._pc || c.provider?.peerConnection || null;
  }

  /**
   * Enable voice chat: request mic, add audio track to the existing PC.
   * Returns true if mic was acquired successfully.
   */
  async enableVoice(): Promise<boolean> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      log("voice", "getUserMedia failed:", err);
      return false;
    }

    const pc = this.getPeerConnection();
    if (!pc) {
      log("voice", "no peer connection available");
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      return false;
    }

    // Add mic tracks to the existing peer connection
    for (const track of this.micStream.getTracks()) {
      pc.addTrack(track, this.micStream);
    }
    log("voice", "mic track added to peer connection");

    // Signal the other side that voice is active
    this.send({ type: "voice-start" } as MultiplayerMessage);
    return true;
  }

  /** Disable voice chat: stop mic, remove tracks from PC. */
  disableVoice(): void {
    const pc = this.getPeerConnection();
    if (pc) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === "audio") {
          pc.removeTrack(sender);
        }
      }
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.send({ type: "voice-stop" } as MultiplayerMessage);
    log("voice", "mic disabled");
  }

  /** Handle incoming voice-start / voice-stop messages. */
  private handleVoiceMessage(msg: MultiplayerMessage): void {
    if (msg.type === "voice-start") {
      log("voice", "remote peer enabled voice");
      // The remote side added a track — ontrack will fire on the PC
    }
    if (msg.type === "voice-stop") {
      log("voice", "remote peer disabled voice");
      if (this.remoteAudioEl) {
        this.remoteAudioEl.srcObject = null;
      }
    }
  }

  /**
   * Set up the RTCPeerConnection ontrack handler to receive remote audio.
   * Call this after the connection is established.
   */
  private setupVoiceReceivers(): void {
    const pc = this.getPeerConnection();
    if (!pc) return;

    // Create a hidden audio element for remote audio
    if (!this.remoteAudioEl) {
      this.remoteAudioEl = document.createElement("audio");
      this.remoteAudioEl.autoplay = true;
      (this.remoteAudioEl as any).playsInline = true;
      // Don't add to DOM — it's invisible
    }

    pc.ontrack = (event: RTCTrackEvent) => {
      log("voice", "received remote track:", event.track.kind);
      if (event.track.kind === "audio" && event.streams[0]) {
        this.remoteAudioEl!.srcObject = event.streams[0];
        this.voiceTrackHandler?.(event.streams[0]);
      }
    };
  }

  /**
   * Patch RTCPeerConnection BEFORE PeerJS loads so that PeerJS's
   * internal PeerConnections inherit our ICE servers.
   */
  private static patchIceServers(): void {
    const OrigPC = window.RTCPeerConnection;
    if (!OrigPC) return;

    const ICE_SERVERS: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: [
          "turn:178.105.26.234:3478",
          "turn:178.105.26.234:3478?transport=tcp",
        ],
        username: "game",
        credential: "pongturn2026",
      },
    ];

    // Only patch once
    if ((window as any).__pongPCReturned) return;
    (window as any).__pongPCReturned = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PatchedPC = function (this: any, config?: any) {
      const merged: RTCConfiguration = {
        ...config,
        iceServers: [...ICE_SERVERS, ...(config?.iceServers || [])],
      };
      return new OrigPC(merged);
    };
    PatchedPC.prototype = OrigPC.prototype;
    (window as any).RTCPeerConnection = PatchedPC;

    log("peer", "RTCPeerConnection patched with TURN/STUN servers");
  }

  async createHost(): Promise<string> {
    // Patch BEFORE importing PeerJS
    MultiplayerPeer.patchIceServers();

    const Peer = (await import("peerjs")).default;
    this._peerId = "pong-" + Math.random().toString(36).substring(2, 10);
    this.isHostPeer = true;
    log("createHost", "peerId=", this._peerId);

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer(this._peerId, {
          debug: 0,
        });
      } catch (err) {
        reject(err);
        return;
      }

      this.peer.on("open", (id: string) => {
        log("createHost", "peer signaling open, id=", id);
        resolve(id);
      });

      this.peer.on("connection", (conn: any) => {
        log("createHost", "incoming connection from", conn.peer);

        // Access the underlying RTCPeerConnection and log ICE config
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyConn = conn as any;
        const pc =
          anyConn.peerConnection ||
          anyConn._pc ||
          anyConn.provider?.peerConnection;
        if (pc) {
          log(
            "createHost",
            "peerConnection ICE servers:",
            JSON.stringify(pc.getConfiguration?.()?.iceServers?.map((s: any) => s.urls) || "unknown")
          );
        }

        this.conn = conn;

        conn.on("open", () => {
          log("createHost", "data channel open with", conn.peer);
          this.setupVoiceReceivers();
          this.statusHandler?.("connected");
          this.connectHandler?.();
        });

        conn.on("data", (data: unknown) => {
          const msg = data as MultiplayerMessage;
          if (msg.type === "voice-start" || msg.type === "voice-stop") {
            this.handleVoiceMessage(msg);
          } else {
            this.messageHandler?.(msg);
          }
        });

        conn.on("close", () => {
          log("createHost", "data channel closed");
          this.statusHandler?.("disconnected");
          this.conn = null;
        });

        conn.on("error", (err: any) => {
          log("createHost", "data channel error:", err);
          this.statusHandler?.("error");
        });
      });

      this.peer.on("error", (err: any) => {
        log("createHost", "peer error:", err.type, err.message || err);
        if (err.type === "peer-unavailable") return; // guest not connected yet
        this.statusHandler?.("error");
        reject(err);
      });

      this.peer.on("disconnected", () => {
        log("createHost", "peer disconnected from signaling");
        this.statusHandler?.("disconnected");
      });
    });
  }

  async joinHost(hostId: string): Promise<void> {
    // Patch BEFORE importing PeerJS
    MultiplayerPeer.patchIceServers();

    const Peer = (await import("peerjs")).default;
    this.isHostPeer = false;
    this._peerId = "pong-" + Math.random().toString(36).substring(2, 10);
    log("joinHost", "peerId=", this._peerId, "hostId=", hostId);

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer(this._peerId, {
          debug: 0,
        });
      } catch (err) {
        reject(err);
        return;
      }

      this.peer.on("open", (id: string) => {
        log("joinHost", "peer signaling open, id=", id, "connecting to", hostId);

        const conn = this.peer!.connect(hostId, {
          reliable: true,
        });

        // Access the underlying RTCPeerConnection and log ICE config
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyConn = conn as any;
        const pc =
          anyConn.peerConnection ||
          anyConn._pc ||
          anyConn.provider?.peerConnection;
        if (pc) {
          log(
            "joinHost",
            "peerConnection ICE servers:",
            JSON.stringify(pc.getConfiguration?.()?.iceServers?.map((s: any) => s.urls) || "unknown")
          );
        }

        this.conn = conn;

        conn.on("open", () => {
          log("joinHost", "data channel open");
          this.setupVoiceReceivers();
          this.statusHandler?.("connected");
          this.connectHandler?.();
          resolve();
        });

        conn.on("data", (data: unknown) => {
          const msg = data as MultiplayerMessage;
          if (msg.type === "voice-start" || msg.type === "voice-stop") {
            this.handleVoiceMessage(msg);
          } else {
            this.messageHandler?.(msg);
          }
        });

        conn.on("close", () => {
          log("joinHost", "data channel closed");
          this.statusHandler?.("disconnected");
          this.conn = null;
        });

        conn.on("error", (err: any) => {
          log("joinHost", "data channel error:", err);
          this.statusHandler?.("error");
          reject(err);
        });
      });

      this.peer.on("error", (err: any) => {
        log("joinHost", "peer error:", err.type, err.message || err);
        this.statusHandler?.("error");
        reject(err);
      });

      this.peer.on("disconnected", () => {
        log("joinHost", "peer disconnected from signaling");
        this.statusHandler?.("disconnected");
      });

      // Timeout
      setTimeout(() => {
        if (!this.conn?.open) {
          log("joinHost", "connection timeout after 30s");
          this.statusHandler?.("error");
          reject(new Error("Connection timeout"));
        }
      }, 30000);
    });
  }

  send(msg: MultiplayerMessage): boolean {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
      return true;
    }
    return false;
  }

  sendState(state: GameState): void {
    this.send({ type: "state", state } as MultiplayerMessage);
  }

  sendInput(paddleX: number): void {
    this.send({ type: "input", paddleX } as MultiplayerMessage);
  }

  sendWinTarget(target: number): void {
    this.send({ type: "win-target", winTarget: target } as MultiplayerMessage);
  }

  sendPlayAgain(): void {
    this.send({ type: "play-again" } as MultiplayerMessage);
  }

  sendRoundOver(winner: number, score1: number, score2: number): void {
    this.send({ type: "round-over", winner, score1, score2 } as MultiplayerMessage);
  }

  sendReady(): void {
    this.send({ type: "ready" } as MultiplayerMessage);
  }

  disconnect(): void {
    this.disableVoice();
    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      this.remoteAudioEl = null;
    }
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.isHostPeer = false;
  }
}
