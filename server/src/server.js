require('dotenv').config();
const { createServer } = require('http');
const app        = require('./app');
const connectDB  = require('./config/database');
const logger     = require('./config/logger');
const socketUtil = require('./utils/socket');

const PORT = process.env.PORT || 3000;

// ── Connexion MongoDB puis démarrage ──
connectDB().then(() => {

  const httpServer = createServer(app);  // ← wrape Express dans un serveur HTTP natif
  socketUtil.init(httpServer);           // ← initialise Socket.IO sur ce serveur

  httpServer.listen(PORT, () => {
    logger.info(`🚀 Serveur démarré sur le port ${PORT} en mode ${process.env.NODE_ENV}`);
  });

}).catch((err) => {
  logger.error('Échec de connexion à MongoDB :', err);
  process.exit(1);
});

// ── Gestion des erreurs non catchées ──
process.on('unhandledRejection', (err) => {
  logger.error('UnhandledRejection :', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('UncaughtException :', err.message);
  process.exit(1);
});