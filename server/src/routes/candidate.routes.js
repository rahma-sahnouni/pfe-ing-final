// routes/candidate.routes.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { authenticate, authorize } = require('../middlewares/auth.middleware');
const candidateCtrl = require('../controllers/candidate.controller');

// ── Multer config ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/cvs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cv_${req.user._id}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits:     { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted.'));
  },
});

// ── Candidate (self) ──────────────────────────────────────────────────────────
router.get('/profile',              authenticate, candidateCtrl.getCandidateProfile);
router.post('/cv',                  authenticate, upload.single('cv'), candidateCtrl.uploadAndExtractCV);
router.get('/recommended-jobs',     authenticate, candidateCtrl.getRecommendedJobs);
router.get('/my-tests',             authenticate, candidateCtrl.getMyTests);
router.get('/journey',              authenticate, candidateCtrl.getJourney);

// ── By job (RH / admin) ───────────────────────────────────────────────────────
router.get('/by-job/:jobId', authenticate, candidateCtrl.getCandidatesByJob);
// candidates.routes.js
router.patch('/profile', authenticate, candidateCtrl.updateCandidateProfile);

// ── Apply ─────────────────────────────────────────────────────────────────────
router.post('/:id/apply',
  authenticate,
  authorize('candidate'),
  upload.single('cv'),
  candidateCtrl.applyWithCV);

// ── RH actions on applications ────────────────────────────────────────────────
router.patch('/:candidateId/application/:jobId/preselect',
  authenticate,
  candidateCtrl.preSelectCandidate);

router.patch('/:candidateId/application/:jobId/status',
  authenticate,
  candidateCtrl.updateApplicationStatus);

router.patch('/:candidateId/application/:jobId/approve-test',
  authenticate,
  candidateCtrl.approveCandidateTest);

router.patch('/:candidateId/application/:jobId/reject-test',
  authenticate,
  candidateCtrl.rejectCandidateTest);



module.exports = router;