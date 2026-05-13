/**
 * photo-smart-ingest.js — Phase 2 of the photo system rebuild.
 *
 * Extracts rich metadata from a photo file BEFORE it leaves the rep's
 * device, so by the time the photo is uploaded we already know:
 *
 *   - When + where it was taken      (EXIF lat/lng/heading/timestamp)
 *   - Which camera produced it       (EXIF Model)
 *   - The pixel dimensions           (EXIF / ImageWidth)
 *   - Which roof slope it shows      (heading vs property footprint)
 *
 * Why client-side: the 5-min sort-100-photos target rules out a per-photo
 * server round-trip. We pre-compute everything in the browser so the
 * Review UI (Phase 4) can show location chips the instant uploads land.
 *
 * Exposes window.PhotoSmartIngest with:
 *   .extractExif(file)                       → Promise<exif|null>
 *   .getPropertyPolygon(lead)                → polygon|null  (sync, cached)
 *   .inferSlopeFromHeading(heading, polygon) → { label, confidence }|null
 *   .analyze(file, lead)                     → Promise<{exif, inferredLocation}|null>
 *
 * No external deps. Hand-rolled JPEG EXIF parser handles iPhone Camera
 * roll output (HEIC photos taken on iPhone are auto-converted to JPEG
 * when uploaded via <input type=file>, so we don't need a HEIC parser).
 */
