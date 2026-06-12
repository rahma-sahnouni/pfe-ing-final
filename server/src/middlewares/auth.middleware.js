const { verifyAccessToken } = require('../utils/jwt.utils');
const User = require('../models/user.model');
const logger = require('../config/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Accès non autorisé. Token manquant.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.sub).select('_id email role isActive');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable ou désactivé.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expirée. Veuillez vous reconnecter.',
        code: 'TOKEN_EXPIRED'
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token invalide.',
        code: 'TOKEN_INVALID'
      });
    }
    logger.error('Erreur authenticate middleware :', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Non authentifié' });
    }
    if (!roles.includes(req.user.role)) {
      logger.warn(`Accès refusé : utilisateur ${req.user.email} (rôle: ${req.user.role}) a tenté d'accéder à une ressource réservée à [${roles.join(', ')}]`);
      return res.status(403).json({
        success: false,
        message: "Accès interdit. Vous n'avez pas les droits nécessaires."
      });
    }
    next();
  };
};

module.exports = { authenticate, authorize };