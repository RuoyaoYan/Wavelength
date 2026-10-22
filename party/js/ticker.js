// A fixed-rate clock that keeps going when the host tab is in the background.
// Browsers slow main-thread timers in hidden tabs to once a second; worker timers keep pace.
export function startTicker(hz, cb) {
  const src = `setInterval(() => postMessage(0), ${1000 / hz});`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  let last = performance.now();
  worker.onmessage = () => {
    const now = performance.now();
    cb(Math.min(0.25, (now - last) / 1000));
    last = now;
  };
  return () => { worker.terminate(); URL.revokeObjectURL(url); };
}
