import { GameState, MultiplayerMessage } from "../game/types";

type MessageHandler = (msg: MultiplayerMessage) => void;
type StatusHandler = (status: string) => void;
type ConnectHandler = () => void;

export class MultiplayerPeer {
  private peer: any = null;
  private conn: any = null;
  private isHostPeer: boolean = false;
  private messageHandler: MessageHandler | null = null;
  private statusHandler: StatusHandler | null = null;
  private connectHandler: ConnectHandler | null = null;
  private peerId: string = "";

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

  async createHost(): Promise<string> {
    const Peer = (await import("peerjs")).default;
    this.peerId = "pong-" + Math.random().toString(36).substring(2, 10);
    this.isHostPeer = true;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(this.peerId, { debug: 0 });

      this.peer.on("open", () => {
        this.statusHandler?.("connected");
        resolve(this.peerId);
      });

      this.peer.on("connection", (conn: any) => {
        this.conn = conn;
        conn.on("open", () => {
          this.statusHandler?.("connected");
          this.connectHandler?.();
        });
        conn.on("data", (data: unknown) => {
          this.messageHandler?.(data as MultiplayerMessage);
        });
        conn.on("close", () => {
          this.statusHandler?.("disconnected");
          this.conn = null;
        });
        conn.on("error", () => {
          this.statusHandler?.("error");
        });
      });

      this.peer.on("error", (err: Error) => {
        this.statusHandler?.("error");
        reject(err);
      });

      this.peer.on("disconnected", () => {
        this.statusHandler?.("disconnected");
      });
    });
  }

  async joinHost(hostId: string): Promise<void> {
    const Peer = (await import("peerjs")).default;
    this.isHostPeer = false;
    this.peerId = "pong-" + Math.random().toString(36).substring(2, 10);

    return new Promise((resolve, reject) => {
      this.statusHandler?.("connecting");
      this.peer = new Peer(this.peerId, { debug: 0 });

      this.peer.on("open", () => {
        const conn = this.peer!.connect(hostId, { reliable: true });
        this.conn = conn;

        conn.on("open", () => {
          this.statusHandler?.("connected");
          this.connectHandler?.();
          resolve();
        });

        conn.on("data", (data: unknown) => {
          this.messageHandler?.(data as MultiplayerMessage);
        });

        conn.on("close", () => {
          this.statusHandler?.("disconnected");
          this.conn = null;
        });

        conn.on("error", (err: Error) => {
          this.statusHandler?.("error");
          reject(err);
        });
      });

      this.peer.on("error", (err: Error) => {
        this.statusHandler?.("error");
        reject(err);
      });

      setTimeout(() => {
        if (!this.conn?.open) {
          reject(new Error("Connection timeout"));
        }
      }, 15000);
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
