'use strict';
/**
 * Tests UNITAIRES — jobOffer.controller.js
 * Couvre : createJob, getJobById, updateJob, deleteJob
 *
 * Note : changeJobStatus n'existe pas dans le contrôleur.
 * Ces tests remplacent les anciens tests d'intégration par des tests
 * qui mockent tous les modèles Mongoose — aucune connexion à une base de données.
 */

jest.mock('../../models/jobOffer.model');
jest.mock('../../models/notification.model');
jest.mock('../../models/testRh.model');
jest.mock('../../models/technical-test.model');
jest.mock('../../models/testSubmission.model');
jest.mock('../../models/user.model');
jest.mock('../../services/hf.service', () => ({
  encodeJobSkills: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../utils/socket', () => ({
  getIO: jest.fn(() => ({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })),
}));

const mongoose = require('mongoose');
const JobOffer     = require('../../models/jobOffer.model');
const Notification = require('../../models/notification.model');
const TestRh       = require('../../models/testRh.model');
const TechnicalTest  = require('../../models/technical-test.model');
const TestSubmission = require('../../models/testSubmission.model');
const User         = require('../../models/user.model');

const {
  createJob,
  getJobById,
  updateJob,
  deleteJob,
} = require('../../controllers/jobOffer.controller');

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

function makeJobInstance(overrides = {}) {
  return {
    _id:             'job-id-1',
    title:           'Ingénieur JS',
    status:          'draft',
    createdBy:       'uid-1',
    testAssignments: { rhTest: { enabled: false, assignedTo: [] }, technicalTest: { enabled: false, assignedTo: [] } },
    intervAssignments: { rhTest: { enabled: false, assignedTo: [] }, technicalTest: { enabled: false, assignedTo: [] } },
    technicalTests:  [],
    save:            jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('createJob', () => {

  test('201 — offre créée avec succès', async () => {
    const jobInstance = makeJobInstance();
    JobOffer.mockImplementation(() => jobInstance);
    Notification.insertMany.mockResolvedValue([]);

    const req = {
      user: { _id: 'uid-1' },
      body: { title: 'Ingénieur JS', department: 'Tech', location: 'Paris', contractType: 'CDI' },
    };
    const res = buildRes();
    await createJob(req, res, jest.fn());

    expect(jobInstance.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/created/i) }));
  });

  test('422 — erreur de validation Mongoose → 422', async () => {
    const validationError = {
      name:   'ValidationError',
      errors: { title: { message: 'Title is required' } },
    };
    const jobInstance = { ...makeJobInstance(), save: jest.fn().mockRejectedValue(validationError) };
    JobOffer.mockImplementation(() => jobInstance);

    const req = { user: { _id: 'uid-1' }, body: {} };
    const res = buildRes();
    await createJob(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Validation failed' }));
  });

  test('appelle next(err) pour les erreurs non-validation', async () => {
    const jobInstance = { ...makeJobInstance(), save: jest.fn().mockRejectedValue(new Error('DB crash')) };
    JobOffer.mockImplementation(() => jobInstance);

    const req  = { user: { _id: 'uid-1' }, body: { title: 'Test' } };
    const res  = buildRes();
    const next = jest.fn();
    await createJob(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('getJobById', () => {

  test('200 — retourne l\'offre trouvée', async () => {
    const job = makeJobInstance();
    JobOffer.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      // second populate call (chained)
      then: undefined,
    });
    // Le contrôleur enchaîne deux populate
    const populateMock = jest.fn().mockReturnThis();
    populateMock.mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(job) });
    JobOffer.findById.mockReturnValue({ populate: populateMock });

    const req = { params: { id: 'job-id-1' } };
    const res = buildRes();
    await getJobById(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(job);
  });

  test('404 — offre introuvable', async () => {
    const populateMock = jest.fn().mockReturnThis();
    populateMock.mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(null) });
    JobOffer.findById.mockReturnValue({ populate: populateMock });

    const req = { params: { id: 'job-ghost' } };
    const res = buildRes();
    await getJobById(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('updateJob', () => {

  test('200 — offre mise à jour avec succès', async () => {
    const updatedJob = makeJobInstance({ title: 'Nouveau titre' });
    JobOffer.findByIdAndUpdate.mockResolvedValue(updatedJob);

    const req = { params: { id: 'job-id-1' }, body: { title: 'Nouveau titre' }, user: { _id: 'uid-1' } };
    const res = buildRes();
    await updateJob(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(updatedJob);
  });

  test('404 — offre introuvable lors de la mise à jour', async () => {
    JobOffer.findByIdAndUpdate.mockResolvedValue(null);

    const req = { params: { id: 'job-ghost' }, body: { title: 'X' }, user: { _id: 'uid-1' } };
    const res = buildRes();
    await updateJob(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('422 — erreur de validation Mongoose lors de la mise à jour', async () => {
    JobOffer.findByIdAndUpdate.mockRejectedValue({
      name:   'ValidationError',
      errors: { contractType: { message: 'Type invalide' } },
    });

    const req = { params: { id: 'job-id-1' }, body: { contractType: 'INVALID' }, user: { _id: 'uid-1' } };
    const res = buildRes();
    await updateJob(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('deleteJob', () => {

  test('200 — suppression en cascade réussie', async () => {
    const job = makeJobInstance({ technicalTests: [] });
    JobOffer.findByIdAndDelete.mockResolvedValue(job);
    TestRh.deleteMany.mockResolvedValue({ deletedCount: 1 });
    TechnicalTest.deleteMany.mockResolvedValue({ deletedCount: 0 });
    TestSubmission.deleteMany.mockResolvedValue({ deletedCount: 2 });
    User.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const req = { params: { id: 'job-id-1' } };
    const res = buildRes();
    await deleteJob(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/deleted/i) }));
    expect(TestRh.deleteMany).toHaveBeenCalled();
    expect(TestSubmission.deleteMany).toHaveBeenCalled();
    expect(User.updateMany).toHaveBeenCalled();
  });

  test('404 — offre introuvable lors de la suppression', async () => {
    JobOffer.findByIdAndDelete.mockResolvedValue(null);

    const req = { params: { id: 'job-ghost' } };
    const res = buildRes();
    await deleteJob(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
  });

});
