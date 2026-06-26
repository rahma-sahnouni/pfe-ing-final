'use strict';
// helpers/auth.helper.js — crée des utilisateurs en base et génère leurs tokens JWT

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('../../src/models/user.model');
const { generateAccessToken } = require('../../src/utils/jwt.utils');

async function createUser(overrides = {}) {
  const defaults = {
    _id:      new mongoose.Types.ObjectId(),
    name:     'Test User',
    email:    `test_${Date.now()}@example.com`,
    password: await bcrypt.hash('Password123!', 10),
    role:     'rh',
    isActive: true,
  };
  const data = { ...defaults, ...overrides };
  const user = await User.create(data);
  return user;
}

function tokenFor(user) {
  return generateAccessToken({
    sub:   user._id.toString(),
    email: user.email,
    role:  user.role,
  });
}

module.exports = { createUser, tokenFor };
