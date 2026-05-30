// ChinaEx annotations: arrows and captions
// Each annotation lives in #annotationsLayer (positioned absolutely over the map).
// Position is stored in PERCENT coordinates of the app container so they reposition
// correctly on window resize. Annotations are encoded into the URL hash as &a=...

(function () {
  'use strict';

  const STORAGE_KEY = 'a'; // URL param name

  // Caption: { type: 'c', x, y, w, h, r, t, fs }  // percent x/y/w/h, rotation deg, text, fontSize px
  // Arrow:   { type: 'a', x1, y1, x2, y2, c }     // percent endpoints, color (hex without #)

  let annotations = [];
  let nextId = 1;
  let selectedAnnId = null;

  // ── Public API ─────────────────────────────────────────────
  window.AnnotationsAPI = {
    addCaption: addCaption,
    addArrow: addArrow,
    addCaptionAtViewCenter: addCaptionAtViewCenter,
    addArrowAtViewCenter: addArrowAtViewCenter,
    encode: encode,
    decode: decode,
    setAll: setAll,
    getAll: () => annotations.slice(),
    clear: clear,
    redrawAll: redrawAll,
    setTransform: setTransform,
    deselect: deselect,
    getTransform: () => Object.assign({}, mapTransform),
  };

  // ── Helpers ────────────────────────────────────────────────
  // The annotations layer lives inside #mapWrapper and shares its (unscaled) size.
  // Coordinates are stored as % of the map wrapper. When the user zooms or pans the
  // map, app.js calls setTransform({k,x,y}) and we re-position each annotation in
  // screen-pixel space without scaling the elements themselves (handles stay readable).
  function appEl() { return document.getElementById('mapWrapper') || document.getElementById('app'); }
  function layerEl() { return document.getElementById('annotationsLayer'); }
  function appRect() { return appEl().getBoundingClientRect(); }

  // Current d3 zoom transform { k, x, y } applied to the underlying map
  let mapTransform = { k: 1, x: 0, y: 0 };

  // Convert a stored (unscaled) % coord to a SCREEN pixel inside the layer (absolute position)
  function pctToPx(pct, dim) {
    const r = appRect();
    const base = (pct / 100) * (dim === 'x' ? r.width : r.height);
    const offset = dim === 'x' ? mapTransform.x : mapTransform.y;
    return offset + base * mapTransform.k;
  }

  // Convert a stored (unscaled) % size to a SCREEN pixel size (no offset, no scale).
  // Annotations keep their pixel size on zoom so handles and text stay readable.
  function pctToPxSize(pct, dim) {
    const r = appRect();
    return (pct / 100) * (dim === 'x' ? r.width : r.height);
  }

  // Convert a SCREEN pixel DELTA (movement) into a delta in unscaled %.
  // When the user drags by N screen pixels and the map is zoomed by k, the
  // underlying movement in unscaled coords is N/k pixels.
  function pxToPct(px, dim) {
    const r = appRect();
    const k = mapTransform.k || 1;
    return (px / (k * (dim === 'x' ? r.width : r.height))) * 100;
  }

  // Convert a screen-pixel delta to an unscaled-pixel delta (no division by container size)
  function pxToPctSize(px, dim) {
    const r = appRect();
    return (px / (dim === 'x' ? r.width : r.height)) * 100;
  }

  // Convert an absolute SCREEN pixel (relative to layer top-left) to unscaled %
  function screenPxToPct(screenPx, dim) {
    const r = appRect();
    const k = mapTransform.k || 1;
    const offset = dim === 'x' ? mapTransform.x : mapTransform.y;
    const base = (screenPx - offset) / k;
    return (base / (dim === 'x' ? r.width : r.height)) * 100;
  }

  function setTransform(t) {
    mapTransform = { k: t.k || 1, x: t.x || 0, y: t.y || 0 };
    redrawPositions();
  }

  function redrawPositions() {
    annotations.forEach(ann => {
      const el = document.querySelector(`.annotation[data-ann-id="${ann.id}"]`);
      if (!el) return;
      if (ann.type === 'c') positionCaption(el, ann);
      else if (ann.type === 'a') positionArrow(el, ann);
    });
  }

  function saveAndNotify() {
    if (typeof window.onAnnotationsChange === 'function') {
      window.onAnnotationsChange();
    }
  }

  function selectAnn(id) {
    selectedAnnId = id;
    document.querySelectorAll('.annotation').forEach(el => {
      el.classList.toggle('selected', el.dataset.annId === String(id));
    });
  }
  function deselect() {
    selectedAnnId = null;
    document.querySelectorAll('.annotation.selected').forEach(el => el.classList.remove('selected'));
  }

  // Click on empty area (incl. the ocean / map background) = deselect.
  // (skipped right after a placement creates a new annotation)
  // Use the CAPTURE phase so this runs before d3-zoom's handler on the map
  // <svg> can stopPropagation() on the mousedown and swallow the event.
  // Controls (buttons/legend/popup/modals) are excluded so they keep working.
  let suppressDeselectOnce = false;
  function handleBackgroundPress(e) {
    if (suppressDeselectOnce) { suppressDeselectOnce = false; return; }
    const t = e.target;
    if (t.closest && (t.closest('.annotation') || t.closest('button') ||
        t.closest('#legend') || t.closest('.popup') || t.closest('.modal') ||
        t.closest('select') || t.closest('input'))) {
      return;
    }
    deselect();
  }
  document.addEventListener('mousedown', handleBackgroundPress, true);
  document.addEventListener('touchstart', handleBackgroundPress, true);

  // Defaults (used for URL compression - omitted when matching)
  const DEFAULT_FS = 14;
  const DEFAULT_R = 0;
  const DEFAULT_ARROW_COLOR = '2d2d2d';

  // ── Add new caption ────────────────────────────────────────
  function addCaption(opts) {
    const ann = Object.assign({
      id: nextId++,
      type: 'c',
      x: 30,    // % from left
      y: 25,    // % from top
      w: 12,    // % width (will auto-fit to content)
      h: 3.5,   // % height (single short line)
      r: 0,     // rotation deg
      t: 'Type here',
      fs: DEFAULT_FS,   // font size px
    }, opts || {});
    annotations.push(ann);
    renderCaption(ann);
    selectAnn(ann.id);
    if (!opts || !opts._silent) saveAndNotify();
    return ann;
  }

  // ── Add new arrow ──────────────────────────────────────────
  function addArrow(opts) {
    const ann = Object.assign({
      id: nextId++,
      type: 'a',
      x1: 35,
      y1: 40,
      x2: 50,
      y2: 50,
      c: DEFAULT_ARROW_COLOR,
    }, opts || {});
    annotations.push(ann);
    renderArrow(ann);
    selectAnn(ann.id);
    if (!opts || !opts._silent) saveAndNotify();
    return ann;
  }

  // ── Insert at center of visible map view ───────────────────
  // Clicking 'Add Arrow' or 'Add Caption' creates the element immediately at the
  // center of whatever portion of the map is currently visible (accounts for zoom/pan).
  function viewCenterPct() {
    const r = appRect();
    return {
      x: screenPxToPct(r.width / 2, 'x'),
      y: screenPxToPct(r.height / 2, 'y'),
    };
  }

  function addCaptionAtViewCenter() {
    const c = viewCenterPct();
    // Create with default size, then center it on the view
    const ann = addCaption({ x: c.x, y: c.y, _silent: true });
    ann.x = c.x - ann.w / 2;
    ann.y = c.y - ann.h / 2;
    const wrapEl = document.querySelector(`.annotation[data-ann-id="${ann.id}"]`);
    if (wrapEl) positionCaption(wrapEl, ann);
    selectAnn(ann.id);
    saveAndNotify();
    return ann;
  }

  function addArrowAtViewCenter() {
    const c = viewCenterPct();
    // Pick a reasonable arrow length based on the visible viewport size
    const halfLenPct = 4; // % of unscaled wrapper, looks good across zoom levels
    const ann = addArrow({
      x1: c.x - halfLenPct,
      y1: c.y - halfLenPct / 2,
      x2: c.x + halfLenPct,
      y2: c.y + halfLenPct / 2,
    });
    selectAnn(ann.id);
    return ann;
  }

  function beginCaptionDrag(e, wrap, ann) {
    const startX = e.clientX;
    const startY = e.clientY;
    const startAnnX = ann.x;
    const startAnnY = ann.y;
    const move = (ev) => {
      const dx = pxToPct(ev.clientX - startX, 'x');
      const dy = pxToPct(ev.clientY - startY, 'y');
      ann.x = startAnnX + dx;
      ann.y = startAnnY + dy;
      positionCaption(wrap, ann);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveAndNotify();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function beginArrowEndpointDrag(e, wrap, ann, idx) {
    const move = (ev) => {
      const r = appRect();
      const x = screenPxToPct(ev.clientX - r.left, 'x');
      const y = screenPxToPct(ev.clientY - r.top, 'y');
      if (idx === 1) { ann.x1 = x; ann.y1 = y; }
      else { ann.x2 = x; ann.y2 = y; }
      positionArrow(wrap, ann);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveAndNotify();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // ── Render caption ─────────────────────────────────────────
  function renderCaption(ann) {
    const wrap = document.createElement('div');
    wrap.className = 'annotation';
    wrap.dataset.annId = ann.id;

    const cap = document.createElement('div');
    cap.className = 'annotation-caption';
    cap.textContent = ann.t;
    cap.style.fontSize = ann.fs + 'px';
    wrap.appendChild(cap);

    const resize = document.createElement('div');
    resize.className = 'ann-handle ann-handle-resize';
    wrap.appendChild(resize);

    const rotate = document.createElement('div');
    rotate.className = 'ann-handle ann-handle-rotate';
    wrap.appendChild(rotate);

    const del = document.createElement('button');
    del.className = 'ann-handle ann-handle-delete';
    del.textContent = '×';
    del.title = 'Delete';
    wrap.appendChild(del);

    layerEl().appendChild(wrap);
    // Auto-fit on initial render so the wrap matches the natural text size
    autoFitCaption(wrap, cap, ann);
    positionCaption(wrap, ann);

    // Drag to move
    setupDrag(wrap, cap, ann, () => positionCaption(wrap, ann));

    // Double-click / dbltap to edit
    cap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      cap.setAttribute('contenteditable', 'true');
      cap.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(cap);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    cap.addEventListener('blur', () => {
      if (cap.getAttribute('contenteditable') === 'true') {
        cap.removeAttribute('contenteditable');
        ann.t = cap.textContent;
        autoFitCaption(wrap, cap, ann);
        positionCaption(wrap, ann);
        saveAndNotify();
      }
    });
    cap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // Captions are always single-line - prevent newline insertion
        e.preventDefault();
        cap.blur();
      } else if (e.key === 'Escape') {
        cap.blur();
      }
    });
    // Strip newlines from pasted content to keep captions single-line
    cap.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const single = text.replace(/[\r\n\t]+/g, ' ');
      // Insert as plain text at the cursor
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(single));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        cap.textContent += single;
      }
    });

    // Resize: drag the resize handle to change width/height + font size
    setupResize(wrap, resize, ann, cap);

    // Rotate
    setupRotate(wrap, rotate, ann);

    // Delete
    del.addEventListener('mousedown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAnnotation(ann.id);
    });

    wrap.addEventListener('mousedown', (e) => {
      if (e.target === cap || e.target === wrap) selectAnn(ann.id);
    });
  }

  function positionCaption(wrap, ann) {
    wrap.style.left = pctToPx(ann.x, 'x') + 'px';
    wrap.style.top = pctToPx(ann.y, 'y') + 'px';
    wrap.style.width = pctToPxSize(ann.w, 'x') + 'px';
    wrap.style.height = pctToPxSize(ann.h, 'y') + 'px';
    wrap.style.transform = `rotate(${ann.r}deg)`;
    const cap = wrap.querySelector('.annotation-caption');
    if (cap) {
      cap.style.width = '100%';
      cap.style.height = '100%';
      cap.style.fontSize = ann.fs + 'px';
    }
  }

  // Measure natural caption size and update ann.w/ann.h to fit content tightly
  function autoFitCaption(wrap, cap, ann) {
    // Temporarily release sizing so the caption sizes to its content
    const prevW = cap.style.width, prevH = cap.style.height;
    const prevWrapW = wrap.style.width, prevWrapH = wrap.style.height;
    const prevTransform = wrap.style.transform;
    cap.style.width = 'auto';
    cap.style.height = 'auto';
    wrap.style.width = 'auto';
    wrap.style.height = 'auto';
    // CRITICAL: clear rotation while measuring. getBoundingClientRect on a rotated
    // element returns the AXIS-ALIGNED bounding box (which is larger and skewed),
    // not the element's natural width/height. We need the unrotated size so the
    // caption box fits its text correctly at any rotation.
    wrap.style.transform = 'none';
    cap.style.fontSize = ann.fs + 'px';
    const r = cap.getBoundingClientRect();
    // Caption is not affected by map zoom (layer is unscaled), so convert directly
    ann.w = pxToPctSize(r.width, 'x');
    ann.h = pxToPctSize(r.height, 'y');
    // Restore (positionCaption will set final values)
    cap.style.width = prevW;
    cap.style.height = prevH;
    wrap.style.width = prevWrapW;
    wrap.style.height = prevWrapH;
    wrap.style.transform = prevTransform;
  }

  // ── Render arrow ───────────────────────────────────────────
  function renderArrow(ann) {
    const wrap = document.createElement('div');
    wrap.className = 'annotation annotation-arrow';
    wrap.dataset.annId = ann.id;

    // SVG with hand-drawn-style curved arrow + sketchy arrowhead
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    // Curved shaft (quadratic Bezier) - feels more like a hand-drawn note arrow
    const shaft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shaft.setAttribute('class', 'arrow-shaft');
    shaft.setAttribute('stroke', '#' + ann.c);
    shaft.setAttribute('stroke-width', '2.4');
    shaft.setAttribute('stroke-linecap', 'round');
    shaft.setAttribute('stroke-linejoin', 'round');
    shaft.setAttribute('fill', 'none');
    shaft.style.pointerEvents = 'stroke';
    shaft.style.cursor = 'move';
    svg.appendChild(shaft);

    // Arrowhead drawn as two short strokes (V-shape) - more notebook-style than a filled triangle
    const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    head.setAttribute('class', 'arrow-head');
    head.setAttribute('stroke', '#' + ann.c);
    head.setAttribute('stroke-width', '2.4');
    head.setAttribute('stroke-linecap', 'round');
    head.setAttribute('stroke-linejoin', 'round');
    head.setAttribute('fill', 'none');
    head.style.pointerEvents = 'none';
    svg.appendChild(head);

    wrap.appendChild(svg);

    // Endpoint handles
    const h1 = document.createElement('div');
    h1.className = 'ann-handle-endpoint ann-handle-endpoint-1';
    wrap.appendChild(h1);
    const h2 = document.createElement('div');
    h2.className = 'ann-handle-endpoint ann-handle-endpoint-2';
    wrap.appendChild(h2);

    // Delete button (positioned at midpoint)
    const del = document.createElement('button');
    del.className = 'ann-handle ann-handle-delete';
    del.textContent = '×';
    del.title = 'Delete';
    wrap.appendChild(del);

    layerEl().appendChild(wrap);
    positionArrow(wrap, ann);

    // Drag entire arrow by clicking the shaft
    shaft.addEventListener('mousedown', (e) => startArrowDrag(e, wrap, ann));
    shaft.addEventListener('touchstart', (e) => startArrowDrag(e.touches[0], wrap, ann, e), { passive: false });

    // Drag endpoints
    setupArrowEndpoint(h1, ann, 1, wrap);
    setupArrowEndpoint(h2, ann, 2, wrap);

    // Delete
    del.addEventListener('mousedown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAnnotation(ann.id);
    });

    wrap.addEventListener('mousedown', () => selectAnn(ann.id));
  }

  function positionArrow(wrap, ann) {
    // Bounding box of the arrow (with padding for curve bow + arrowhead)
    const x1px = pctToPx(ann.x1, 'x');
    const y1px = pctToPx(ann.y1, 'y');
    const x2px = pctToPx(ann.x2, 'x');
    const y2px = pctToPx(ann.y2, 'y');
    const pad = 24;
    const minX = Math.min(x1px, x2px) - pad;
    const minY = Math.min(y1px, y2px) - pad;
    const w = Math.abs(x2px - x1px) + pad * 2;
    const h = Math.abs(y2px - y1px) + pad * 2;
    wrap.style.left = minX + 'px';
    wrap.style.top = minY + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';

    // Local coords inside the SVG
    const lx1 = x1px - minX, ly1 = y1px - minY;
    const lx2 = x2px - minX, ly2 = y2px - minY;

    // Curved shaft: quadratic Bezier with control point offset perpendicular to line
    const dx = lx2 - lx1, dy = ly2 - ly1;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    // Perpendicular unit vector
    const px_ = -dy / len, py_ = dx / len;
    // Curve magnitude: gentle bow, scales with length but capped
    const bow = Math.min(len * 0.12, 18);
    const cxp = (lx1 + lx2) / 2 + px_ * bow;
    const cyp = (ly1 + ly2) / 2 + py_ * bow;

    const shaft = wrap.querySelector('.arrow-shaft');
    shaft.setAttribute('d', `M ${lx1} ${ly1} Q ${cxp} ${cyp} ${lx2} ${ly2}`);

    // Arrowhead: two short strokes from the tip, angled relative to the curve's incoming tangent
    // Tangent at end of quadratic Bezier = direction from control point to endpoint
    const tdx = lx2 - cxp, tdy = ly2 - cyp;
    const tlen = Math.max(1, Math.sqrt(tdx * tdx + tdy * tdy));
    const tux = tdx / tlen, tuy = tdy / tlen;
    const headSize = Math.min(12, Math.max(8, len * 0.18));
    const spread = 0.55; // radians (~31 deg)
    const cos = Math.cos(spread), sin = Math.sin(spread);
    // Two backward vectors rotated +/- spread
    const b1x = -tux * cos - -tuy * sin;
    const b1y = -tuy * cos + -tux * sin;
    const b2x = -tux * cos + -tuy * sin;
    const b2y = -tuy * cos - -tux * sin;
    const hx1 = lx2 + b1x * headSize, hy1 = ly2 + b1y * headSize;
    const hx2 = lx2 + b2x * headSize, hy2 = ly2 + b2y * headSize;
    const head = wrap.querySelector('.arrow-head');
    head.setAttribute('d', `M ${hx1} ${hy1} L ${lx2} ${ly2} L ${hx2} ${hy2}`);

    // Endpoints
    const h1 = wrap.querySelector('.ann-handle-endpoint-1');
    h1.style.left = lx1 + 'px';
    h1.style.top = ly1 + 'px';
    const h2 = wrap.querySelector('.ann-handle-endpoint-2');
    h2.style.left = lx2 + 'px';
    h2.style.top = ly2 + 'px';

    // Delete button: place near the curve's apex (offset perpendicular from midpoint)
    const del = wrap.querySelector('.ann-handle-delete');
    if (del) {
      const apexX = cxp;
      const apexY = cyp;
      del.style.position = 'absolute';
      del.style.left = (apexX - 9) + 'px';
      del.style.top = (apexY - 9) + 'px';
      del.style.right = 'auto';
    }
  }

  // ── Drag move helpers ──────────────────────────────────────
  function setupDrag(wrap, dragHandle, ann, onMove) {
    const start = (e) => {
      if (dragHandle.getAttribute('contenteditable') === 'true') return;
      // Don't start drag on resize/rotate/delete handles
      if (e.target.classList && (
        e.target.classList.contains('ann-handle-resize') ||
        e.target.classList.contains('ann-handle-rotate') ||
        e.target.classList.contains('ann-handle-delete')
      )) return;
      e.preventDefault();
      e.stopPropagation();
      selectAnn(ann.id);
      const startX = e.clientX;
      const startY = e.clientY;
      const startAnnX = ann.x;
      const startAnnY = ann.y;

      const move = (ev) => {
        const dx = pxToPct(ev.clientX - startX, 'x');
        const dy = pxToPct(ev.clientY - startY, 'y');
        ann.x = clamp(startAnnX + dx, 0, 100 - ann.w);
        ann.y = clamp(startAnnY + dy, 0, 100 - ann.h);
        onMove();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        saveAndNotify();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    dragHandle.addEventListener('mousedown', start);
    dragHandle.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      start({
        clientX: t.clientX, clientY: t.clientY,
        target: e.target, classList: e.target.classList,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation()
      });
    }, { passive: false });
  }

  function startArrowDrag(e, wrap, ann) {
    e.stopPropagation && e.stopPropagation();
    if (arguments[3] && arguments[3].preventDefault) arguments[3].preventDefault();
    selectAnn(ann.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const x1 = ann.x1, y1 = ann.y1, x2 = ann.x2, y2 = ann.y2;
    const move = (ev) => {
      const cx = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      const cy = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0].clientY);
      const dx = pxToPct(cx - startX, 'x');
      const dy = pxToPct(cy - startY, 'y');
      ann.x1 = clamp(x1 + dx, 0, 100);
      ann.y1 = clamp(y1 + dy, 0, 100);
      ann.x2 = clamp(x2 + dx, 0, 100);
      ann.y2 = clamp(y2 + dy, 0, 100);
      positionArrow(wrap, ann);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      saveAndNotify();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  }

  function setupArrowEndpoint(handle, ann, idx, wrap) {
    const start = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAnn(ann.id);
      const move = (ev) => {
        const cx = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0].clientX);
        const cy = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0].clientY);
        const r = appRect();
        // Convert screen pos to layer-relative, then to unscaled %
        const x = clamp(screenPxToPct(cx - r.left, 'x'), -50, 150);
        const y = clamp(screenPxToPct(cy - r.top, 'y'), -50, 150);
        if (idx === 1) { ann.x1 = x; ann.y1 = y; }
        else { ann.x2 = x; ann.y2 = y; }
        positionArrow(wrap, ann);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', up);
        saveAndNotify();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    };
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
  }

  function setupResize(wrap, handle, ann, cap) {
    const start = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAnn(ann.id);
      const startX = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
      const startY = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;
      const startW = ann.w;
      const startH = ann.h;
      const startFs = ann.fs;
      const move = (ev) => {
        const cx = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0].clientX);
        const cy = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0].clientY);
        // Caption box doesn't scale with zoom - use direct pixel-to-% conversion
        const dx = pxToPctSize(cx - startX, 'x');
        const dy = pxToPctSize(cy - startY, 'y');
        ann.w = Math.max(4, startW + dx);
        ann.h = Math.max(2.5, startH + dy);
        // Scale font with height for readability
        const scale = ann.h / startH;
        ann.fs = Math.max(8, Math.round(startFs * scale));
        positionCaption(wrap, ann);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', up);
        saveAndNotify();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    };
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
  }

  function setupRotate(wrap, handle, ann) {
    const start = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAnn(ann.id);
      const r = wrap.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const move = (ev) => {
        const px = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0].clientX);
        const py = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0].clientY);
        const angle = Math.atan2(py - cy, px - cx) * 180 / Math.PI + 90;
        ann.r = Math.round(angle);
        wrap.style.transform = `rotate(${ann.r}deg)`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', up);
        saveAndNotify();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    };
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
  }

  function clamp(n, mn, mx) { return Math.max(mn, Math.min(mx, n)); }

  // ── Remove ─────────────────────────────────────────────────
  function removeAnnotation(id) {
    annotations = annotations.filter(a => a.id !== id);
    const el = document.querySelector(`.annotation[data-ann-id="${id}"]`);
    if (el) el.remove();
    saveAndNotify();
  }

  function clear() {
    annotations = [];
    layerEl().innerHTML = '';
  }

  function redrawAll() {
    layerEl().innerHTML = '';
    annotations.forEach(ann => {
      if (ann.type === 'c') renderCaption(ann);
      else if (ann.type === 'a') renderArrow(ann);
    });
  }

  // ── URL encoding ───────────────────────────────────────────
  // Format: a=<json compact>  (URL-safe base64? no - just URI-encoded JSON)
  // We use a compact JSON array to keep the URL readable.
  function round1(n) { return Math.round(n * 10) / 10; }

  // Compact pipe-delimited format separated by '~':
  //   Caption: c|x|y|w|h|r|text|fs   (fs dropped when default)
  //   Arrow:   a|x1|y1|x2|y2|c       (c dropped when default)
  // 1-decimal precision; caption text URI-encoded individually so '~' and '|'
  // inside text can't break the format.
  // Backward-compatible: also reads the previous JSON format.
  function encode() {
    if (!annotations.length) return '';
    const parts = annotations.map(a => {
      if (a.type === 'c') {
        const fields = [
          'c',
          round1(a.x), round1(a.y),
          round1(a.w), round1(a.h),
          a.r || 0,
          encodeURIComponent(a.t || ''),
          a.fs || DEFAULT_FS,
        ];
        if (fields[fields.length - 1] === DEFAULT_FS) fields.pop();
        return fields.join('|');
      } else {
        const fields = [
          'a',
          round1(a.x1), round1(a.y1),
          round1(a.x2), round1(a.y2),
          a.c || DEFAULT_ARROW_COLOR,
        ];
        if (fields[fields.length - 1] === DEFAULT_ARROW_COLOR) fields.pop();
        return fields.join('|');
      }
    });
    return STORAGE_KEY + '=' + parts.join('~');
  }

  function decode(paramStr) {
    if (!paramStr) return;
    try {
      let arr;
      // Old format was URI-encoded JSON; new format starts with 'c|' or 'a|'
      const firstChar = paramStr.charAt(0);
      if (firstChar === '%' || firstChar === '[') {
        // Old JSON path
        arr = JSON.parse(decodeURIComponent(paramStr));
      } else {
        arr = paramStr.split('~').map(parseCompact).filter(Boolean);
      }
      if (!Array.isArray(arr)) return;
      annotations = arr.map(a => Object.assign({ id: nextId++ }, a));
      redrawAll();
    } catch (e) {
      console.warn('Failed to decode annotations:', e);
    }
  }

  function parseCompact(str) {
    if (!str) return null;
    const f = str.split('|');
    if (f[0] === 'c') {
      return {
        type: 'c',
        x: parseFloat(f[1]) || 0,
        y: parseFloat(f[2]) || 0,
        w: parseFloat(f[3]) || 12,
        h: parseFloat(f[4]) || 3.5,
        r: parseFloat(f[5]) || 0,
        t: f[6] !== undefined ? decodeURIComponent(f[6]) : '',
        fs: f[7] !== undefined ? parseFloat(f[7]) : DEFAULT_FS,
      };
    } else if (f[0] === 'a') {
      return {
        type: 'a',
        x1: parseFloat(f[1]) || 0,
        y1: parseFloat(f[2]) || 0,
        x2: parseFloat(f[3]) || 0,
        y2: parseFloat(f[4]) || 0,
        c: f[5] !== undefined ? f[5] : DEFAULT_ARROW_COLOR,
      };
    }
    return null;
  }

  function setAll(arr) {
    clear();
    annotations = (arr || []).map(a => Object.assign({ id: nextId++ }, a));
    redrawAll();
  }

  // ── Resize handler: reposition all annotations ─────────────
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      annotations.forEach(ann => {
        const el = document.querySelector(`.annotation[data-ann-id="${ann.id}"]`);
        if (!el) return;
        if (ann.type === 'c') positionCaption(el, ann);
        else if (ann.type === 'a') positionArrow(el, ann);
      });
    }, 100);
  });

})();
