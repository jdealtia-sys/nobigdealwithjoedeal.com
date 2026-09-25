// tests/e2e/fixtures/draw-legacy-autosave.js — a real Drawing Tool autosave
// captured BEFORE the draw lane L2 fixes, for the restore-path tests (the node
// suite tests/draw-geom.test.js and tests/e2e/phone-draw-money.spec.js).
//
// Captured from the rig on 2026-09-25 (maps-routing.js autoSaveDrawing,
// origin/main f7408d71): a 40x30 ft facet closed, one tap to start facet 2
// (duplicating facet 1, audit B4), a Valley, a Ridge Vent and a Ridge line,
// and a 2-segment gutter run. Line ids are Date.now()+Math.random() decimals
// (audit B3). Facets carry no name/color keys (JSON.stringify dropped their
// undefined values, code-map #4/#5); gutterPoints misses the run's last point
// (the autosave ran before the push). Re-anchored off the demo address the
// same way WING is (only latitude changes a length or an area).
//
// Moved here from tests/draw-geom.test.js (draw lane L1) so the E2E restore
// test and the node suite read ONE copy. No @playwright/test import: the node
// suite requires it.
'use strict';

function legacyAutosave() {
  return JSON.parse(JSON.stringify({
    address: '',
    lines: [
      { id: 1790347279719.1355, type: 5, name: 'Eave', color: '#BE185D', dist: 40.08931340324379, p1: { lat: 39.167670860328165, lng: -84.17000010609627 }, p2: { lat: 39.167670860328165, lng: -84.16985836745332 }, subtype: 'eave' },
      { id: 1790347279720.51, type: 4, name: 'Rake', color: '#EC4899', dist: 30.0669850524477, p1: { lat: 39.167670860328165, lng: -84.16985836745332 }, p2: { lat: 39.167753277910585, lng: -84.16985836745332 }, subtype: 'rake' },
      { id: 1790347279721.5767, type: 5, name: 'Eave', color: '#BE185D', dist: 40.08926642546462, p1: { lat: 39.167753277910585, lng: -84.16985836745332 }, p2: { lat: 39.167753277910585, lng: -84.17000010609627 }, subtype: 'eave' },
      { id: 1790347279722.097, type: 4, name: 'Rake', color: '#EC4899', dist: 30.0669850524477, p1: { lat: 39.167753277910585, lng: -84.17000010609627 }, p2: { lat: 39.167670860328165, lng: -84.17000010609627 }, subtype: 'rake' },
      { id: 1790347279725.4807, type: 3, name: 'Valley', color: '#3B82F6', dist: 25.055820876175698, p1: { lat: 39.167670860328165, lng: -84.1702127140607 }, p2: { lat: 39.167739541646846, lng: -84.1702127140607 }, subtype: 'line' },
      { id: 1790347279726.565, type: 1, name: 'Ridge Vent', color: '#86EFAC', dist: 10.022328349951849, p1: { lat: 39.167670860328165, lng: -84.17028358338217 }, p2: { lat: 39.167698332855636, lng: -84.17028358338217 }, subtype: 'line' },
      { id: 1790347279727.9907, type: 0, name: 'Ridge', color: '#22C55E', dist: 17.03795819621422, p1: { lat: 39.167670860328165, lng: -84.17035445270365 }, p2: { lat: 39.16771756362487, lng: -84.17035445270365 }, subtype: 'line' },
      { id: 1790347279728.621, type: 10, name: 'Gutters', color: '#06B6D4', dist: 33.073735231319105, p1: { lat: 39.167560970218275, lng: -84.17000010609627 }, p2: { lat: 39.167560970218275, lng: -84.16988317171584 }, subtype: 'gutter' },
      { id: 1790347279729.2104, type: 10, name: 'Gutters', color: '#06B6D4', dist: 20.044656702495846, p1: { lat: 39.167560970218275, lng: -84.16988317171584 }, p2: { lat: 39.16750602516333, lng: -84.16988317171584 }, subtype: 'gutter' },
    ],
    facets: [
      { pitch: 1.202, closed: true, baseArea: 1205.3647868582223, points: [{ lat: 39.167670860328165, lng: -84.17000010609627 }, { lat: 39.167670860328165, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.17000010609627 }] },
      { pitch: 1.202, closed: true, baseArea: 1205.3647868582223, points: [{ lat: 39.167670860328165, lng: -84.17000010609627 }, { lat: 39.167670860328165, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.17000010609627 }] },
    ],
    perimPoints: [{ lat: 39.167890640547945, lng: -84.16971662881036 }],
    perimClosed: false,
    gutterPoints: [{ lat: 39.167560970218275, lng: -84.17000010609627 }, { lat: 39.167560970218275, lng: -84.16988317171584 }],
    pitch: '1.202', waste: '1.17', ts: 1790347279730,
  }));
}

module.exports = { legacyAutosave };
