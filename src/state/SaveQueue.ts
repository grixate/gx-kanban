export class SaveQueue {
  private debounceMs: number;
  private maxDelayMs: number;
  private flushFn: (payload: string) => Promise<void> | void;

  private debounceHandle: number | null;
  private maxDelayHandle: number | null;
  private pendingPayload: string | null;
  private writing: boolean;

  constructor(
    flushFn: (payload: string) => Promise<void> | void,
    debounceMs: number,
    maxDelayMs: number
  ) {
    this.flushFn = flushFn;
    this.debounceMs = debounceMs;
    this.maxDelayMs = maxDelayMs;

    this.debounceHandle = null;
    this.maxDelayHandle = null;
    this.pendingPayload = null;
    this.writing = false;
  }

  request(payload: string): void {
    this.pendingPayload = payload;

    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = window.setTimeout(() => {
      this.flush().catch((error) => console.error(error));
    }, this.debounceMs);

    if (this.maxDelayHandle === null) {
      this.maxDelayHandle = window.setTimeout(() => {
        this.flush().catch((error) => console.error(error));
      }, this.maxDelayMs);
    }
  }

  async flushNow(): Promise<void> {
    await this.flush();
  }

  clearPending(): void {
    this.pendingPayload = null;
    this.clearTimers();
  }

  destroy(): void {
    this.clearPending();
  }

  private clearTimers(): void {
    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }

    if (this.maxDelayHandle !== null) {
      window.clearTimeout(this.maxDelayHandle);
      this.maxDelayHandle = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.writing || !this.pendingPayload) {
      return;
    }

    const payload = this.pendingPayload;
    this.pendingPayload = null;
    this.clearTimers();

    this.writing = true;
    try {
      await this.flushFn(payload);
    } finally {
      this.writing = false;
    }

    if (this.pendingPayload) {
      await this.flush();
    }
  }
}
