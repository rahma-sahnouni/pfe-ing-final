const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
// ────────────────────────────────────────────────
// Limiter global (toutes les routes)
// ────────────────────────────────────────────────
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de requêtes. Réessayez dans 15 minutes.'
  }
});

// ────────────────────────────────────────────────
// Limiter strict pour la connexion (anti brute-force)
// ────────────────────────────────────────────────
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Trop de tentatives de connexion. Compte temporairement bloqué. Réessayez dans 15 minutes.'
  },
keyGenerator: (req) => {
  const email = req.body?.email?.toLowerCase() || '';
  const ip = ipKeyGenerator(req);
  return `${ip}-${email}`;
}
});


// ────────────────────────────────────────────────
// Limiter pour l'inscription
// ────────────────────────────────────────────────
const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5, // 5 inscriptions par heure par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de créations de compte depuis cette adresse. Réessayez dans 1 heure.'
  }
});

module.exports = {
  globalRateLimiter,
  loginRateLimiter,
  registerRateLimiter
};