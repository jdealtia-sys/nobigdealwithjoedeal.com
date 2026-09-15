/**
 * tests/photo-editor-switch-photoid-2026-09-14.test.js
 *
 * docs/pro/js/photo-editor.js's switchPhoto(idx) — the handler wired to
 * clicking a thumbnail in the multi-photo strip — updated
 * S.currentPhotoIndex/S.brightness/S.contrast/S.originalImage for the
 * newly-selected photo but never reassigned S.photoId. saveTagsOnly()
 * and uploadBlob() both key their entire Firestore write off S.photoId
 * (window.updateDoc(window.doc(window.db, 'photos', S.photoId), meta)),
 * so a rep who opens the multi-photo editor, clicks a different
 * thumbnail, and saves would silently write that photo's tags/flattened
 * image onto the FIRST photo's document instead of the one actually on
 * screen — a wrong-record write, not a crash, so nothing would surface
 * it short of a customer complaint about mismatched photo metadata.
 *
 * This suite RUNS the real photo-editor.js in a hand-built fake-DOM vm
 * sandbox (model: tests/photo-editor-annotation-persistence.test.js /
 * tests/inspection-report-photos.test.js), opens the editor with a real
 * two-photo `allPhotos` array, clicks the real photo-strip thumbnail
 * (the same click handler wireEvents() binds in production), clicks the
 * real Save Tags / Save (overwrite) buttons, and inspects what actually
 * got handed to updateDoc — not a regex over the source text for the
 * behavioral assertions. A static-text guard pins the fix independently
 * of the DOM harness.
 *
 * Run: node tests/photo-editor-switch-photoid-2026-09-14.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const EDITOR_SRC = read('docs/pro/js/photo-editor.js');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}
function group(name) { console.log('\n' + name); }

/* ============================================================
   FAST STATIC-TEXT GUARD — independent of the DOM harness
   ============================================================ */
function extractFunctionBody(source, fnName) {
  const idx = source.indexOf('function ' + fnName + '(');
  if (idx === -1) return '';
  const braceStart = source.indexOf('{', idx);
  if (braceStart === -1) return '';
  let depth = 0, end = braceStart;
  for (; end < source.length; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') { depth--; if (depth === 0) { end++; break; } }
  }
  return source.slice(idx, end);
}

group('STATIC — switchPhoto() re-keys S.photoId to the newly-selected photo');
{
  const switchPhotoBody = extractFunctionBody(EDITOR_SRC, 'switchPhoto');
  ok('switchPhoto() exists in the source', !!switchPhotoBody);
  ok('switchPhoto() assigns S.photoId from the target photo entry',
    /S\.photoId\s*=/.test(switchPhotoBody),
    switchPhotoBody || '(switchPhoto body not found)');
  ok('switchPhoto() reads .id off the resolved `photo` variable (not the stale original)',
    /photo\.id/.test(switchPhotoBody));
}

/* ============================================================
   FAKE DOM — hand-built, addEventListener records for later
   manual invocation, vm.runInContext loads the real source.
   ============================================================ */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function makeCtx() {
  return {
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, drawImage() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    rect() {}, arc() {}, arcTo() {}, ellipse() {}, roundRect() {}, setLineDash() {},
    measureText() { return { width: 0 }; },
    getImageData() { return { data: [] }; }, putImageData() {},
    translate() {}, scale() {}, fillText() {}, strokeText() {},
  };
}

function makeClassList(el) {
  return {
    _s: new Set(),
    add(...cs) { cs.forEach((c) => this._s.add(c)); },
    remove(...cs) { cs.forEach((c) => this._s.delete(c)); },
    contains(c) { return this._s.has(c); },
    toggle(c, force) {
      if (force === undefined) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; }
      if (force) { this._s.add(c); return true; }
      this._s.delete(c); return false;
    },
  };
}

