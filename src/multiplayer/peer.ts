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
  private audioPc: RTCPeerConnection | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private voiceNegotiationComplete = false;
  private voiceOfferSent = false;

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

  // ── Voice chat via separate audio-only RTCPeerConnection ──────────

  /** Get the same ICE servers we use for the patched PC. */
  private getIceServers(): RTCIceServer[] {
    return [
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
  }

  /**
   * Enable voice: request mic, create audio-only RTCPeerConnection,
   * add mic track, create offer, signal via data channel.
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

    // Create a separate audio-only peer connection
    this.audioPc = new RTCPeerConnection({
      iceServers: this.getIceServers(),
    });

    // Add mic track
    for (const track of this.micStream.getTracks()) {
      this.audioPc.addTrack(track, this.micStream);
    }

    // Handle incoming remote audio
    this.audioPc.ontrack = (event: RTCTrackEvent) => {
      log("voice", "received remote audio track");
      if (event.track.kind === "audio" && event.streams[0]) {
        if (!this.remoteAudioEl) {
          this.remoteAudioEl = document.createElement("audio");
          this.remoteAudioEl.autoplay = true;
          (this.remoteAudioEl as any).playsInline = true;
        }
        this.remoteAudioEl.srcObject = event.streams[0];
        this.voiceTrackHandler?.(event.streams[0]);
      }
    };

    // ICE candidate gathering — send to remote via data channel
    this.audioPc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.send({
          type: "voice-ice",
          candidate: event.candidate.toJSON(),
        } as MultiplayerMessage);
      }
    };

    this.audioPc.oniceconnectionstatechange = () => {
      log("voice", "audio ICE state:", this.audioPc?.iceConnectionState);
    };

    // Set up receiver for ICE candidates from remote
    this.setupVoiceReceiver();

    // Create offer
    try {
      const offer = await this.audioPc.createOffer();
      await this.audioPc.setLocalDescription(offer);
      this.voiceOfferSent = true;
      this.send({
        type: "voice-offer",
        sdp: offer.sdp,
      } as MultiplayerMessage);
      log("voice", "sent voice-offer");
    } catch (err) {
      log("voice", "createOffer failed:", err);
      this.cleanupVoice();
      return false;
    }

    return true;
  }

  /** Disable voice: stop everything. */
  disableVoice(): void {
    this.send({ type: "voice-stop" } as MultiplayerMessage);
    this.cleanupVoice();
    log("voice", "voice disabled");
  }

  private cleanupVoice(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioPc) {
      this.audioPc.ontrack = null;
      this.audioPc.onicecandidate = null;
      this.audioPc.oniceconnectionstatechange = null;
      this.audioPc.close();
      this.audioPc = null;
    }
    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      this.remoteAudioEl = null;
    }
    this.voiceNegotiationComplete = false;
    this.voiceOfferSent = false;
  }

  /**
   * Handle incoming voice signaling messages.
   * Called from the data channel on("data") handler.
   */
  handleVoiceMessage(msg: MultiplayerMessage): void {
    if (!this.audioPc && msg.type !== "voice-offer") {
      // Not in voice mode and not receiving an offer — ignore
      return;
    }

    switch (msg.type) {
      case "voice-offer":
        this.handleVoiceOffer(msg);
        break;
      case "voice-answer":
        this.handleVoiceAnswer(msg);
        break;
      case "voice-ice":
        this.handleVoiceIce(msg);
        break;
      case "voice-stop":
        log("voice", "remote peer disabled voice");
        if (this.remoteAudioEl) {
          this.remoteAudioEl.srcObject = null;
        }
        break;
    }
  }

  /** Handle incoming voice-offer: create answer. */
  private async handleVoiceOffer(msg: MultiplayerMessage): Promise<void> {
    log("voice", "received voice-offer");

    // Collision: both sides sent offers. Lexicographically smaller peer ID wins.
    if (this.voiceOfferSent && this.audioPc) {
      // PeerJS conn.peer is the remote peer's ID
      const remotePeer = this.conn?.peer || "";
      if (this._peerId < remotePeer) {
        log("voice", "offer collision — we win (smaller id), ignoring remote offer");
        return;
      } else {
        log("voice", "offer collision — we lose, resetting our offer to answer theirs");
        // Reset: close current PC, create new one to answer
        if (this.audioPc) {
          this.audioPc.close();
          this.audioPc = null;
        }
        this.voiceOfferSent = false;
        this.voiceNegotiationComplete = false;
        // Fall through to normal answer flow below
      }
    }

    if (!this.audioPc) {
      // We received an offer — create the PC and get mic
      this.audioPc = new RTCPeerConnection({
        iceServers: this.getIceServers(),
      });

      this.audioPc.ontrack = (event: RTCTrackEvent) => {
        log("voice", "received remote audio track");
        if (event.track.kind === "audio" && event.streams[0]) {
          if (!this.remoteAudioEl) {
            this.remoteAudioEl = document.createElement("audio");
            this.remoteAudioEl.autoplay = true;
            (this.remoteAudioEl as any).playsInline = true;
          }
          this.remoteAudioEl.srcObject = event.streams[0];
          this.voiceTrackHandler?.(event.streams[0]);
        }
      };

      this.audioPc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          this.send({
            type: "voice-ice",
            candidate: event.candidate.toJSON(),
          } as MultiplayerMessage);
        }
      };

      this.audioPc.oniceconnectionstatechange = () => {
        log("voice", "audio ICE state:", this.audioPc?.iceConnectionState);
      };

      // Request mic on our side too
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        for (const track of this.micStream.getTracks()) {
          this.audioPc.addTrack(track, this.micStream);
        }
        log("voice", "mic acquired for answer side");
      } catch (err) {
        log("voice", "getUserMedia failed on answer side:", err);
      }
    }

    try {
      await this.audioPc.setRemoteDescription({
        type: "offer",
        sdp: msg.sdp as string,
      });
      const answer = await this.audioPc.createAnswer();
      await this.audioPc.setLocalDescription(answer);
      this.send({
        type: "voice-answer",
        sdp: answer.sdp,
      } as MultiplayerMessage);
      log("voice", "sent voice-answer");
      this.setupVoiceReceiver();
    } catch (err) {
      log("voice", "handleVoiceOffer error:", err);
    }
  }

  /** Handle incoming voice-answer: set remote description. */
  private async handleVoiceAnswer(msg: MultiplayerMessage): Promise<void> {
    log("voice", "received voice-answer");
    if (!this.audioPc) return;
    try {
      await this.audioPc.setRemoteDescription({
        type: "answer",
        sdp: msg.sdp as string,
      });
      this.voiceNegotiationComplete = true;
      log("voice", "voice negotiation complete");
    } catch (err) {
      log("voice", "handleVoiceAnswer error:", err);
    }
  }

  /** Handle incoming ICE candidate. */
  private async handleVoiceIce(msg: MultiplayerMessage): Promise<void> {
    if (!this.audioPc) return;
    try {
      const candidate = new RTCIceCandidate(msg.candidate as RTCIceCandidateInit);
      await this.audioPc.addIceCandidate(candidate);
    } catch (err) {
      log("voice", "addIceCandidate error:", err);
    }
  }

  /** Set up voice receiver for ICE candidates on an existing PC. */
  private setupVoiceReceiver(): void {
    // ICE candidates are already being sent from onicecandidate.
    // This method is just a marker that the full flow is set up.
    log("voice", "voice receiver ready");
  }

  // ── ICE server patching for PeerJS ─────────────────────────────────

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

  // ── Host / Guest connection ────────────────────────────────────────

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

        this.conn = conn;

        conn.on("open", () => {
          log("createHost", "data channel open with", conn.peer);
          this.statusHandler?.("connected");
          this.connectHandler?.();
        });

        conn.on("data", (data: unknown) => {
          const msg = data as MultiplayerMessage;
          if (msg.type.startsWith("voice-")) {
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

        this.conn = conn;

        conn.on("open", () => {
          log("joinHost", "data channel open");
          this.statusHandler?.("connected");
          this.connectHandler?.();
          resolve();
        });

        conn.on("data", (data: unknown) => {
          const msg = data as MultiplayerMessage;
          if (msg.type.startsWith("voice-")) {
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

  // ── Messaging ──────────────────────────────────────────────────────

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
    this.cleanupVoice();
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
