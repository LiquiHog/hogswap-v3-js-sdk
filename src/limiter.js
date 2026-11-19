/**
 * A client-side limiter matching the public API's per-IP limits: at most `perWindow` request
 * starts in any rolling `windowMs`, and at most `inFlight` running at once. Requests over the
 * limit wait their turn (first in, first out) instead of being refused by the server.
 *
 * One limiter per client instance. In a browser that matches the server's view (one visitor, one
 * IP). On a server, every client on the same IP shares the server's limit: share one client.
 */
export class RateLimiter {
  /**
   * @param {{perWindow: number, windowMs: number, inFlight: number}} cfg
   * @param {{now?: () => number, sleep?: (ms: number) => Promise<void>}} [clock] for tests
   */
  constructor(cfg, clock = {}) {
    if (!(cfg.perWindow >= 1 && cfg.windowMs >= 1 && cfg.inFlight >= 1)) {
      throw new RangeError('rate limit perWindow, windowMs and inFlight must all be at least 1');
    }
    this.cfg = { ...cfg };
    this.now = clock.now ?? (() => Date.now());
    this.sleep = clock.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    /** start times inside the current window @type {number[]} */
    this.starts = [];
    this.running = 0;
    /** @type {Array<() => void>} */
    this.queue = [];
    this.pumping = false;
  }

  /**
   * Wait for a slot. Returns a release function: call it once when the request finishes.
   * @returns {Promise<() => void>}
   */
  acquire() {
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.running -= 1;
          this.pump();
        });
      });
      this.pump();
    });
  }

  /**
   * Hold back new starts for `ms` (after a 429 the server says how long to wait).
   * @param {number} ms
   */
  pause(ms) {
    const until = this.now() + ms;
    // Fill the window with starts dated so the window frees up at `until`.
    const fakeStart = until - this.cfg.windowMs;
    this.starts = Array(this.cfg.perWindow).fill(fakeStart);
    this.pump();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.running < this.cfg.inFlight) {
        const now = this.now();
        this.starts = this.starts.filter((t) => t > now - this.cfg.windowMs);
        if (this.starts.length >= this.cfg.perWindow) {
          const wait = this.starts[0] + this.cfg.windowMs - now;
          await this.sleep(Math.max(1, wait));
          continue;
        }
        this.starts.push(now);
        const next = this.queue.shift();
        next();
      }
    } finally {
      this.pumping = false;
    }
  }
}
