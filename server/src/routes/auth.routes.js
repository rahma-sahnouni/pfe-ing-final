'use strict';
const express = require('express');
const router  = express.Router();

const {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  getMe,
  changePassword,
  forgotPassword,   // ← importé directement depuis le controller
  resetPassword,    // ← importé directement depuis le controller
} = require('../controllers/auth.controller');

const { authenticate, authorize } = require('../middlewares/auth.middleware');
const validate                    = require('../middlewares/validate');
const { loginRateLimiter, registerRateLimiter } = require('../middlewares/rateLimiter');
const { loginSchema, registerSchema, refreshTokenSchema } = require('../utils/validation.schemas');

// ────────────────────────────────────────────────
// Routes publiques
// ────────────────────────────────────────────────

router.post('/register',
  registerRateLimiter,
  validate(registerSchema),
  register
);

router.post('/login',
  loginRateLimiter,
  validate(loginSchema),
  login
);

router.post('/refresh',
  validate(refreshTokenSchema),
  refreshToken
);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

// ────────────────────────────────────────────────
// Routes protégées (JWT requis)
// ────────────────────────────────────────────────

router.get('/me', authenticate, getMe);

router.post('/logout',     authenticate, validate(refreshTokenSchema), logout);
router.post('/logout-all', authenticate, logoutAll);
router.post('/change-password', authenticate, changePassword);

// ────────────────────────────────────────────────
// Routes RBAC (exemples)
// ────────────────────────────────────────────────

router.get('/admin-only',
  authenticate,
  authorize('admin'),
  (req, res) => res.json({ success: true, message: 'Bienvenue Admin !' })
);

router.get('/rh-area',
  authenticate,
  authorize('admin', 'rh'),
  (req, res) => res.json({ success: true, message: 'Espace RH / Admin' })
);

module.exports = router;