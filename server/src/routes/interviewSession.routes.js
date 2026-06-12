// routes/interviewSession.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/interviewSession.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

router.use(authenticate);

// ── Config ────────────────────────────────────────────────────────────────────
router.get('/config/:jobId',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.getInterviewConfig);

router.post('/config/:jobId',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.saveInterviewConfig);
router.delete('/config/:jobId',   authorize('rh', 'technical evaluator', 'admin')
, ctrl.deleteStageConfig);
// ── Auto-assign ───────────────────────────────────────────────────────────────
router.post('/auto-assign/:jobId',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.autoAssignSlots);

// ── Admin (BEFORE /:id to avoid route conflicts) ──────────────────────────────
router.get('/admin/candidate-report',
  authorize('admin'),
  ctrl.getCandidateReport);

router.post('/admin/final-decision',
  authorize('admin'),
  ctrl.adminFinalDecision);

// ── Session list / single ─────────────────────────────────────────────────────
router.get('/',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.getSessions);

router.get('/:id',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.getSession);



// ── Per-candidate operations ──────────────────────────────────────────────────
router.patch('/:id/candidate/:candidateId/start',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.startCandidateSession);

router.patch('/:id/candidate/:candidateId/complete',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.completeCandidateSession);

router.patch('/:id/candidate/:candidateId/schedule',
  authorize('rh', 'technical evaluator', 'admin'),
  ctrl.scheduleCandidateSession);

module.exports = router;