function parseAttrsInto(el, attrStr) {
  const attrRe = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let am;
  while ((am = attrRe.exec(attrStr))) {
    const name = am[1].toLowerCase();
    const val = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
    el.attrs[name] = val;
  }
  if (el.attrs.class) el.attrs.class.split(/\s+/).filter(Boolean).forEach((c) => el.classList._s.add(c));
}

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    attrs: {},
    style: {},
    children: [],
    parentElement: null,
    _listeners: [],
    value: '',
    checked: false,
    disabled: false,
    _rect: null,
    get dataset() {
      const d = {};
      Object.keys(this.attrs).forEach((k) => {
        if (k.indexOf('data-') === 0) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          d[camel] = this.attrs[k];
        }
      });
      return d;
    },
    get id() { return this.attrs.id || ''; },
    set id(v) { this.attrs.id = v; },
    get className() { return this.attrs.class || ''; },
    set className(v) { this.attrs.class = v; this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    set innerHTML(html) { this._html = html; const kids = parseHTML(html); kids.forEach((k) => { k.parentElement = this; }); this.children = kids; },
    get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; this.children = []; this._html = ''; },
    get textContent() { return this._text !== undefined ? this._text : ''; },
    setAttribute(k, v) { const key = String(k).toLowerCase(); this.attrs[key] = String(v); if (key === 'class') this.className = String(v); },
    getAttribute(k) { const key = String(k).toLowerCase(); return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; },
    removeAttribute(k) { delete this.attrs[String(k).toLowerCase()]; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener(type, fn, opts) { this._listeners.push({ type, fn, opts }); },
    removeEventListener(type, fn) { this._listeners = this._listeners.filter((l) => !(l.type === type && l.fn === fn)); },
    querySelector(sel) { return queryAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(this, sel); },
    closest(sel) { let n = this; while (n) { if (matchesSelector(n, sel)) return n; n = n.parentElement; } return null; },
    contains(node) {
      if (node === this) return true;
      return this.children.some((c) => c === node || c.contains(node));
    },
    getBoundingClientRect() { return this._rect || { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; },
    getContext() { return makeCtx(); },
    // Only canvases call this in practice (flattenCanvas -> fc.toBlob),
    // but it's harmless to expose on every fake element.
    toBlob(cb, type) { cb({ __fakeBlob: true, type: type || 'image/png' }); },
    focus() {},
    click() { this._listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({ target: this, preventDefault() {}, stopPropagation() {} })); },
  };
  el.classList = makeClassList(el);
  return el;
}

function parseHTML(html) {
  const tagRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)([^<>]*?)(\/?)>/g;
  const rootFrame = { tagName: null, el: null, children: [] };
  const stack = [rootFrame];
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0].indexOf('<!--') === 0) continue;
    if (m[1]) {
      const tn = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tn) { stack.length = i; break; }
      }
      continue;
    }
    const tagName = m[2].toLowerCase();
    const attrStr = m[3] || '';
    const selfClose = !!m[4] || VOID_TAGS.has(tagName);
    const el = makeEl(tagName);
    parseAttrsInto(el, attrStr);
    el.parentElement = stack[stack.length - 1].el || null;
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push({ tagName, el, children: el.children });
  }
  return rootFrame.children;
}

function matchesSimple(el, sel) {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)$/.exec(sel);
  if (!m) return false;
  const tag = m[1];
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const rest = m[2] || '';
  const partRe = /\.[\w-]+|#[\w-]+|\[[^\]]+\]/g;
  let pm;
  while ((pm = partRe.exec(rest))) {
    const part = pm[0];
    if (part[0] === '.') { if (!el.classList.contains(part.slice(1))) return false; }
    else if (part[0] === '#') { if ((el.attrs.id || '') !== part.slice(1)) return false; }
    else {
      const inner = part.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) { if (!(inner.trim() in el.attrs)) return false; }
      else {
        const key = inner.slice(0, eq).trim();
        const val = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (el.attrs[key] !== val) return false;
      }
    }
  }
  return true;
}

function matchesSelector(el, selector) {
  const parts = selector.trim().split(/\s+/);
  if (parts.length === 1) return matchesSimple(el, parts[0]);
  if (!matchesSimple(el, parts[parts.length - 1])) return false;
  const ancestorSel = parts[parts.length - 2];
  let anc = el.parentElement;
  while (anc) {
    if (matchesSimple(anc, ancestorSel)) return true;
    anc = anc.parentElement;
  }
  return false;
}