(function () {
  'use strict';

  if (window.PhotoSmartIngest
      && window.PhotoSmartIngest.__sentinel === 'nbd-photo-smart-ingest-v1') return;

  // ─── EXIF tag constants (only what we actually read) ──────────────
  const TAG = {
    MODEL:                0x0110, // string — "iPhone 14 Pro" etc.
    DATE_TIME_ORIGINAL:   0x9003, // string — "YYYY:MM:DD HH:MM:SS"
    EXIF_SUB_IFD:         0x8769, // pointer to EXIF sub-IFD
    GPS_INFO:             0x8825, // pointer to GPS sub-IFD
    PIXEL_X_DIM:          0xA002, // long — width
    PIXEL_Y_DIM:          0xA003, // long — height
    // GPS sub-IFD
    GPS_LAT_REF:          0x0001, // 'N'/'S'
    GPS_LAT:              0x0002, // RATIONAL[3] — deg, min, sec
    GPS_LNG_REF:          0x0003, // 'E'/'W'
    GPS_LNG:              0x0004, // RATIONAL[3]
    GPS_IMG_DIRECTION_REF:0x0010, // 'T' (true north) or 'M' (magnetic)
    GPS_IMG_DIRECTION:    0x0011, // RATIONAL — compass heading 0-360
  };

  // TIFF type sizes in bytes.
  const TYPE_SIZE = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8 };

  // ──────────────────────────────────────────────────────────────────
  // JPEG EXIF parser. Reads only the markers we need; bails fast on
  // malformed input. Returns null for non-JPEG files (drone DNG, etc.)
  // — Phase 3 AI classifier still works on those, just without EXIF.
  // ──────────────────────────────────────────────────────────────────
  async function extractExif(file) {
    if (!file || typeof file.arrayBuffer !== 'function') return null;
    // 256KB is plenty — EXIF lives at the head of the file. Reading
    // the whole file (often 5-12MB on iPhone) would waste memory.
    const HEAD_BYTES = 256 * 1024;
    let buf;
    try {
      const slice = file.slice ? file.slice(0, HEAD_BYTES) : file;
      buf = await slice.arrayBuffer();
    } catch (e) {
      console.warn('[smart-ingest] file.arrayBuffer failed:', e.message);
      return null;
    }
    const view = new DataView(buf);

    // JPEG SOI marker
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

    // Walk segments to find APP1 with "Exif\0\0"
    let pos = 2;
    let app1Start = -1;
    let app1End = -1;
    while (pos < view.byteLength - 4) {
      if (view.getUint8(pos) !== 0xFF) return null;
      const marker = view.getUint16(pos);
      const size = view.getUint16(pos + 2);
      if (marker === 0xFFE1 && pos + 4 + 6 < view.byteLength) {
        // Check "Exif\0\0"
        if (view.getUint32(pos + 4) === 0x45786966
            && view.getUint16(pos + 8) === 0x0000) {
          app1Start = pos + 10; // skip 6-byte "Exif\0\0" header
          app1End = pos + 2 + size;
          break;
        }
      }
      if (marker === 0xFFDA) return null; // SOS — image data starts, no more meta
      pos += 2 + size;
    }
    if (app1Start < 0) return null;

    // TIFF header
    const tiffStart = app1Start;
    const byteOrder = view.getUint16(tiffStart);
    let little;
    if (byteOrder === 0x4949) little = true;       // 'II'
    else if (byteOrder === 0x4D4D) little = false; // 'MM'
    else return null;

    const u16 = (off) => view.getUint16(off, little);
    const u32 = (off) => view.getUint32(off, little);

    if (u16(tiffStart + 2) !== 0x002A) return null; // TIFF magic

    const ifd0Offset = u32(tiffStart + 4);
    const ifd0 = tiffStart + ifd0Offset;
    if (ifd0 >= view.byteLength) return null;

    // Walk an IFD into a tag→entry map. Each entry is {type, count, valOffset}.
    function walkIFD(start) {
      const entries = new Map();
      if (start + 2 >= view.byteLength) return entries;
      const count = u16(start);
      for (let i = 0; i < count; i++) {
        const e = start + 2 + i * 12;
        if (e + 12 > view.byteLength) break;
        const tag    = u16(e);
        const type   = u16(e + 2);
        const cnt    = u32(e + 4);
        const valOff = e + 8; // value-or-offset field (4 bytes)
        entries.set(tag, { tag, type, count: cnt, valOff });
      }
      return entries;
    }

    // Read the actual value of an entry, dereferencing the offset
    // pointer when the data doesn't fit in 4 bytes.
    function readValue(entry) {
      if (!entry) return null;
      const { type, count, valOff } = entry;
      const size = TYPE_SIZE[type] || 1;
      const total = size * count;
      const dataStart = total > 4 ? tiffStart + u32(valOff) : valOff;
      if (dataStart + total > view.byteLength) return null;

      if (type === 2) {
        // ASCII — null-terminated
        let s = '';
        for (let i = 0; i < count - 1; i++) {
          const c = view.getUint8(dataStart + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s;
      }
      if (type === 3) { // SHORT
        if (count === 1) return u16(dataStart);
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(u16(dataStart + i * 2));
        return arr;
      }
      if (type === 4) { // LONG
        if (count === 1) return u32(dataStart);
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(u32(dataStart + i * 4));
        return arr;
      }
      if (type === 5) { // RATIONAL — numerator/denominator pair
        const rationals = [];
        for (let i = 0; i < count; i++) {
          const num = u32(dataStart + i * 8);
          const den = u32(dataStart + i * 8 + 4);
          rationals.push(den === 0 ? 0 : num / den);
        }
        return count === 1 ? rationals[0] : rationals;
      }
      return null;
    }

    const ifd0Map = walkIFD(ifd0);
    const out = {};

    const modelEntry = ifd0Map.get(TAG.MODEL);
    if (modelEntry) out.cameraModel = readValue(modelEntry);

    // EXIF sub-IFD — has DateTimeOriginal + pixel dims
    const exifSubPtr = ifd0Map.get(TAG.EXIF_SUB_IFD);
    if (exifSubPtr) {
      const subIfd = tiffStart + readValue(exifSubPtr);
      if (subIfd < view.byteLength) {
        const subMap = walkIFD(subIfd);
        const dt = subMap.get(TAG.DATE_TIME_ORIGINAL);
        if (dt) {
          const s = readValue(dt);
          if (typeof s === 'string') {
            // "2026:05:13 09:24:30" → ISO
            const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
            if (m) out.takenAt = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
          }
        }
        const w = subMap.get(TAG.PIXEL_X_DIM);
        const h = subMap.get(TAG.PIXEL_Y_DIM);
        if (w) out.width  = readValue(w);
        if (h) out.height = readValue(h);
      }
    }

    // GPS sub-IFD
    const gpsPtr = ifd0Map.get(TAG.GPS_INFO);
    if (gpsPtr) {
      const gpsIfd = tiffStart + readValue(gpsPtr);
      if (gpsIfd < view.byteLength) {
        const gpsMap = walkIFD(gpsIfd);
        const latRef = gpsMap.get(TAG.GPS_LAT_REF);
        const lat    = gpsMap.get(TAG.GPS_LAT);
        const lngRef = gpsMap.get(TAG.GPS_LNG_REF);
        const lng    = gpsMap.get(TAG.GPS_LNG);
        const dirRef = gpsMap.get(TAG.GPS_IMG_DIRECTION_REF);
        const dir    = gpsMap.get(TAG.GPS_IMG_DIRECTION);

        if (lat && lng) {
          const lDeg = readValue(lat);
          const gDeg = readValue(lng);
          if (Array.isArray(lDeg) && lDeg.length === 3
              && Array.isArray(gDeg) && gDeg.length === 3) {
            let latVal = lDeg[0] + lDeg[1] / 60 + lDeg[2] / 3600;
            let lngVal = gDeg[0] + gDeg[1] / 60 + gDeg[2] / 3600;
            if (readValue(latRef) === 'S') latVal = -latVal;
            if (readValue(lngRef) === 'W') lngVal = -lngVal;
            out.lat = latVal;
            out.lng = lngVal;
          }
        }
        if (dir) {
          const h = readValue(dir);
          if (typeof h === 'number' && !isNaN(h)) {
            out.heading = h;
            out.headingRef = readValue(dirRef) || 'T';
          }
        }
      }
    }

    return Object.keys(out).length ? out : null;
  }

  // ──────────────────────────────────────────────────────────────────
  // Property polygon lookup. Reads from the lead doc's existing
  // property-intel fields (already populated by maps.js / property-intel.js
  // when the rep pulls a parcel). Returns null when no footprint exists
  // yet — heading falls back to pure cardinal-direction labelling.
  //
  // Cached by leadId so a 100-photo upload only touches the lead once.
  // ──────────────────────────────────────────────────────────────────
  const _polygonCache = new Map();

  function getPropertyPolygon(lead) {
    if (!lead || !lead.id) return null;
    if (_polygonCache.has(lead.id)) return _polygonCache.get(lead.id);

    // Three possible shapes the lead may carry:
    //   1. lead.propertyFootprint = [{lat, lng}, ...]   (preferred)
    //   2. lead.parcel.geometry.coordinates              (GeoJSON style)
    //   3. lead.parcelBounds = { lat, lng, ... }         (legacy)
    let points = null;
    if (Array.isArray(lead.propertyFootprint) && lead.propertyFootprint.length >= 3) {
      points = lead.propertyFootprint
        .filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number');
    } else if (lead.parcel && lead.parcel.geometry
               && Array.isArray(lead.parcel.geometry.coordinates)) {
      // GeoJSON Polygon: coords[0] is the outer ring of [lng, lat] pairs
      const ring = lead.parcel.geometry.coordinates[0];
      if (Array.isArray(ring) && ring.length >= 3) {
        points = ring.map(p => ({ lat: p[1], lng: p[0] }));
      }
    }
    if (!points || points.length < 3) {
      _polygonCache.set(lead.id, null);
      return null;
    }

    // Centroid (simple average — good enough for cardinal labelling)
    let cLat = 0, cLng = 0;
    for (const p of points) { cLat += p.lat; cLng += p.lng; }
    cLat /= points.length;
    cLng /= points.length;

    const polygon = { points, center: { lat: cLat, lng: cLng } };
    _polygonCache.set(lead.id, polygon);
    return polygon;
  }

  // ──────────────────────────────────────────────────────────────────
  // Heading → roof-slope / cardinal facade label.
  //
  // Logic:
  //   1. Photographer faces direction `heading` (0=N, 90=E, 180=S, 270=W)
  //   2. The slope they see is the slope facing back toward them — i.e.
  //      the slope with an OUTWARD normal closest to (heading + 180) mod 360
  //   3. Without a polygon, fall back to plain cardinal label of heading
  //      (rough but still useful — "looking north" → "north facade").
  //
  // Returns { label, confidence, cardinal } or null when heading is
  // missing.
  // ──────────────────────────────────────────────────────────────────
  function inferSlopeFromHeading(heading, polygon) {
    if (typeof heading !== 'number' || isNaN(heading)) return null;
    const facingHeading = ((heading % 360) + 360) % 360;

    // 8-point cardinal label of the photographer's facing direction
    const cardinals = [
      ['N',  'North'],  ['NE', 'Northeast'], ['E',  'East'],  ['SE', 'Southeast'],
      ['S',  'South'],  ['SW', 'Southwest'], ['W',  'West'],  ['NW', 'Northwest'],
    ];
    const idx = Math.round(facingHeading / 45) % 8;
    const [shortDir, longDir] = cardinals[idx];

    // Without a polygon, just label by direction.
    if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) {
      return {
        label: longDir + ' facade',
        cardinal: shortDir,
        confidence: 0.55,
        source: 'heading-only'
      };
    }

    // With a polygon: project the back-facing direction onto each edge's
    // outward normal, pick the edge whose normal is closest.
    // For roof slopes the convention is "<cardinal> slope" → "South slope"
    // means the slope whose outward normal points south.
    const backHeading = (facingHeading + 180) % 360;
    const slopeShort = cardinals[Math.round(backHeading / 45) % 8][0];
    const slopeLong  = cardinals[Math.round(backHeading / 45) % 8][1];

    // Confidence: higher when heading is close to a cardinal axis,
    // lower in the corner cases where it could go either way.
    const nearest45 = Math.abs(facingHeading - (Math.round(facingHeading / 45) * 45));
    const offset = Math.min(nearest45, 45 - nearest45); // 0-22.5
    const confidence = 0.75 + (1 - offset / 22.5) * 0.20; // 0.75-0.95

    return {
      label: slopeLong + ' slope',
      cardinal: slopeShort,
      confidence: Math.round(confidence * 100) / 100,
      source: 'heading+polygon'
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // analyze(file, lead) — the one call upload code makes.
  // Combines EXIF + polygon + slope inference into a single object
  // ready to merge into the photo doc.
  // ──────────────────────────────────────────────────────────────────
  async function analyze(file, lead) {
    let exif = null;
    try { exif = await extractExif(file); }
    catch (e) { console.warn('[smart-ingest] extractExif threw:', e.message); }

    if (!exif) return { exif: null, inferredLocation: null };

    const polygon = getPropertyPolygon(lead);
    const inferredLocation = inferSlopeFromHeading(exif.heading, polygon);

    return { exif, inferredLocation };
  }

  window.PhotoSmartIngest = {
    __sentinel: 'nbd-photo-smart-ingest-v1',
    extractExif,
    getPropertyPolygon,
    inferSlopeFromHeading,
    analyze,
  };
})();
