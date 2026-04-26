/**
 * state-store.js — tiny pub/sub state store for NBD Pro.
 *
 * Why this exists
 * ───────────────
 * dashboard.html + customer.html together carry ~600 `window._foo`
 * globals — they're how every render path moves data from "load
 * once" to "use everywhere". The pattern works but has three
 * costs that get worse as the app grows:
 *
 *   1. **No subscriptions.** Code that writes the global must
 *      remember every read site to manually re-render. Forgetting
 *      one is how stale UI bugs ship (e.g. Joe edits a photo's
 *      severity → the badge updates, but the kanban-side stale
 *      photo count doesn't, until a hard reload).
 *   2. **No slice isolation.** Every render path that reads a
 *      global has to defensive-default it (`window._foo || []`),
 *      because two render paths might race and the global might
 *      not exist yet. Some files have 30+ such defaulting lines.
 *   3. **Migration to V3 (Next.js + Supabase) needs a hard
 *      cutover.** Without an intermediate abstraction, every read
 *      site has to be ported in one shot. With a store, V3 can
 *      replace the store internals and leave call sites alone.
 *
 * What this provides
 * ──────────────────
 * A 60-line in-memory pub/sub. Three operations:
 *
 *     const store = NBDStore.create({ photos: [], filter: 'all' });
 *     store.get('photos');              // []
 *     store.set('filter', 'damage');    // notifies subscribers
 *     const off = store.subscribe('filter', val => render(val));
 *     off();                            // unsubscribe
 *
 * One bridge for incremental migration:
 *
 *     store.bind('_customerPhotos', 'photos');
 *     // → window._customerPhotos now mirrors store.get('photos')
 *     // → existing reads of `window._customerPhotos` keep working
 *     // → new code uses store.subscribe('photos', ...) instead
 *
 * Constraints
 * ───────────
 * - No external dependencies. Loads as a plain <script> tag.
 * - Synchronous notify — same call stack as setState. (Avoids
 *   the Effect-style "stale closure on next tick" trap.)
 * - Equality check before notify (`===` for primitives, identity
 *   for objects). Callers who mutate-in-place will skip the
 *   notify; that's intentional and matches the rules in
 *   coding-style.md ("ALWAYS create new objects, NEVER mutate").
 *
 * Not provided
 * ────────────
 * - Computed selectors (re-derive on read; if needed, callers can
 *   memoize at the call site).
 * - Devtools / time-travel. The whole point is to stay tiny — V3
 *   gets Zustand or signals, not this.
 * - Persistence. Item #12 (IndexedDB store) layers persistence on
 *   top of this; not bundled to keep the module load order open.
 *
 * Single source of truth: docs/pro/js/state-store.js. Update this
 * file, not call sites, when changing the shared protocol.
 */

(function () {
  'use strict';

  /**
   * Resolve a dotted path against a nested object.
   * `get({a: {b: 1}}, 'a.b')` → `1`.
   */
  function readPath(obj, path) {
    if (!path) return obj;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * Set a value at a dotted path, mutating the parent path. Returns
   * the (mutated) parent object so the caller can swap if it wants
   * referential identity at the top level.
   */
  function writePath(obj, path, value) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      if (cur[key] == null || typeof cur[key] !== 'object') {
        cur[key] = {};
      }
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  /**
   * Create a fresh store. `initial` becomes the seed state and is
   * NOT cloned — callers who need isolation should pass a freshly
   * built object.
   */
  function create(initial) {
    var state = initial && typeof initial === 'object' ? initial : {};
    var subs = Object.create(null); // path → Set<fn>
    var bridges = Object.create(null); // globalName → path

    function notify(path, value) {
      var set = subs[path];
      if (!set) return;
      // Snapshot the listeners so a subscriber that unsubscribes
      // mid-iteration doesn't shift the loop.
      var listeners = Array.from(set);
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i](value, path);
        } catch (err) {
          // Subscriber bugs must not break other subscribers or
          // future writes. Log and move on.
          if (typeof console !== 'undefined' && console.error) {
            console.error('[NBDStore] subscriber threw for path', path, err);
          }
        }
      }
    }

    function get(path) {
      return readPath(state, path);
    }

    function set(path, value) {
      var prev = readPath(state, path);
      if (prev === value) return false;
      writePath(state, path, value);
      // Mirror to any window-bound legacy globals.
      var globalName = bridges['__byPath__:' + path];
      if (globalName && typeof window !== 'undefined') {
        try { window[globalName] = value; } catch (_) {}
      }
      notify(path, value);
      return true;
    }

    function subscribe(path, fn) {
      if (typeof fn !== 'function') return function () {};
      var set_ = subs[path] || (subs[path] = new Set());
      set_.add(fn);
      return function unsubscribe() {
        var s = subs[path];
        if (s) s.delete(fn);
      };
    }

    /**
     * Mirror `state[path]` onto `window[globalName]` so existing
     * call sites that read the global keep working during the
     * incremental migration. New writes go through `store.set`;
     * the bridge keeps the global in sync. NOT a two-way sync —
     * direct writes to `window[globalName]` will NOT update the
     * store (otherwise legacy code paths would silently bypass
     * subscribers and we'd lose the whole point).
     */
    function bind(globalName, path) {
      if (typeof window === 'undefined') return;
      bridges[globalName] = path;
      bridges['__byPath__:' + path] = globalName;
      // Seed window with the current value so first-frame reads
      // don't see undefined for paths that already had state.
      try { window[globalName] = readPath(state, path); } catch (_) {}
    }

    /**
     * Reset the store to a new seed object. Notifies every
     * subscriber whose slice changed.
     */
    function reset(next) {
      var nextState = next && typeof next === 'object' ? next : {};
      var paths = Object.keys(subs);
      state = nextState;
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        var v = readPath(state, p);
        var globalName = bridges['__byPath__:' + p];
        if (globalName && typeof window !== 'undefined') {
          try { window[globalName] = v; } catch (_) {}
        }
        notify(p, v);
      }
    }

    return {
      get: get,
      set: set,
      subscribe: subscribe,
      bind: bind,
      reset: reset,
      // Expose the seed for tests + dev console inspection.
      // Treat as read-only — mutating bypasses notify.
      _state: state,
    };
  }

  // The single shared store. Pages that want their own scratch
  // store can `NBDStore.create({...})` independently.
  var singleton = create({});

  var api = {
    create: create,
    // Singleton convenience methods — these route to the shared
    // store so dashboard.html + customer.html see the same state.
    get: singleton.get,
    set: singleton.set,
    subscribe: singleton.subscribe,
    bind: singleton.bind,
    reset: singleton.reset,
    _singleton: singleton,
  };

  if (typeof window !== 'undefined') {
    window.NBDStore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
