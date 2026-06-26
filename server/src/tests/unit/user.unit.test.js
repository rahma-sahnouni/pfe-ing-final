'use strict';
/**
 * Tests UNITAIRES — user.controller.js
 * Le modèle User est entièrement mocké — aucune connexion à une base de données.
 */

jest.mock('../../models/user.model');

const User = require('../../models/user.model');
const { createUser, deleteUser, getUsers } = require('../../controllers/user.controller');

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

afterEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('getUsers', () => {

  test('200 — retourne la liste de tous les utilisateurs formatée', async () => {
    const fakeUsers = [
      { _id: '1', email: 'u1@test.com', name: 'Un',   role: 'rh',        isActive: true, lastLogin: null, createdAt: new Date() },
      { _id: '2', email: 'u2@test.com', name: 'Deux', role: 'candidate', isActive: true, lastLogin: null, createdAt: new Date() },
    ];
    User.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(fakeUsers) });

    const res = buildRes();
    await getUsers({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ email: 'u1@test.com', role: 'rh' }),
        expect.objectContaining({ email: 'u2@test.com', role: 'candidate' }),
      ])
    );
    // Le champ password ne doit jamais être renvoyé
    const body = res.json.mock.calls[0][0];
    body.forEach(u => expect(u.password).toBeUndefined());
  });

  test('200 — retourne un tableau vide si aucun utilisateur', async () => {
    User.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    const res = buildRes();
    await getUsers({}, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('500 — erreur base de données → message d\'erreur', async () => {
    User.find.mockReturnValue({
      sort: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const res = buildRes();
    await getUsers({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'DB error' }));
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('createUser', () => {

  const validSafeObject = { id: 'new-id', email: 'rh@test.com', role: 'rh' };

  function mockNewUser(opts = {}) {
    const instance = {
      save:         jest.fn().mockResolvedValue(undefined),
      toSafeObject: jest.fn().mockReturnValue(opts.safe ?? validSafeObject),
    };
    User.mockImplementation(() => instance);
    return instance;
  }

  test('201 — crée un utilisateur RH valide', async () => {
    User.findOne.mockResolvedValue(null);
    mockNewUser();

    const req = { body: { email: 'rh@test.com', password: 'Password123!', role: 'rh', name: 'Marie' } };
    const res = buildRes();
    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('201 — crée un candidat avec champs spécifiques', async () => {
    User.findOne.mockResolvedValue(null);
    mockNewUser({ safe: { id: 'cand-id', email: 'cand@test.com', role: 'candidate' } });

    const req = {
      body: { email: 'cand@test.com', password: 'Password123!', role: 'candidate', name: 'Jean', phone: '0600000000', experience: 3 },
    };
    const res = buildRes();
    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('409 — email déjà existant', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing-id' });

    const req = { body: { email: 'exist@test.com', password: 'Password123!', role: 'rh', name: 'Deja' } };
    const res = buildRes();
    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/already exists/i) }));
  });

  test('400 — rôle invalide', async () => {
    const req = { body: { email: 'bad@test.com', password: 'Password123!', role: 'superadmin', name: 'Bad' } };
    const res = buildRes();
    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/invalid role/i) }));
  });

  test('400 — champ obligatoire manquant (pas de role)', async () => {
    const req = { body: { email: 'noRole@test.com', password: 'Password123!' } };
    const res = buildRes();
    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/required/i) }));
  });

  test('422 — erreur de validation Mongoose (save rejette)', async () => {
    User.findOne.mockResolvedValue(null);
    const instance = {
      save:         jest.fn().mockRejectedValue({ name: 'ValidationError', errors: { email: { message: 'Email invalide' } } }),
      toSafeObject: jest.fn(),
    };
    User.mockImplementation(() => instance);

    const req = { body: { email: 'bad-format', password: 'Password123!', role: 'rh', name: 'Test' } };
    const res = buildRes();
    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('deleteUser', () => {

  test('200 — utilisateur supprimé avec succès', async () => {
    User.findByIdAndDelete.mockResolvedValue({ _id: 'uid-to-del', email: 'todel@test.com' });

    const req = { params: { id: 'uid-to-del' } };
    const res = buildRes();
    await deleteUser(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/deleted/i) }));
    expect(User.findByIdAndDelete).toHaveBeenCalledWith('uid-to-del');
  });

  test('404 — utilisateur introuvable', async () => {
    User.findByIdAndDelete.mockResolvedValue(null);

    const req = { params: { id: 'uid-ghost' } };
    const res = buildRes();
    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
  });

  test('500 — erreur inattendue → 500', async () => {
    User.findByIdAndDelete.mockRejectedValue(new Error('DB crash'));

    const req = { params: { id: 'uid-1' } };
    const res = buildRes();
    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

});
