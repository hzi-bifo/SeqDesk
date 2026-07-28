/**
 * Interval polling that pauses while the browser tab is hidden.
 *
 * On the hosted demo every one of these loops is a database query, and Neon
 * only suspends a compute after five minutes without one. Any interval shorter
 * than that keeps the database awake for as long as a tab stays open, so a
 * forgotten background tab is billed like a full working day. Browsers throttle
 * background timers but do not stop them, which is not enough.
 *
 * Call sites keep their own initial fetch; this only owns the repeat. When the
 * tab becomes visible again after a hidden phase, one catch-up run fires
 * immediately so the UI is not stale while waiting for the next tick.
 */
export function startVisiblePolling(task: () => void, intervalMs: number): () => void {
  if (typeof document === "undefined") {
    const timer = setInterval(task, intervalMs);
    return () => clearInterval(timer);
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  const stopTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const sync = () => {
    if (document.visibilityState === "hidden") {
      stopTimer();
      return;
    }

    if (started && timer === null) {
      task();
    }

    started = true;

    if (timer === null) {
      timer = setInterval(task, intervalMs);
    }
  };

  sync();
  document.addEventListener("visibilitychange", sync);

  return () => {
    stopTimer();
    document.removeEventListener("visibilitychange", sync);
  };
}
