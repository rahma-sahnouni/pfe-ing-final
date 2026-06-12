/**
 * Script de seeding : créer les utilisateurs initiaux en base
 * Usage : node src/scripts/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user.model');

const seedUsers = [
  {
    email: 'admin@example.com',
    password: 'Admin@123!',   // ← Respecte les règles de sécurité
    role: 'admin'
  },
  {
    email: 'rh@example.com',
    password: 'Rh@12345!',
    role: 'rh'
  },
  {
    email: 'candidate@example.com',
    password: 'Candidate@1!',
    role: 'candidate'
  }
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connecté');

    // Supprimer les utilisateurs existants avec ces emails
    const emails = seedUsers.map(u => u.email);
    await User.deleteMany({ email: { $in: emails } });
    console.log('🗑️  Anciens utilisateurs supprimés');

    // Créer les nouveaux (le middleware bcrypt se déclenche automatiquement)
    const created = await User.create(seedUsers);
    console.log(`✅ ${created.length} utilisateurs créés :`);
    created.forEach(u => console.log(`   - ${u.email} (${u.role})`));

  } catch (err) {
    console.error('❌ Erreur :', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Déconnecté de MongoDB');
    process.exit(0);
  }
};

seed();