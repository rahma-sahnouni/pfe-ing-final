// routes/testRH.routes.js
const express = require("express");
const router  = express.Router();

const c              = require("../controllers/testRh.controller");
const submissionCtrl = require("../controllers/testSubmission.controller");
const { authenticate, authorize } = require("../middlewares/auth.middleware");

// ── Debug (supprime après confirmation) ──────────────────────
console.log('[testRH.routes] submitRhAnswers  =', typeof submissionCtrl.submitRhAnswers);
console.log('[testRH.routes] completeTest sub =', typeof submissionCtrl.completeTest);
console.log('[testRH.routes] completeTest rh  =', typeof c.completeTest);

const submitRhHandler     = submissionCtrl.submitRhAnswers;
const completeTestHandler = submissionCtrl.completeTest || c.completeTest;

if (typeof submitRhHandler     !== 'function') throw new Error('[testRH.routes] submitRhAnswers not exported from testSubmission.controller');
if (typeof completeTestHandler !== 'function') throw new Error('[testRH.routes] completeTest not found in any controller');

/* ── Built-in model definitions (public) ──────────────────── */
router.get("/builtin-models", c.getBuiltinModels);

/* ── Candidate submit — param = TestRh._id ────────────────── */
router.post("/:rhTestId/submit", authenticate, authorize("candidate"), submitRhHandler);

/* ── Complete test — RH agent ─────────────────────────────── */
router.post("/:jobId/complete",  authenticate, authorize("rh"),        completeTestHandler);

/* ── Job Test CRUD ────────────────────────────────────────── */
router.get   ("/:jobId", authenticate, authorize("rh", "admin", "technical evaluator"), c.getTestByJob);
router.post  ("/:jobId", authenticate, authorize("rh", "admin"), c.createTest);
router.patch ("/:jobId", authenticate, authorize("rh", "admin"), c.updateTest);
router.delete("/:jobId", authenticate, authorize("rh", "admin"), c.deleteTest);

/* ── Themes ───────────────────────────────────────────────── */
router.post  ("/:jobId/themes",          authenticate, authorize("rh", "admin"), c.addTheme);
router.delete("/:jobId/themes/:themeId", authenticate, authorize("rh", "admin"), c.deleteTheme);

/* ── Models ───────────────────────────────────────────────── */
router.post  ("/:jobId/themes/:themeId/models",          authenticate, authorize("rh", "admin"), c.addModel);
router.patch ("/:jobId/themes/:themeId/models/:modelId", authenticate, authorize("rh", "admin"), c.updateModel);
router.delete("/:jobId/themes/:themeId/models/:modelId", authenticate, authorize("rh", "admin"), c.deleteModel);

/* ── Questions ────────────────────────────────────────────── */
router.post  ("/:jobId/themes/:themeId/models/:modelId/questions",             authenticate, authorize("rh", "admin"), c.addQuestion);
router.patch ("/:jobId/themes/:themeId/models/:modelId/questions/:questionId", authenticate, authorize("rh", "admin"), c.updateQuestion);
router.delete("/:jobId/themes/:themeId/models/:modelId/questions/:questionId", authenticate, authorize("rh", "admin"), c.deleteQuestion);

module.exports = router;