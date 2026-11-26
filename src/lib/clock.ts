/**
 * App clock. Runs at real time normally; Simulation mode speeds it up so a demo drive plays as a
 * time-lapse while every timer, speed and statistic stays internally consistent.
 */
let rate = 1;
let anchorReal = Date.now();
let anchorVirtual = anchorReal;

export const clock = {
  now(): number {
    return anchorVirtual + (Date.now() - anchorReal) * rate;
  },
  get rate(): number {
    return rate;
  },
  setRate(r: number): void {
    const n = clock.now();
    anchorReal = Date.now();
    anchorVirtual = n;
    rate = r;
  },
  /** Back to real time. */
  reset(): void {
    rate = 1;
    anchorReal = anchorVirtual = Date.now();
  },
  /** Offset to convert a clock timestamp to real wall time. */
  realOffset(): number {
    return Date.now() - clock.now();
  },
};
