const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI est manquant dans les variables d\'environnement');
  }

  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== 'production', // Désactiver en prod pour perf
  });

  logger.info(`✅ MongoDB connecté : ${mongoose.connection.host}`);

  mongoose.connection.on('error', (err) => {
    logger.error('Erreur MongoDB :', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB déconnecté');
  });
};

module.exports = connectDB;