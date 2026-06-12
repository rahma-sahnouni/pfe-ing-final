const jwt = require('jsonwebtoken');

/**
 * Génère un Access Token (courte durée)
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    issuer: 'auth-backend',
    audience: 'auth-client'
  });
};

/**
 * Génère un Refresh Token (longue durée)
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: 'auth-backend',
    audience: 'auth-client'
  });
};

/**
 * Vérifie et décode un Access Token
 * @throws {JsonWebTokenError | TokenExpiredError}
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
    issuer: 'auth-backend',
    audience: 'auth-client'
  });
};

/**
 * Vérifie et décode un Refresh Token
 * @throws {JsonWebTokenError | TokenExpiredError}
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
    issuer: 'auth-backend',
    audience: 'auth-client'
  });
};

/**
 * Construit le payload JWT à partir d'un utilisateur
 */
const buildTokenPayload = (user) => ({
  sub: user._id.toString(),
  email: user.email,
  role: user.role
});

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  buildTokenPayload
};