function queryAll(root, selector) {
  const out = [];
  (function walk(node) {
    for (const c of node.children) {
      if (matchesSelector(c, selector)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

class FakeImage {
  constructor() {
    this.width = 800;
    this.height = 600;
    this.onload = null;
    this.onerror = null;
    this.crossOrigin = null;
    this._src = '';
  }
  set src(v) { this._src = v; if (typeof this.onload === 'function') this.onload(); }
  get src() { return this._src; }
}

function getListener(el, type) {
  const l = el._listeners.find((x) => x.type === type);
  return l && l.fn;
}

function flushMicrotasks() {
  return new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));
}

/* ── build one fresh sandbox + a driver object over it ── */
function loadEditor() {
  const head = makeEl('head');
  const body = makeEl('body');
  const calls = { updateDoc: [], addDoc: [], uploadBytes: [], getDoc: [] };
  let getDocResponse = null; // set per-open by the test

  const documentObj = Object.assign(makeEl('document'), {
    body, head,
    readyState: 'complete',
    createElement: (tag) => makeEl(tag),
    getElementById: () => null,
  });

  const windowObj = Object.assign(makeEl('window'), {
    innerWidth: 1280,
    devicePixelRatio: 1,
    document: documentObj,
    auth: { currentUser: { uid: 'uid_test_1' } },
    db: {},
    storage: {},
    _userClaims: { companyId: 'company_test_1' },
    doc: (db, col, id) => ({ __col: col, __id: id }),
    collection: (db, col) => ({ __col: col }),
    getDoc: (ref) => { calls.getDoc.push(ref); return Promise.resolve({ exists: () => getDocResponse != null, data: () => getDocResponse || {} }); },
    updateDoc: (ref, data) => { calls.updateDoc.push({ ref, data }); return Promise.resolve(); },
    addDoc: (colRef, data) => { calls.addDoc.push({ colRef, data }); return Promise.resolve({ id: 'new_photo_id' }); },
    ref: (storage, p) => ({ __path: p }),
    uploadBytes: (ref, blob) => { calls.uploadBytes.push({ ref, blob }); return Promise.resolve({}); },
    getDownloadURL: () => Promise.resolve('https://example.test/flattened.jpg'),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    nbdConfirm: () => Promise.resolve(true),
    confirm: () => true,
    prompt: () => '',
  });
  windowObj.window = windowObj;

  const sandbox = {
    window: windowObj,
    document: documentObj,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn) => { try { fn(); } catch (e) { /* toast teardown is best-effort */ } return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame: (fn) => { try { fn(); } catch (e) { /* rAF callback errors aren't this test's concern */ } return 0; },
    cancelAnimationFrame() {},
    Image: FakeImage,
    CanvasRenderingContext2D: function CanvasRenderingContext2D() {},
    URL: { createObjectURL: () => 'blob://x', revokeObjectURL() {} },
    fetch: () => Promise.resolve({ ok: true, blob: () => Promise.resolve({}) }),
    navigator: {},
    prompt: () => '',
    confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(EDITOR_SRC, ctx, { filename: 'photo-editor.js' });

  return {
    api: windowObj.NBDPhotoEditor,
    win: windowObj,
    body,
    calls,
    setGetDocResponse: (data) => { getDocResponse = data; },
    getRoot: () => body.children[body.children.length - 1] || null,
  };
}

/* ============================================================
   1. Open the multi-photo editor on photo_1, switch to photo_2
      via the real thumbnail click handler, Save Tags — the write
      must target photo_2, not the originally-opened photo_1.
   ============================================================ */
group('DOM HARNESS — Save Tags after switchPhoto() targets the NEW photo, not the original');

(async () => {
  const editor = loadEditor();
  const photo1 = { id: 'photo_1', url: 'https://example.test/1.jpg', damageType: '', severity: '', location: '', phase: 'Before', notes: '', tags: [], brightness: 0, contrast: 0 };
  const photo2 = { id: 'photo_2', url: 'https://example.test/2.jpg', damageType: '', severity: '', location: '', phase: 'Before', notes: '', tags: [], brightness: 0, contrast: 0 };
  const allPhotos = [photo1, photo2];

  let openErr = null;
  try {
    await editor.api.open(photo1.url, photo1.id, 'lead_1', photo1, allPhotos);
  } catch (e) { openErr = e; }
  ok('editor opens with no thrown error', !openErr, openErr && (openErr.stack || String(openErr)));

  const root = editor.getRoot();
  ok('an editor overlay root is appended to document.body', !!root && root.classList.contains('nbd-editor-overlay'));
  if (!root) { report(); return; }

  const thumbs = root.querySelectorAll('.nbd-strip-thumb');
  ok('the photo strip renders one thumbnail per photo (multi-photo mode is live)', thumbs.length === 2, 'found ' + thumbs.length);

  const thumb2 = thumbs.find((t) => t.dataset.photoIdx === '1');
  ok('the second thumbnail (idx=1, photo_2) is present', !!thumb2);
  if (!thumb2) { report(); return; }

  const thumbClick = getListener(thumb2, 'click');
  ok('the thumbnail has a real click handler wired to switchPhoto', typeof thumbClick === 'function');
  if (!thumbClick) { report(); return; }

  thumbClick({ target: thumb2, preventDefault() {}, stopPropagation() {} });
  await flushMicrotasks();

  const saveTagsBtn = root.querySelector('[data-act="save-tags"]');
  ok('the Save Tags button is found via [data-act="save-tags"]', !!saveTagsBtn);
  const saveTagsClick = saveTagsBtn && getListener(saveTagsBtn, 'click');
  ok('the Save Tags button has a real click handler', typeof saveTagsClick === 'function');

  if (saveTagsClick) {
    saveTagsClick({ target: saveTagsBtn, preventDefault() {}, stopPropagation() {} });
  }
  await flushMicrotasks();

  ok('exactly one updateDoc call was made by Save Tags', editor.calls.updateDoc.length === 1,
    'updateDoc calls: ' + editor.calls.updateDoc.length);
  const targetId = editor.calls.updateDoc[0] && editor.calls.updateDoc[0].ref && editor.calls.updateDoc[0].ref.__id;
  ok('the updateDoc payload targets photo_2 (the photo on screen after switching), NOT photo_1',
    targetId === 'photo_2', 'updateDoc was called with photoId: ' + targetId);

  /* ============================================================
     2. Same scenario for the flatten-and-save-over path — the
        overwrite branch of uploadBlob() also keys off S.photoId,
        and its storagePath embeds it directly in the filename.
     ============================================================ */
  group('DOM HARNESS — Save (overwrite) after switchPhoto() also targets the NEW photo');

  const saveOverBtn = root.querySelector('[data-act="save-over"]');
  ok('the Save (overwrite) button is found via [data-act="save-over"]', !!saveOverBtn);
  const saveOverClick = saveOverBtn && getListener(saveOverBtn, 'click');
  ok('the Save (overwrite) button has a real click handler', typeof saveOverClick === 'function');

  if (saveOverClick) {
    saveOverClick({ target: saveOverBtn, preventDefault() {}, stopPropagation() {} });
  }
  await flushMicrotasks();

  ok('exactly one uploadBytes call was made by the overwrite save', editor.calls.uploadBytes.length === 1,
    'uploadBytes calls: ' + editor.calls.uploadBytes.length);
  const uploadPath = editor.calls.uploadBytes[0] && editor.calls.uploadBytes[0].ref && editor.calls.uploadBytes[0].ref.__path;
  ok('the overwrite upload path is keyed to photo_2, not photo_1',
    !!uploadPath && uploadPath.indexOf('photo_photo_2.jpg') !== -1 && uploadPath.indexOf('photo_photo_1.jpg') === -1,
    'storagePath: ' + uploadPath);

  ok('exactly two updateDoc calls total (Save Tags + Save-over)', editor.calls.updateDoc.length === 2,
    'updateDoc calls: ' + editor.calls.updateDoc.length);
  const overwriteTargetId = editor.calls.updateDoc[1] && editor.calls.updateDoc[1].ref && editor.calls.updateDoc[1].ref.__id;
  ok('the overwrite updateDoc payload also targets photo_2, NOT photo_1',
    overwriteTargetId === 'photo_2', 'updateDoc was called with photoId: ' + overwriteTargetId);

  /* ============================================================
     3. Switching to a bare-URL string entry (no per-photo doc id)
        must null out S.photoId so the existing "No photo ID" guard
        blocks the save — instead of silently keeping the stale
        photo_2 id and mis-saving onto it.
     ============================================================ */
  group('DOM HARNESS — switching to an id-less (bare URL string) entry blocks the save instead of mis-targeting one');

  allPhotos.push('https://example.test/3-no-id.jpg');
  editor.win.NBDPhotoEditor; // no-op reference just to keep intent obvious
  // Rebuild the strip by re-opening with the 3-photo array, then switch to idx 2.
  let reopenErr = null;
  try {
    await editor.api.open(photo1.url, photo1.id, 'lead_1', photo1, allPhotos);
  } catch (e) { reopenErr = e; }
  ok('re-opening with the 3-photo array does not throw', !reopenErr, reopenErr && (reopenErr.stack || String(reopenErr)));

  const root2 = editor.getRoot();
  const thumbs2 = root2 ? root2.querySelectorAll('.nbd-strip-thumb') : [];
  const thumb3 = thumbs2.find((t) => t.dataset.photoIdx === '2');
  ok('the third (bare-string, id-less) thumbnail is present', !!thumb3);

  if (thumb3) {
    const thumb3Click = getListener(thumb3, 'click');
    if (thumb3Click) { thumb3Click({ target: thumb3, preventDefault() {}, stopPropagation() {} }); }
    await flushMicrotasks();

    const updateDocCountBefore = editor.calls.updateDoc.length;
    const saveTagsBtn2 = root2.querySelector('[data-act="save-tags"]');
    const saveTagsClick2 = saveTagsBtn2 && getListener(saveTagsBtn2, 'click');
    if (saveTagsClick2) { saveTagsClick2({ target: saveTagsBtn2, preventDefault() {}, stopPropagation() {} }); }
    await flushMicrotasks();

    ok('Save Tags makes NO updateDoc call for an id-less photo (refuses instead of mis-saving)',
      editor.calls.updateDoc.length === updateDocCountBefore,
      'updateDoc calls before: ' + updateDocCountBefore + ', after: ' + editor.calls.updateDoc.length);
  }

  report();
})().catch((e) => {
  console.error('\nFATAL', (e && e.stack) || e);
  process.exit(1);
});

function report() {
  console.log('\n──────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
}
