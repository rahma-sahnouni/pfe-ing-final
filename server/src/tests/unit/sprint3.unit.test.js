'use strict';
/**
 * Tests UNITAIRES — Sprint 3
 * Couvre : technical-test.controller.js
 *   createTest, getTestById, updateTest, deleteTest
 *
 * Note : changeTechnicalTestStatus n'existe pas dans le contrôleur.
 * Ces tests remplacent les anciens tests d'intégration par des tests
 * qui mockent tous les modèles Mongoose — aucune connexion à une base de données.
 */

process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

jest.mock('../../models/technical-test.model');
jest.mock('../../models/jobOffer.model');
jest.mock('../../models/notification.model');
jest.mock('../../utils/socket', () => ({
  getIO: jest.fn(() => ({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })),
}));

const TechnicalTest = require('../../models/technical-test.model');
const JobOffer      = require('../../models/jobOffer.model');
const Notification  = require('../../models/notification.model');

const {
  createTest,
  getTestById,
  updateTest,
  deleteTest,
} = require('../../controllers/technical-test.controller');

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

const CREATOR_ID = 'uid-creator';
const TEST_ID    = 'tech-test-id-1';

function makeTestInstance(overrides = {}) {
  return {
    _id:              TEST_ID,
    title:            'Test QCM JavaScript',
    testType:         'qcm',
    difficulty:       'easy',
    timeLimitMinutes: 30,
    createdBy:        CREATOR_ID,
    tags:             ['JavaScript'],
    status:           'draft',
    qcm:              { questions: [{ questionText: 'Q1?', type: 'single_choice', options: [] }] },
    save:             jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('createTest', () => {

  test('201 — test technique créé avec succès', async () => {
    const instance = makeTestInstance();
    TechnicalTest.mockImplementation(() => instance);

    const req = {
      user: { _id: CREATOR_ID },
      body: { title: 'Test QCM JavaScript', testType: 'qcm', difficulty: 'easy', timeLimitMinutes: 30, tags: ['JavaScript'] },
    };
    const res = buildRes();
    await createTest(req, res, jest.fn());

    expect(instance.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(instance);
  });

  test('422 — erreur de validation Mongoose', async () => {
    const instance = {
      save: jest.fn().mockRejectedValue({
        name:   'ValidationError',
        errors: { title: { message: 'Title is required' } },
      }),
    };
    TechnicalTest.mockImplementation(() => instance);

    const req  = { user: { _id: CREATOR_ID }, body: {} };
    const res  = buildRes();
    await createTest(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Validation failed' }));
  });

  test('422 — message d\'erreur lié aux questions', async () => {
    const instance = {
      save: jest.fn().mockRejectedValue(new Error('At least one question is required')),
    };
    TechnicalTest.mockImplementation(() => instance);

    const req = { user: { _id: CREATOR_ID }, body: { title: 'Test vide', testType: 'qcm' } };
    const res = buildRes();
    await createTest(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('getTestById', () => {

  test('200 — retourne le test trouvé', async () => {
    const test = makeTestInstance();
    TechnicalTest.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(test),
    });

    const req = { params: { id: TEST_ID } };
    const res = buildRes();
    await getTestById(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(test);
    expect(TechnicalTest.findById).toHaveBeenCalledWith(TEST_ID);
  });

  test('404 — test introuvable', async () => {
    TechnicalTest.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    const req = { params: { id: 'bad-id' } };
    const res = buildRes();
    await getTestById(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('updateTest', () => {

  test('200 — mise à jour réussie', async () => {
    const updatedTest = makeTestInstance({ title: 'Nouveau titre' });
    TechnicalTest.findOneAndUpdate.mockResolvedValue(updatedTest);

    const req = {
      params: { id: TEST_ID },
      body:   { title: 'Nouveau titre' },
      user:   { _id: CREATOR_ID },
    };
    const res = buildRes();
    await updateTest(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(updatedTest);
    expect(TechnicalTest.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TEST_ID, createdBy: CREATOR_ID },
      { title: 'Nouveau titre' },
      { new: true, runValidators: true }
    );
  });

  test('404 — test introuvable ou non autorisé', async () => {
    TechnicalTest.findOneAndUpdate.mockResolvedValue(null);

    const req = { params: { id: 'bad-id' }, body: {}, user: { _id: 'another-uid' } };
    const res = buildRes();
    await updateTest(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found|unauthorized/i) }));
  });

  test('422 — erreur de validation Mongoose lors de la mise à jour', async () => {
    TechnicalTest.findOneAndUpdate.mockRejectedValue({
      name:   'ValidationError',
      errors: { difficulty: { message: 'Difficulté invalide' } },
    });

    const req = { params: { id: TEST_ID }, body: { difficulty: 'INVALID' }, user: { _id: CREATOR_ID } };
    const res = buildRes();
    await updateTest(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('deleteTest', () => {

  test('200 — suppression réussie', async () => {
    TechnicalTest.findOneAndDelete.mockResolvedValue(makeTestInstance());

    const req = { params: { id: TEST_ID }, user: { _id: CREATOR_ID } };
    const res = buildRes();
    await deleteTest(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/deleted/i) }));
    expect(TechnicalTest.findOneAndDelete).toHaveBeenCalledWith({ _id: TEST_ID, createdBy: CREATOR_ID });
  });

  test('404 — test introuvable ou non autorisé pour suppression', async () => {
    TechnicalTest.findOneAndDelete.mockResolvedValue(null);

    const req = { params: { id: 'ghost-id' }, user: { _id: 'other-uid' } };
    const res = buildRes();
    await deleteTest(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found|unauthorized/i) }));
  });

});
