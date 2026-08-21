export function createLifecycle() {
  const intervals = new Set();
  const timeouts = new Set();
  const cleanups = new Set();
  let disposed = false;

  function interval(callback, delay) {
    if (disposed) return null;
    const id = window.setInterval(callback, delay);
    intervals.add(id);
    return id;
  }

  function timeout(callback, delay) {
    if (disposed) return null;
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      callback();
    }, delay);
    timeouts.add(id);
    return id;
  }

  function cleanup(callback) {
    if (typeof callback !== 'function') return () => {};
    if (disposed) {
      try { callback(); } catch (error) { console.warn('late cleanup', error); }
      return () => {};
    }
    cleanups.add(callback);
    return () => cleanups.delete(callback);
  }

  function clear() {
    if (disposed) return;
    disposed = true;
    intervals.forEach((id) => window.clearInterval(id));
    timeouts.forEach((id) => window.clearTimeout(id));
    intervals.clear();
    timeouts.clear();
    [...cleanups].reverse().forEach((callback) => {
      try { callback(); } catch (error) { console.warn('cleanup failed', error); }
    });
    cleanups.clear();
  }

  return {
    interval,
    timeout,
    cleanup,
    clear,
    get disposed() { return disposed; }
  };
}
