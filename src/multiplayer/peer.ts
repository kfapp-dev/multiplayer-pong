import { GameState, MultiplayerMessage } from "../game/types";

type MessageHandler = (msg: MultiplayerMessage) => void;
type StatusHandler = (status: string) => void;
type ConnectHandler = () => void;

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
  private peerId: string = "";
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStatus(handler: StatusHandler): void {
    this.statusHandler = handler;
  }

  onConnect(handler: ConnectHandler): void {
    this.connectHandler = handler;
  }

  get isHost(): boolean {
    return this.isHostPeer;
  }

  get id(): string {
    return this.peerId;
  }

  get connected(): boolean {
    return this.conn !== null && this.conn.open;
  }

  private makeIceServers(): any[] {
    return [
      { url: "stun:stun.l.google.com:19302" },
      { url: "stun:stun1.l.google.com:19302" },
      { url: "stun:global.stun.twilio.com:3478" },
      {
        url: "turn:staticauth.openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayprojectsecret",
      },
      {
        url: "turn:staticauth.openrelay.metered.ca:80?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayprojectsecret",
      },
      {
        url: "turns:staticauth.openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayprojectsecret",
      },
    ];
  }

  async createHost(): Promise<string> {
    const Peer = (await import("peerjs")).default;
    this.peerId = "pong-" + Math.random().toString(36).substring(2, 10);
    this.isHostPeer = true;
    log("createHost", "peerId=", this.peerId);

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer(this.peerId, {
          debug: process.env.NODE_ENV === "development" ? 2 : 0,
          config: { iceServers: this.makeIceServers() },
        });
      } catch (err) {
        log("createHost", "Peer constructor error:", err);
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
          this.messageHandler?.(data as MultiplayerMessage);
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
        this.statusHandler?.("error");
        reject(err);
      });

      this.peer.on("disconnected", () => {
        log("createHost", "peer disconnected from signaling");
        this.statusHandler?.("disconnected");
      });

      this.peer.on("close", () => {
        log("createHost", "peer closed");
      });
    });
  }

  async joinHost(hostId: string): Promise<void> {
    const Peer = (await import("peerjs")).default;
    this.isHostPeer = false;
    this.peerId = "pong-" + Math.random().toString(36).substring(2, 10);
    log("joinHost", "peerId=", this.peerId, "hostId=", hostId);

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer(this.peerId, {
          debug: process.env.NODE_ENV === "development" ? 2 : 0,
          config: { iceServers: this.makeIceServers() },
        });
      } catch (err) {
        log("joinHost", "Peer constructor error:", err);
        reject(err);
        return;
      }

      this.peer.on("open", (id: string) => {
        log("joinHost", "peer signaling open, id=", id, "connecting to", hostId);

        const conn = this.peer!.connect(hostId, { reliable: true });
        this.conn = conn;

        conn.on("open", () => {
          log("joinHost", "data channel open to host");
          this.statusHandler?.("connected");
          this.connectHandler?.();
          if (this.connectTimer) clearTimeout(this.connectTimer);
          resolve();
        });

        conn.on("data", (data: unknown) => {
          this.messageHandler?.(data as MultiplayerMessage);
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

      // Timeout: if data channel not open after 20s, fail
      this.connectTimer = setTimeout(() => {
        if (!this.conn?.open) {
          log("joinHost", "connection timeout after 20s");
          this.statusHandler?.("error");
          reject(new Error("Connection timeout — could not reach host"));
        }
      }, 20000);
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
    if (this.connectTimer) clearTimeout(this.connectTimer);
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
