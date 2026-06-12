// routes/codeRunner.routes.js
const express    = require('express');
const router     = express.Router();
const { runCode } = require('../controllers/codeRunner.controller');
const { authenticate, authorize } = require("../middlewares/auth.middleware");

// POST /api/code-runner/run
// Protected: only logged-in candidates can execute code
router.post('/run',  authenticate, authorize('candidate'), runCode);

module.exports = router;