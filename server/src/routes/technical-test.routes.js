// routes/technical-test.routes.js
const router         = require('express').Router();
const ctrl           = require('../controllers/technical-test.controller');
const submissionCtrl = require('../controllers/testSubmission.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

const techGuard  = [authenticate, authorize('technical evaluator', 'admin')];
const adminGuard = [authenticate, authorize('admin')];

// ── Job sub-routes (before /:id to avoid conflicts) ──────────
router.post  ('/jobs/:jobId/assign',          ...techGuard, ctrl.assignTestToJob);
router.delete('/jobs/:jobId/tests/:testId',   ...techGuard, ctrl.removeTestFromJob);

// Overview accessible aussi par rh et admin
router.get('/job/:jobId',
  authenticate,
  authorize('technical evaluator', 'rh', 'admin'),
  ctrl.getTestsByJob
);

// ── Create + assign in one request ───────────────────────────
router.post('/create-and-assign', ...techGuard, ctrl.createAndAssign);

// ── Candidate submit ─────────────────────────────────────────
router.post('/:testId/submit',
  authenticate,
  authorize('candidate'),
  submissionCtrl.submitTechnicalAnswers
);

// ── CRUD ─────────────────────────────────────────────────────
router.post  ('/',    ...techGuard, ctrl.createTest);
router.get   ('/',    ...techGuard, ctrl.getMyTests);
router.get   ('/:id', ...techGuard, ctrl.getTestById);
router.put   ('/:id', ...techGuard, ctrl.updateTest);
router.delete('/:id', ...techGuard, ctrl.deleteTest);

module.exports = router;