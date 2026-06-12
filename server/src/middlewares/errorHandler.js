const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  logger.error(`[${req.method}] ${req.originalUrl} — ${err.message}`, {
    stack: err.stack
  });

  // Erreur Mongoose : duplication de clé unique (ex: email déjà utilisé)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `Un compte avec ce ${field} existe déjà.`
    });
  }

  // Erreur Mongoose : validation du schéma
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(422).json({
      success: false,
      message: 'Erreur de validation',
      errors: messages
    });
  }

  // Erreur CORS
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  // Erreur générique
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Erreur serveur interne'
      : err.message || 'Erreur serveur interne';

  res.status(statusCode).json({ success: false, message });
};

module.exports = errorHandler;