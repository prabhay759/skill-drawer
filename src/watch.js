/**
 * Watch drawer roots and notify listeners when skills change on disk, so the
 * UI stays current while you edit skills in an editor.
 *
 * Recursive watching is supported on macOS, Windows and Linux under Node 20+;
 * where it is refused we fall back to a shallow watch of the root, which still
 * catches skills being added, renamed or removed.
 */
import fs from "node:fs";

const DEBOUNCE_MS = 300;
const MAX_WATCHERS = 60;
const IGNORE = /(^|[\\/])(\.git|node_modules|\.DS_Store|[^\\/]*\.swp|[^\\/]*~)([\\/]|$)/;

export function createWatcher({ onChange, debounceMs = DEBOUNCE_MS } = {}) {
  let watchers = [];
  let timer = null;
  let muteUntil = 0;
  let pending = new Set();

  const flush = () => {
    timer = null;
    const paths = [...pending];
    pending = new Set();
    if (Date.now() < muteUntil || !paths.length) return;
    try {
      onChange(paths);
    } catch {
      /* a listener must never break the watcher */
    }
  };

  const bump = (file) => {
    if (file && IGNORE.test(file)) return;
    if (file) pending.add(file);
    else pending.add("");
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const watchRoot = (root) => {
    for (const recursive of [true, false]) {
      try {
        const w = fs.watch(root, { recursive, persistent: false }, (_event, file) => bump(file));
        w.on("error", () => {});
        watchers.push(w);
        return;
      } catch {
        /* try shallow, then give up on this root */
      }
    }
  };

  return {
    /** Point the watcher at a new set of roots, replacing any previous ones. */
    watch(roots) {
      this.close();
      for (const root of [...new Set(roots)].slice(0, MAX_WATCHERS)) watchRoot(root);
      return watchers.length;
    },
    /** Ignore changes for a moment, so our own writes do not echo back. */
    mute(ms = 800) {
      muteUntil = Date.now() + ms;
    },
    get count() {
      return watchers.length;
    },
    close() {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already gone */
        }
      }
      watchers = [];
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
