/**
 * sales-training.js — public API shim (window.SalesTraining)
 *
 * Step 4f (2026-05-17): the 2382-line monolith got split into:
 *   - sales-training-engine.js  — SCENARIOS + OBJECTIONS + session logic
 *   - sales-training-ui.js      — render() funcs + per-mode markup
 *   - sales-training.js         — this file: aggregates window.SalesTraining
 *
 * Load order (script-loader.js training bundle): engine → ui → shim.
 * Each sibling publishes helpers onto window._SalesTrainingState so this
 * shim can compose the public surface from both halves. Behavior is
 * byte-for-byte identical to the pre-split file from a caller's
 * perspective.
 */
(function() {
  'use strict';

  const state = window._SalesTrainingState || (window._SalesTrainingState = {});

  if (typeof state.init !== 'function' || typeof state.render !== 'function') {
    console.error('[sales-training] engine/ui modules missing — load order should be engine → ui → shim');
    return;
  }

  window.SalesTraining = {
    init: state.init,
    render: state.render,
    startScenario: state.startScenario,
    chooseOption: state.chooseOption,
    advance: state.advanceAfterFeedback,
    startRapidFire: state.startRapidFire,
    rapidAnswer: state.rapidAnswer,
    rapidNext: state.rapidNext,
    backToMenu: state.backToMenu,
    showProfile: state.showProfile,
    getScenarios: () => state.SCENARIOS,
    getObjections: () => state.OBJECTIONS,
    getHistory: () => state.trainingHistory,
    getSkillProfile: () => state.skillProfile
  };

})();
