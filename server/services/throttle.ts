// A token bucket per outside API. Every request to Open Food Facts comes from the one server IP, so the app keeps
// itself well under OFF's published limits instead of relying on their 503s. In memory: fine for one replica.

export class RateLimiter {
  private tokens: number;
  private last: number;
  readonly perMinute: number;
  private readonly now: () => number;

  constructor(perMinute: number, now: () => number = Date.now) {
    this.perMinute = perMinute;
    this.tokens = perMinute;
    this.now = now;
    this.last = now();
  }

  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
  }

  /** Takes a token if one is free. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Milliseconds until the next token is free (0 when one is free now). */
  waitMs(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000);
  }
}
