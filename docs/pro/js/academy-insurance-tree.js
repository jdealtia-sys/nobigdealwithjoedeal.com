// Engine shim for the insurance branch of the Real Deal Academy.
// The decision-tree DATA lives in academy-insurance-tree-data.js, which
// must load BEFORE this file (see script-loader.js).
//
// Tree traversal/render logic lives in real-deal-academy.js, which reads
// window._academyInsuranceTree. We keep that global stable for back-compat.
(function() {
  window._academyInsuranceTree = window.NBD_INSURANCE_TREE || [];
})();
