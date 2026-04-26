export type ConnectivityState = 'online' | 'offline' | 'degraded' | 'syncing';

type PingFn = () => Promise<unknown>;

export class ConnectivityService {
  private readonly pingFn: PingFn;
  private readonly onState: (next: ConnectivityState) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private failStreak = 0;
  private state: ConnectivityState = 'degraded';

  constructor(pingFn: PingFn, onState: (next: ConnectivityState) => void) {
    this.pingFn = pingFn;
    this.onState = onState;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  markSyncing() {
    this.setState('syncing');
  }

  markOnline() {
    this.failStreak = 0;
    this.setState('online');
  }

  markDegraded() {
    this.setState('degraded');
  }

  markOffline() {
    this.setState('offline');
  }

  private setState(next: ConnectivityState) {
    if (this.state === next) return;
    this.state = next;
    this.onState(next);
  }

  private nextDelayMs(): number {
    if (this.failStreak <= 0) return 15_000;
    const backoff = Math.min(60_000, 2_000 * 2 ** Math.min(5, this.failStreak - 1));
    const jitter = Math.floor(Math.random() * 500);
    return backoff + jitter;
  }

  private async tick(delayMs: number): Promise<void> {
    if (this.stopped) return;
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(() => resolve(), delayMs);
      });
      if (this.stopped) return;
    }
    try {
      await this.pingFn();
      this.failStreak = 0;
      this.setState('online');
    } catch {
      this.failStreak += 1;
      this.setState(this.failStreak >= 2 ? 'offline' : 'degraded');
    }
    void this.tick(this.nextDelayMs());
  }
}
