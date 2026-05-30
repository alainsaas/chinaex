// ChinaEx - Interactive China Prefecture Explorer
// All state is encoded in the URL hash

(function() {
  'use strict';

  // ── Color scheme ──────────────────────────────────────────
  const COLORS = {
    0: '#ffffff',
    1: '#3598db',
    2: '#30cc70',
    3: '#f3c218',
    4: '#d58337',
    5: '#e84c3d'
  };

  // ── Halo colors ───────────────────────────────────────────
  // Very light tints of each level's color. When any prefecture in a province
  // reaches level 1-5, every level-0 prefecture in that same province is painted
  // with the halo tint of the HIGHEST level reached anywhere in the province.
  // This is purely visual: it never changes the score (those prefectures stay
  // level 0 in `state`).
  const HALO_COLORS = {
    1: '#e7f2fb', // light blue
    2: '#e3f7eb', // light green
    3: '#fdf5d6', // light yellow
    4: '#f8ece0', // light orange
    5: '#fbe4e1'  // light red
  };

  // ── State ─────────────────────────────────────────────────
  const state = {};          // regionId → level (0-5)
  const provinceMembers = {}; // countryIso → [prefecture ids]
  let currentLang = 'local';    // 'en' or 'local' (Chinese is the default)
  let authorName = '';
  let currentRegion = null;  // currently selected region id
  let geoData = null;        // loaded topojson/geojson
  let regionLookup = {};     // regionId → {en, local, countryIso, countryEn}
  let countryGeometries = {};// iso → merged geometry for thick borders
  let pathGenerator = null;
  let projection = null;
  let svg, g, zoom;

  // ── Build region lookup ───────────────────────────────────
  function buildLookup() {
    COUNTRIES.forEach(c => {
      c.subs.forEach(s => {
        regionLookup[s.id] = {
          en: s.en,
          local: s.local,
          countryIso: c.iso,
          countryEn: c.en,
          countryLocal: c.local
        };
        state[s.id] = 0;
        (provinceMembers[c.iso] = provinceMembers[c.iso] || []).push(s.id);
      });
    });
  }

  // ── Province halo tinting ─────────────────────────────────
  // For each region, return the fill it should display: its own level color if
  // it has a level > 0, otherwise the halo tint of the highest level reached in
  // its province (or plain white if nothing in the province is set).
  function fillFor(id) {
    const lvl = state[id] || 0;
    if (lvl > 0) return COLORS[lvl];
    const iso = regionLookup[id] && regionLookup[id].countryIso;
    const members = iso ? provinceMembers[iso] : null;
    if (members) {
      let maxLvl = 0;
      for (let i = 0; i < members.length; i++) {
        const m = state[members[i]] || 0;
        if (m > maxLvl) maxLvl = m;
      }
      if (maxLvl > 0) return HALO_COLORS[maxLvl];
    }
    return COLORS[0];
  }

  // ── URL hash encode/decode ────────────────────────────────
  function encodeHash() {
    let hash = '';
    REGION_ORDER.forEach(id => {
      hash += (state[id] || 0).toString();
    });
    let url = '#' + hash;
    if (authorName) {
      url += '&n=' + encodeURIComponent(authorName);
    }
    if (window.AnnotationsAPI) {
      const annStr = window.AnnotationsAPI.encode();
      if (annStr) url += '&' + annStr;
    }
    history.replaceState(undefined, document.title, url);
  }

  function decodeHash() {
    let raw = window.location.hash.substring(1);
    // Extract name parameter if present
    const ampIdx = raw.indexOf('&');
    if (ampIdx !== -1) {
      const params = raw.substring(ampIdx + 1);
      raw = raw.substring(0, ampIdx);
      const parts = params.split('&');
      parts.forEach(p => {
        const eq = p.indexOf('=');
        if (eq === -1) return;
        const key = p.substring(0, eq);
        const val = p.substring(eq + 1);
        if (key === 'n' && val) {
          authorName = decodeURIComponent(val);
          document.getElementById('authorName').textContent = authorName;
        } else if (key === 'a' && val && window.AnnotationsAPI) {
          window.AnnotationsAPI.decode(val);
        }
      });
    }
    if (!raw || raw.length !== TOTAL_REGIONS) return false;
    for (let i = 0; i < TOTAL_REGIONS; i++) {
      const val = parseInt(raw[i]);
      if (isNaN(val) || val < 0 || val > 5) return false;
      state[REGION_ORDER[i]] = val;
    }
    return true;
  }

  // ── Score calculation ─────────────────────────────────────
  function calcScore() {
    let total = 0;
    REGION_ORDER.forEach(id => { total += (state[id] || 0); });
    return total;
  }

  function updateScore() {
    document.getElementById('levelScore').textContent = calcScore();
  }

  // ── Apply colors to map ───────────────────────────────────
  function applyColors() {
    REGION_ORDER.forEach(id => {
      const path = document.querySelector(`path[data-id="${id}"]`);
      if (path) {
        path.style.fill = fillFor(id);
      }
    });
  }

  // ── Popup ─────────────────────────────────────────────────
  const popup = document.getElementById('popup');
  const popupTitle = document.getElementById('popupTitle');

  function showPopup(regionId, x, y) {
    currentRegion = regionId;
    const info = regionLookup[regionId];
    if (!info) return;
    
    const name = currentLang === 'en' ? info.en : info.local;
    const country = currentLang === 'en' ? info.countryEn : info.countryLocal;
    popupTitle.textContent = `@ ${name}, ${country}`;

    // Highlight current level
    popup.querySelectorAll('.popup-level').forEach(btn => {
      const lvl = parseInt(btn.dataset.level);
      btn.classList.toggle('active', lvl === (state[regionId] || 0));
    });

    // Position popup
    const appRect = document.getElementById('app').getBoundingClientRect();
    let left = x + 10;
    let top = y - 10;
    
    // Keep popup in viewport
    const popupW = 200;
    const popupH = 260;
    if (left + popupW > appRect.width) left = x - popupW - 10;
    if (top + popupH > appRect.height) top = appRect.height - popupH - 10;
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.classList.add('show');
  }

  function hidePopup() {
    popup.classList.remove('show');
    currentRegion = null;
  }

  // ── Map initialization ────────────────────────────────────
  function initMap() {
    const container = document.getElementById('mapContainer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg = d3.select('#mapSvg')
      .attr('width', width)
      .attr('height', height);

    // Background rect
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#9dc3fb');

    g = svg.append('g');

    // Projection: Albers equal-area centered on China
    projection = d3.geoConicEqualArea()
      .center([0, 36])
      .rotate([-105, 0])
      .parallels([25, 47])
      .scale(Math.min(width, height) * 1.55)
      .translate([width * 0.5, height * 0.52]);

    pathGenerator = d3.geoPath().projection(projection);

    // Zoom behavior with pan constraints
    const margin = 200; // pixels of slack before hitting edge
    zoom = d3.zoom()
      .scaleExtent([0.8, 20])
      .translateExtent([[-margin, -margin], [width + margin, height + margin]])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        const k = event.transform.k;
        // Scale borders inversely so they stay readable
        g.selectAll('.country-border').attr('stroke-width', 2.25 / k);
        g.selectAll('.region-path').attr('stroke-width', 0.1125 / k);
        g.selectAll('.rail-line').attr('stroke-width', 0.6 / k);
        // Move annotations with the map
        if (window.AnnotationsAPI && window.AnnotationsAPI.setTransform) {
          window.AnnotationsAPI.setTransform({
            k: event.transform.k,
            x: event.transform.x,
            y: event.transform.y,
          });
        }
      });

    svg.call(zoom);

    // Load map data
    loadMapData();
  }

  function loadMapData() {
    const geojson = CHINA_GEOJSON;
    geoData = geojson;
    const features = geojson.features;

    // Draw regions first (below country borders)
    const regionGroup = g.append('g').attr('class', 'regions-group');
    regionGroup.selectAll('.region-path')
      .data(features)
      .enter()
      .append('path')
      .attr('class', 'region-path')
      .attr('d', pathGenerator)
      .attr('data-id', d => d.properties.id)
      .style('fill', d => fillFor(d.properties.id));

    // Draw province-level borders on top (non-interactive).
    // The internal prefecture boundaries are already dissolved offline at build
    // time (see assets/province-borders.js -> PROVINCE_BORDERS), so each province
    // is a single outline. Doing this here in the browser via topojson.merge was
    // far too slow (~25s freeze on load), so we just draw the precomputed shapes.
    const borderGroup = g.append('g').attr('class', 'borders-group');
    if (typeof PROVINCE_BORDERS !== 'undefined' && PROVINCE_BORDERS.features) {
      borderGroup.selectAll('.country-border')
        .data(PROVINCE_BORDERS.features)
        .enter()
        .append('path')
        .attr('class', 'country-border')
        .attr('d', pathGenerator);
    }

    // Draw the main long-distance train lines on top (thin dark, non-interactive).
    // These are real high-speed rail tracks (from OpenStreetMap) so users can see
    // which prefectures a train passes through and record them. They never affect
    // clicks or score - pointer-events are disabled in CSS.
    const railGroup = g.append('g').attr('class', 'rail-group');
    if (typeof RAIL_LINES !== 'undefined' && RAIL_LINES.features) {
      railGroup.selectAll('.rail-line')
        .data(RAIL_LINES.features)
        .enter()
        .append('path')
        .attr('class', d => 'rail-line' + (d.properties && d.properties.kind === 'conventional' ? ' rail-line-conv' : ''))
        .attr('d', pathGenerator);
    }

    // Click handler on region paths
    regionGroup.selectAll('.region-path').on('click', function(event, d) {
      event.stopPropagation();
      const regionId = d.properties.id;
      if (regionId && regionLookup[regionId]) {
        showPopup(regionId, event.clientX, event.clientY);
      }
    });
    
    // Click on SVG background closes popup
    svg.on('click', function(event) {
      if (!event.target.closest('.popup')) {
        hidePopup();
      }
    });
  }



  // ── Event handlers ────────────────────────────────────────
  function setupEvents() {
    // Close popup button
    document.getElementById('popupClose').addEventListener('click', hidePopup);

    // Level selection in popup
    popup.querySelectorAll('.popup-level').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!currentRegion) return;
        const level = parseInt(btn.dataset.level);
        state[currentRegion] = level;

        // Recolor the whole map: the changed prefecture takes its own color, and
        // every level-0 prefecture in the same province may pick up (or drop) the
        // light province halo based on the new highest level in that province.
        applyColors();

        updateScore();
        encodeHash();
        hidePopup();
      });
    });

    // Language toggle
    document.getElementById('langSelect').addEventListener('change', (e) => {
      currentLang = e.target.value;
    });

    // Dismissible map disclaimer note (hide the whole note incl. the X button)
    const mapNoteClose = document.getElementById('mapNoteClose');
    if (mapNoteClose) {
      mapNoteClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const note = document.getElementById('mapNote');
        if (note) {
          note.classList.add('hidden');
          note.style.display = 'none';
        }
      });
    }

    // Add Name
    document.getElementById('addNameBtn').addEventListener('click', () => {
      document.getElementById('nameInput').value = authorName;
      document.getElementById('nameModal').classList.add('show');
      document.getElementById('nameInput').focus();
    });

    document.getElementById('nameOk').addEventListener('click', () => {
      authorName = document.getElementById('nameInput').value.trim();
      document.getElementById('authorName').textContent = authorName;
      document.getElementById('nameModal').classList.remove('show');
      encodeHash();
    });

    document.getElementById('nameCancel').addEventListener('click', () => {
      document.getElementById('nameModal').classList.remove('show');
    });

    document.getElementById('nameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('nameOk').click();
      if (e.key === 'Escape') document.getElementById('nameCancel').click();
    });

    // Save Image
    document.getElementById('saveImgBtn').addEventListener('click', saveImage);

    // Add Arrow / Add Caption: instantly drop the new element in the center of the visible map
    const addArrowBtn = document.getElementById('addArrowBtn');
    if (addArrowBtn) {
      addArrowBtn.addEventListener('click', () => {
        if (!window.AnnotationsAPI) return;
        window.AnnotationsAPI.addArrowAtViewCenter();
        checkUrlLengthAndWarn();
      });
    }
    const addCaptionBtn = document.getElementById('addCaptionBtn');
    if (addCaptionBtn) {
      addCaptionBtn.addEventListener('click', () => {
        if (!window.AnnotationsAPI) return;
        window.AnnotationsAPI.addCaptionAtViewCenter();
        checkUrlLengthAndWarn();
      });
    }

    // Zoom buttons
    document.getElementById('zoomInBtn').addEventListener('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1.5);
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.5);
    });

    // Save URL
    document.getElementById('saveUrlBtn').addEventListener('click', () => {
      encodeHash();
      const fullUrl = window.location.href;
      navigator.clipboard.writeText(fullUrl).catch(() => {});
      document.getElementById('saveUrlField').value = fullUrl;
      document.getElementById('saveModal').classList.add('show');
    });

    document.getElementById('copyUrlBtn').addEventListener('click', () => {
      const urlField = document.getElementById('saveUrlField');
      urlField.select();
      navigator.clipboard.writeText(urlField.value).then(() => {
        document.getElementById('copyUrlBtn').textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('copyUrlBtn').textContent = 'Copy URL';
        }, 2000);
      }).catch(() => {
        document.execCommand('copy');
      });
    });

    document.getElementById('saveModalClose').addEventListener('click', () => {
      document.getElementById('saveModal').classList.remove('show');
    });

    // Reset
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (confirm('Reset all regions to Level 0?')) {
        REGION_ORDER.forEach(id => { state[id] = 0; });
        applyColors();
        updateScore();
        encodeHash();
      }
    });

    // About
    document.getElementById('aboutClose').addEventListener('click', () => {
      document.getElementById('aboutModal').classList.remove('show');
    });

    // Legend drag
    const legendEl = document.getElementById('legend');
    let dragState = null;

    // Pin legend to top/left anchors before dragging so any CSS bottom/right
    // anchors (e.g. mobile media-query placement) don't cause the box to stretch.
    function pinLegendToTopLeft() {
      const appRect = document.getElementById('app').getBoundingClientRect();
      const rect = legendEl.getBoundingClientRect();
      legendEl.style.left = (rect.left - appRect.left) + 'px';
      legendEl.style.top = (rect.top - appRect.top) + 'px';
      legendEl.style.bottom = 'auto';
      legendEl.style.right = 'auto';
    }

    legendEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pinLegendToTopLeft();
      legendEl.classList.add('dragging');
      const rect = legendEl.getBoundingClientRect();
      dragState = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      const appRect = document.getElementById('app').getBoundingClientRect();
      let x = e.clientX - appRect.left - dragState.offsetX;
      let y = e.clientY - appRect.top - dragState.offsetY;
      // Constrain within app bounds
      x = Math.max(0, Math.min(x, appRect.width - legendEl.offsetWidth));
      y = Math.max(0, Math.min(y, appRect.height - legendEl.offsetHeight));
      legendEl.style.left = x + 'px';
      legendEl.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragState) {
        legendEl.classList.remove('dragging');
        dragState = null;
      }
    });

    // Touch drag support
    legendEl.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      pinLegendToTopLeft();
      const rect = legendEl.getBoundingClientRect();
      dragState = { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };
      legendEl.classList.add('dragging');
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!dragState) return;
      const touch = e.touches[0];
      const appRect = document.getElementById('app').getBoundingClientRect();
      let x = touch.clientX - appRect.left - dragState.offsetX;
      let y = touch.clientY - appRect.top - dragState.offsetY;
      x = Math.max(0, Math.min(x, appRect.width - legendEl.offsetWidth));
      y = Math.max(0, Math.min(y, appRect.height - legendEl.offsetHeight));
      legendEl.style.left = x + 'px';
      legendEl.style.top = y + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (dragState) {
        legendEl.classList.remove('dragging');
        dragState = null;
      }
    });

    // Resize
    window.addEventListener('resize', debounce(() => {
      const container = document.getElementById('mapContainer');
      const w = container.clientWidth;
      const h = container.clientHeight;
      svg.attr('width', w).attr('height', h);
      svg.select('rect').attr('width', w).attr('height', h);
      
      projection.scale(Math.min(w, h) * 1.55).translate([w * 0.5, h * 0.52]);
      zoom.translateExtent([[-200, -200], [w + 200, h + 200]]);
      g.selectAll('.region-path').attr('d', pathGenerator);
      g.selectAll('.country-border').attr('d', pathGenerator);
      g.selectAll('.rail-line').attr('d', pathGenerator);

    }, 200));
  }

  // ── Save image ────────────────────────────────────────────
  function saveImage() {
    const svgEl = document.getElementById('mapSvg');
    // Clone the SVG so we can bake inline fill attributes without affecting the live DOM
    const clone = svgEl.cloneNode(true);
    // Bake computed fill colors into each region path as attributes
    const livePaths = svgEl.querySelectorAll('.region-path');
    const clonePaths = clone.querySelectorAll('.region-path');
    livePaths.forEach((lp, i) => {
      const fill = window.getComputedStyle(lp).fill;
      clonePaths[i].setAttribute('fill', fill);
      clonePaths[i].removeAttribute('style');
    });
    // Also bake country borders
    const liveBorders = svgEl.querySelectorAll('.country-border');
    const cloneBorders = clone.querySelectorAll('.country-border');
    liveBorders.forEach((lb, i) => {
      const cs = window.getComputedStyle(lb);
      cloneBorders[i].setAttribute('fill', 'none');
      cloneBorders[i].setAttribute('stroke', cs.stroke);
      cloneBorders[i].setAttribute('stroke-width', cs.strokeWidth);
    });
    // Bake the rail lines (stroke comes from CSS, which won't survive serialization)
    const liveRails = svgEl.querySelectorAll('.rail-line');
    const cloneRails = clone.querySelectorAll('.rail-line');
    liveRails.forEach((lr, i) => {
      const cs = window.getComputedStyle(lr);
      cloneRails[i].setAttribute('fill', 'none');
      cloneRails[i].setAttribute('stroke', cs.stroke);
      cloneRails[i].setAttribute('stroke-width', cs.strokeWidth);
      cloneRails[i].setAttribute('stroke-linecap', 'round');
      cloneRails[i].setAttribute('stroke-linejoin', 'round');
    });
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = svgEl.clientWidth * 2;
      canvas.height = svgEl.clientHeight * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      
      // Add title and score
      ctx.fillStyle = '#222';
      ctx.font = 'bold 36px Inter, sans-serif';
      ctx.fillText(`China Level ${calcScore()}`, 20, 45);
      
      if (authorName) {
        ctx.font = '700 22px Inter, sans-serif';
        ctx.fillStyle = '#333';
        ctx.fillText(authorName, 22, 74);
      }
      
      // Add legend at its current screen position
      const legendEl = document.getElementById('legend');
      const legendRect = legendEl.getBoundingClientRect();
      const mapRect = svgEl.getBoundingClientRect();
      const legendX = legendRect.left - mapRect.left;
      const legendTopY = legendRect.top - mapRect.top;

      const levels = [
        { label: 'Lived there', level: 5 },
        { label: 'Stayed there', level: 4 },
        { label: 'Visited there', level: 3 },
        { label: 'Alighted there', level: 2 },
        { label: 'Passed there', level: 1 },
        { label: 'Never been there', level: 0 },
      ];
      
      // Legend background (extra row for the train-lines entry)
      const legendH = 158 + 26;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(legendX, legendTopY, 200, legendH);
      ctx.strokeStyle = '#ccc';
      ctx.strokeRect(legendX, legendTopY, 200, legendH);
      
      levels.forEach((l, i) => {
        const y = legendTopY + 10 + i * 24 + 8;
        ctx.fillStyle = COLORS[l.level];
        ctx.fillRect(legendX + 8, y - 8, 20, 14);
        ctx.strokeStyle = '#999';
        ctx.strokeRect(legendX + 8, y - 8, 20, 14);
        ctx.fillStyle = '#333';
        ctx.font = '500 12px Inter, sans-serif';
        ctx.fillText(l.label, legendX + 36, y + 2);
        ctx.fillStyle = '#888';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`Level: ${l.level}`, legendX + 146, y + 2);
      });

      // Train-lines legend row: a thin dark line + label
      {
        const y = legendTopY + 10 + levels.length * 24 + 8 + 4;
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--rail').trim() || '#1a1a2e';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(legendX + 8, y - 1);
        ctx.lineTo(legendX + 28, y - 1);
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.font = '500 12px Inter, sans-serif';
        ctx.fillText('Main train lines', legendX + 36, y + 2);
      }
      
      // Draw annotations (captions + arrows)
      try {
        const wrapEl = document.getElementById('mapWrapper');
        const annLayer = document.getElementById('annotationsLayer');
        if (annLayer && wrapEl) {
          // Annotations are stored as % of the UNSCALED mapWrapper. On-screen they
          // follow the d3 zoom transform applied to the map. The canvas matches the
          // SVG (same size as mapWrapper) and the SVG export already includes the
          // d3 transform on its inner <g>, so we need to apply that same transform
          // to annotation coordinates here.
          const wRect = wrapEl.getBoundingClientRect();
          const t = (window.AnnotationsAPI && window.AnnotationsAPI.getTransform)
            ? window.AnnotationsAPI.getTransform()
            : { k: 1, x: 0, y: 0 };
          const xPct = (px) => t.x + (px / 100) * wRect.width * t.k;
          const yPct = (py) => t.y + (py / 100) * wRect.height * t.k;
          // Sizes (caption box, font sizes) are NOT scaled with map zoom on screen,
          // so they shouldn't scale here either - keep using unscaled wrapper size.
          const wPctSize = (pw) => (pw / 100) * wRect.width;
          const hPctSize = (ph) => (ph / 100) * wRect.height;

          const annotations = (window.AnnotationsAPI && window.AnnotationsAPI.getAll) ? window.AnnotationsAPI.getAll() : [];
          annotations.forEach(ann => {
            if (ann.type === 'c') {
              // Caption: position follows the map transform, but the box itself stays unscaled
              const cx = xPct(ann.x);
              const cy = yPct(ann.y);
              const cw = wPctSize(ann.w);
              const ch = hPctSize(ann.h);
              ctx.save();
              ctx.translate(cx + cw / 2, cy + ch / 2);
              ctx.rotate((ann.r || 0) * Math.PI / 180);
              // Background pill
              ctx.fillStyle = 'rgba(255,255,255,0.95)';
              ctx.strokeStyle = '#888';
              ctx.lineWidth = 1;
              const radius = 4;
              const rx = -cw / 2, ry = -ch / 2;
              ctx.beginPath();
              ctx.moveTo(rx + radius, ry);
              ctx.lineTo(rx + cw - radius, ry);
              ctx.quadraticCurveTo(rx + cw, ry, rx + cw, ry + radius);
              ctx.lineTo(rx + cw, ry + ch - radius);
              ctx.quadraticCurveTo(rx + cw, ry + ch, rx + cw - radius, ry + ch);
              ctx.lineTo(rx + radius, ry + ch);
              ctx.quadraticCurveTo(rx, ry + ch, rx, ry + ch - radius);
              ctx.lineTo(rx, ry + radius);
              ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              // Text
              ctx.fillStyle = '#222';
              ctx.font = `500 ${ann.fs || 14}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(ann.t || '', 0, 0);
              ctx.restore();
            } else if (ann.type === 'a') {
              // Arrow - mirrors the on-screen rendering: curved quadratic Bezier shaft
              // with a V-shape arrowhead, NOT a straight line + filled triangle.
              const x1 = xPct(ann.x1), y1 = yPct(ann.y1);
              const x2 = xPct(ann.x2), y2 = yPct(ann.y2);
              const color = '#' + (ann.c || '2d2d2d');
              ctx.save();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2.4;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';

              // Curve geometry (must match positionArrow in annotations.js)
              const dx = x2 - x1, dy = y2 - y1;
              const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              const pxn = -dy / len, pyn = dx / len; // perpendicular unit vector
              const bow = Math.min(len * 0.12, 18);
              const cxp = (x1 + x2) / 2 + pxn * bow;
              const cyp = (y1 + y2) / 2 + pyn * bow;

              // Curved shaft
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.quadraticCurveTo(cxp, cyp, x2, y2);
              ctx.stroke();

              // V-shape arrowhead, angled along the curve's incoming tangent
              const tdx = x2 - cxp, tdy = y2 - cyp;
              const tlen = Math.max(1, Math.sqrt(tdx * tdx + tdy * tdy));
              const tux = tdx / tlen, tuy = tdy / tlen;
              const headSize = Math.min(12, Math.max(8, len * 0.18));
              const spread = 0.55;
              const cos = Math.cos(spread), sin = Math.sin(spread);
              const b1x = -tux * cos - -tuy * sin;
              const b1y = -tuy * cos + -tux * sin;
              const b2x = -tux * cos + -tuy * sin;
              const b2y = -tuy * cos - -tux * sin;
              const hx1 = x2 + b1x * headSize, hy1 = y2 + b1y * headSize;
              const hx2 = x2 + b2x * headSize, hy2 = y2 + b2y * headSize;
              ctx.beginPath();
              ctx.moveTo(hx1, hy1);
              ctx.lineTo(x2, y2);
              ctx.lineTo(hx2, hy2);
              ctx.stroke();

              ctx.restore();
            }
          });
        }
      } catch (e) {
        console.warn('Annotation export failed:', e);
      }

      canvas.toBlob(function(blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chinaex-level-${calcScore()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
      
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // ── Toast notifications ───────────────────────────────────
  // Top-right toast that fades in, holds, then fades out automatically.
  function showToast(message, type, durationMs) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'warn');
    t.textContent = message;
    container.appendChild(t);
    // Trigger transition on next frame
    requestAnimationFrame(() => t.classList.add('show'));
    const hold = durationMs || 4500;
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, hold);
  }

  // ── URL length monitoring ─────────────────────────────────
  // Hash-based URLs technically support tens of thousands of characters in modern
  // browsers, but most sharing surfaces (messaging apps, X/Twitter, email previews)
  // start truncating around 2,000-2,500 chars. We warn the user before that.
  const URL_WARN_THRESHOLD = 1800;   // approaching the practical sharing limit
  const URL_ERROR_THRESHOLD = 2500;  // very likely to be truncated by share targets
  let lastWarnState = 'ok'; // 'ok' | 'warn' | 'error' - prevents repeated identical toasts

  function checkUrlLengthAndWarn() {
    const len = window.location.href.length;
    let state = 'ok';
    if (len >= URL_ERROR_THRESHOLD) state = 'error';
    else if (len >= URL_WARN_THRESHOLD) state = 'warn';

    // Always nag in error territory; only fire warn once when crossing into it.
    if (state === 'error') {
      showToast(
        'Too many annotations to share via URL. The link is now ' + len + ' characters long and will likely be cut off by messaging apps and email previews.',
        'error',
        6000
      );
    } else if (state === 'warn' && lastWarnState === 'ok') {
      showToast(
        'Heads up: your shareable URL is getting long. A few more arrows or captions and it may be truncated by some apps when shared.',
        'warn',
        5000
      );
    }
    lastWarnState = state;
  }

  // ── Utility ───────────────────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  window.toggleAbout = function() {
    document.getElementById('aboutModal').classList.toggle('show');
  };

  // ── Initialize ────────────────────────────────────────────
  function init() {
    // Hook annotation changes to URL update
    window.onAnnotationsChange = encodeHash;
    buildLookup();
    decodeHash();
    updateScore();
    initMap();
    setupEvents();
    // If the page was loaded with an already-long URL, warn the user right away
    setTimeout(checkUrlLengthAndWarn, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
