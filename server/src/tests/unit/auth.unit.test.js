'use strict';
/**
 * Tests UNITAIRES — auth.controller.js
 * Toutes les dépendances (User, JWT, nodemailer) sont mockées.
 * Aucune connexion à une base de données.
 */

process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

jest.mock('../../models/user.model');
jest.mock('../../utils/jwt.utils');
jest.mock('../../config/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));
jest.mock('nodemailer', () => ({
  createTransport:   jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) })),
  createTestAccount: jest.fn().mockResolvedValue({ user: 'u', pass: 'p' }),
  getTestMessageUrl: jest.fn().mockReturnValue('http://ethereal.fake'),
}));

const User = require('../../models/user.model');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  buildTokenPayload,
} = require('../../utils/jwt.utils');

const {
  register,
  login,
  changePassword,
  refreshToken,
  logout,
} = require('../../controllers/auth.controller');

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

function makeUserMock(overrides = {}) {
  return {
    _id:               'uid-1',
    email:             'test@test.com',
    role:              'rh',
    isActive:          true,
    refreshTokens:     [],
    loginAttempts:     0,
    lockUntil:         null,
    comparePassword:   jest.fn().mockResolvedValue(true),
    isLocked:          jest.fn().mockReturnValue(false),
    incLoginAttempts:  jest.fn().mockResolvedValue(undefined),
    resetLoginAttempts: jest.fn().mockResolvedValue(undefined),
    toSafeObject:      jest.fn().mockReturnValue({ email: 'test@test.com', role: 'rh' }),
    save:              jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('register', () => {

  test('201 — compte créé avec succès', async () => {
    const createdUser = makeUserMock({ email: 'new@test.com' });
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue(createdUser);

    const req = { body: { email: 'new@test.com', password: 'Password123!', role: 'rh', name: 'Alice' } };
    const res = buildRes();
    await register(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('409 — email déjà utilisé', async () => {
    User.findOne.mockResolvedValue(makeUserMock({ email: 'dup@test.com' }));

    const req = { body: { email: 'dup@test.com', password: 'Password123!', role: 'rh', name: 'Bob' } };
    const res = buildRes();
    await register(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('400 — nom trop court (< 2 caractères)', async () => {
    const req = { body: { email: 'x@test.com', password: 'Password123!', role: 'rh', name: 'A' } };
    const res = buildRes();
    await register(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 — nom absent', async () => {
    const req = { body: { email: 'y@test.com', password: 'Password123!', role: 'rh' } };
    const res = buildRes();
    await register(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('login', () => {

  test('200 — identifiants valides → tokens retournés', async () => {
    const user = makeUserMock({ email: 'valid@test.com' });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    buildTokenPayload.mockReturnValue({ sub: 'uid-1' });
    generateAccessToken.mockReturnValue('access-token');
    generateRefreshToken.mockReturnValue('refresh-token');
    User.findByIdAndUpdate.mockResolvedValue(undefined);

    const req = { body: { email: 'valid@test.com', password: 'Password123!' }, ip: '127.0.0.1' };
    const res = buildRes();
    await login(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success:      true,
      accessToken:  'access-token',
      refreshToken: 'refresh-token',
    }));
  });

  test('401 — email inexistant', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    const req = { body: { email: 'ghost@test.com', password: 'Password123!' }, ip: '127.0.0.1' };
    const res = buildRes();
    await login(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 — mot de passe incorrect', async () => {
    const user = makeUserMock({ comparePassword: jest.fn().mockResolvedValue(false) });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = { body: { email: 'valid@test.com', password: 'WrongPass!' }, ip: '127.0.0.1' };
    const res = buildRes();
    await login(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(user.incLoginAttempts).toHaveBeenCalled();
  });

  test('403 — compte désactivé', async () => {
    const user = makeUserMock({ isActive: false });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = { body: { email: 'inactive@test.com', password: 'Password123!' }, ip: '127.0.0.1' };
    const res = buildRes();
    await login(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('423 — compte verrouillé', async () => {
    const user = makeUserMock({
      isLocked:  jest.fn().mockReturnValue(true),
      lockUntil: new Date(Date.now() + 10 * 60_000),
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = { body: { email: 'locked@test.com', password: 'Password123!' }, ip: '127.0.0.1' };
    const res = buildRes();
    await login(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(423);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('changePassword', () => {

  test('200 — changement valide', async () => {
    const user = makeUserMock();
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = {
      user: { _id: 'uid-1' },
      body: { currentPassword: 'OldPass123!', newPassword: 'NewPass456@' },
    };
    const res = buildRes();
    await changePassword(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(user.save).toHaveBeenCalled();
  });

  test('400 — champs manquants', async () => {
    const req = { user: { _id: 'uid-1' }, body: {} };
    const res = buildRes();
    await changePassword(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 — nouveau mot de passe trop court (< 8 caractères)', async () => {
    const req = {
      user: { _id: 'uid-1' },
      body: { currentPassword: 'OldPass123!', newPassword: 'short' },
    };
    const res = buildRes();
    await changePassword(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('401 — mot de passe actuel incorrect', async () => {
    const user = makeUserMock({ comparePassword: jest.fn().mockResolvedValue(false) });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const req = {
      user: { _id: 'uid-1' },
      body: { currentPassword: 'WrongPass!', newPassword: 'NewPass456@' },
    };
    const res = buildRes();
    await changePassword(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('404 — utilisateur introuvable', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    const req = {
      user: { _id: 'uid-ghost' },
      body: { currentPassword: 'OldPass123!', newPassword: 'NewPass456@' },
    };
    const res = buildRes();
    await changePassword(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('refreshToken', () => {

  test('200 — refresh valide → nouveaux tokens', async () => {
    const token = 'valid-refresh-token';
    verifyRefreshToken.mockReturnValue({ sub: 'uid-1', email: 'rt@test.com', role: 'rh' });

    const user = makeUserMock({ refreshTokens: [token] });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    buildTokenPayload.mockReturnValue({ sub: 'uid-1' });
    generateAccessToken.mockReturnValue('new-access-token');
    generateRefreshToken.mockReturnValue('new-refresh-token');
    User.findByIdAndUpdate.mockResolvedValue(undefined);

    const req = { body: { refreshToken: token } };
    const res = buildRes();
    await refreshToken(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      accessToken:  'new-access-token',
      refreshToken: 'new-refresh-token',
    }));
  });

  test('401 — token invalide (signature incorrecte)', async () => {
    verifyRefreshToken.mockImplementation(() => { throw new Error('invalid token'); });

    const req = { body: { refreshToken: 'totalement.faux.token' } };
    const res = buildRes();
    await refreshToken(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 — token absent de la liste utilisateur (token révoqué)', async () => {
    verifyRefreshToken.mockReturnValue({ sub: 'uid-1' });
    const user = makeUserMock({ refreshTokens: [] }); // token absent
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    User.findByIdAndUpdate.mockResolvedValue(undefined);

    const req = { body: { refreshToken: 'revoked-token' } };
    const res = buildRes();
    await refreshToken(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 — utilisateur introuvable en base', async () => {
    verifyRefreshToken.mockReturnValue({ sub: 'uid-ghost' });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    const req = { body: { refreshToken: 'some-token' } };
    const res = buildRes();
    await refreshToken(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('logout', () => {

  test('200 — déconnexion réussie, refresh token retiré', async () => {
    User.findByIdAndUpdate.mockResolvedValue(undefined);

    const req = {
      user: { _id: 'uid-1', email: 'lo@test.com' },
      body: { refreshToken: 'refresh-token' },
    };
    const res = buildRes();
    await logout(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'uid-1',
      { $pull: { refreshTokens: 'refresh-token' } }
    );
  });

  test('200 — déconnexion sans refresh token dans le body', async () => {
    const req = { user: { _id: 'uid-1', email: 'lo@test.com' }, body: {} };
    const res = buildRes();
    await logout(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

});
