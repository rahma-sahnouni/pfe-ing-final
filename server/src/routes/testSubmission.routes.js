// routes/testSubmission.routes.js
const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/testSubmission.controller');

// ── Candidate ─────────────────────────────────────────────────
router.get('/my',
  authenticate,
  authorize('candidate'),
  ctrl.getMySubmissions
);

// ── RH / Tech Evaluator / Admin — all submissions ─────────────
router.get('/rh',
  authenticate,
  authorize('rh', 'admin', 'technical evaluator'),
  ctrl.getRhSubmissions
);

router.get('/technical',
  authenticate,
  authorize('technical evaluator', 'rh', 'admin'),
  ctrl.getTechnicalSubmissions
);

// ── Per candidate per job ─────────────────────────────────────
router.get('/job/:jobId/candidate/:candidateId',
  authenticate,
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.getCandidateSubmissions
);



router.patch('/:id/evaluate',
  authenticate,
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.evaluateSubmission
);
router.get('/job/:jobId/all', authenticate, ctrl.getAllSubmissionsForJob);

module.exports = router;