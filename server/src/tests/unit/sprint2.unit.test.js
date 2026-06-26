'use strict';
/**
 * Tests UNITAIRES — Sprint 2
 * Couvre : submitRhAnswers (testSubmission.controller)
 *          getRecommendedJobs (candidate.controller)
 *
 * Toutes les dépendances sont mockées — aucune connexion à une base de données.
 */

process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

jest.mock('../../models/user.model');
jest.mock('../../models/jobOffer.model');
jest.mock('../../models/testRh.model');
jest.mock('../../models/testSubmission.model');
jest.mock('../../models/notification.model');
jest.mock('../../models/technical-test.model');
jest.mock('../../utils/socket', () => ({
  getIO: jest.fn(() => ({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })),
}));
jest.mock('../../services/hf.service', () => ({
  encodeJobSkills:        jest.fn().mockResolvedValue(null),
  extractCVFromPDFBuffer: jest.fn(),
  matchCVToJobs:          jest.fn(),
}));
jest.mock('pdf-parse', () => jest.fn());

const mongoose       = require('mongoose');
const User           = require('../../models/user.model');
const JobOffer       = require('../../models/jobOffer.model');
const TestRh         = require('../../models/testRh.model');
const TestSubmission = require('../../models/testSubmission.model');
const Notification   = require('../../models/notification.model');
const { matchCVToJobs } = require('../../services/hf.service');

// Fournir statics.BUILTIN_MODELS attendu par testSubmission.controller
TestRh.schema = { statics: { BUILTIN_MODELS: {} } };

const { submitRhAnswers }    = require('../../controllers/testSubmission.controller');
const { getRecommendedJobs } = require('../../controllers/candidate.controller');

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

const JOB_ID  = 'job-id-1';
const CAND_ID = 'cand-id-1';
const TEST_ID = 'test-id-1';

function makeRhTest(overrides = {}) {
  return {
    _id:    TEST_ID,
    job:    JOB_ID,
    status: 'active',
    themes: [],
    ...overrides,
  };
}

function makeCandidate(preSelected = true) {
  return {
    _id:  CAND_ID,
    name: 'Candidat Test',
    email: 'cand@test.com',
    applications: [
      {
        jobOffer:    { _id: JOB_ID },
        status:      'Pending',
        preSelected,
      },
    ],
  };
}

afterEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('submitRhAnswers — logique de contrôle d\'accès', () => {

  test('404 — test RH introuvable', async () => {
    TestRh.findById.mockResolvedValue(null);
    TestRh.findOne.mockResolvedValue(null);

    const req = { user: { _id: CAND_ID }, params: { rhTestId: 'bad-id' }, body: { answers: [] } };
    const res = buildRes();
    await submitRhAnswers(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
  });

  test('403 — candidat n\'a pas postulé à cette offre', async () => {
    TestRh.findById.mockResolvedValue(makeRhTest());
    User.findById.mockResolvedValue({
      _id:          CAND_ID,
      applications: [], // aucune candidature
    });

    const req = { user: { _id: CAND_ID }, params: { rhTestId: TEST_ID }, body: { answers: [] } };
    const res = buildRes();
    await submitRhAnswers(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not applied/i) }));
  });

  test('403 — candidat non présélectionné (preSelected: false)', async () => {
    TestRh.findById.mockResolvedValue(makeRhTest());
    User.findById.mockResolvedValue(makeCandidate(false));

    const req = { user: { _id: CAND_ID }, params: { rhTestId: TEST_ID }, body: { answers: [] } };
    const res = buildRes();
    await submitRhAnswers(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/pre-selected/i) }));
  });

  test('409 — test déjà soumis (double soumission refusée)', async () => {
    TestRh.findById.mockResolvedValue(makeRhTest());
    User.findById.mockResolvedValue(makeCandidate(true));
    TestSubmission.findOne.mockResolvedValue({ _id: 'existing-sub' });

    const req = { user: { _id: CAND_ID }, params: { rhTestId: TEST_ID }, body: { answers: [] } };
    const res = buildRes();
    await submitRhAnswers(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/already submitted/i) }));
  });

  test('201 — soumission acceptée, score calculé et retourné', async () => {
    TestRh.findById.mockResolvedValue(makeRhTest());
    User.findById.mockResolvedValue(makeCandidate(true));
    TestSubmission.findOne.mockResolvedValue(null); // pas de doublon
    TestSubmission.create.mockResolvedValue({ _id: 'new-sub-id', score: 0 });
    TestSubmission.find.mockResolvedValue([{ score: 0 }]); // pour _refreshCandidateScore
    User.findByIdAndUpdate.mockResolvedValue(undefined);
    JobOffer.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) }); // notifications optionnelles
    Notification.create.mockResolvedValue({});

    const req = { user: { _id: CAND_ID }, params: { rhTestId: TEST_ID }, body: { answers: [] } };
    const res = buildRes();
    await submitRhAnswers(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message:    expect.stringMatching(/submitted/i),
      submission: 'new-sub-id',
    }));
    expect(TestSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({ candidate: CAND_ID, job: JOB_ID, testKind: 'rh' })
    );
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('getRecommendedJobs — score de compatibilité', () => {

  test('400 — profil incomplet (pas de CV uploadé)', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: CAND_ID, cvRawText: null, cvExtracted: null }),
    });

    const req = { user: { _id: CAND_ID }, query: {} };
    const res = buildRes();
    await getRecommendedJobs(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/no cv/i) }));
  });

  test('200 — aucune offre ouverte → tableau de recommandations vide', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: CAND_ID, cvRawText: 'cv text', cvExtracted: { skills: [] } }),
    });
    JobOffer.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue([]),
    });

    const req = { user: { _id: CAND_ID }, query: {} };
    const res = buildRes();
    await getRecommendedJobs(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ recommendations: [] });
  });

  test('503 — service d\'IA indisponible (matchCVToJobs retourne [])', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: CAND_ID, cvRawText: 'cv text', cvExtracted: null }),
    });
    JobOffer.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue([{ _id: 'job-1', title: 'Dev', status: 'open' }]),
    });
    matchCVToJobs.mockResolvedValue([]);

    const req = { user: { _id: CAND_ID }, query: {} };
    const res = buildRes();
    await getRecommendedJobs(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/unavailable/i) }));
  });

  test('200 — score 100% pour profil parfaitement compatible', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: CAND_ID, cvRawText: 'expert cv', cvExtracted: { skills: ['Python', 'Node.js'] },
      }),
    });
    const openJob = { _id: 'job-1', title: 'Dev Senior', status: 'open', embedding: null };
    JobOffer.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue([openJob]),
    });
    matchCVToJobs.mockResolvedValue([{
      jobIndex: 0, score: 100, matchedSkills: ['Python', 'Node.js'], missingSkills: [],
      blockedByPrereqs: false, prereqDetails: [], semanticScore: 1, experienceScore: 1,
      levelScore: 1, recommendation: 'perfect match', analysis: '',
    }]);

    const req = { user: { _id: CAND_ID }, query: {} };
    const res = buildRes();
    await getRecommendedJobs(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendations: expect.arrayContaining([
          expect.objectContaining({ score: 100 }),
        ]),
      })
    );
  });

  test('200 — blockedByPrereqs → score 0%', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: CAND_ID, cvRawText: 'cv', cvExtracted: null }),
    });
    const openJob = { _id: 'job-2', title: 'AWS Architect', status: 'open', embedding: null };
    JobOffer.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue([openJob]),
    });
    matchCVToJobs.mockResolvedValue([{
      jobIndex: 0, score: 0, matchedSkills: [], missingSkills: ['Certification AWS'],
      blockedByPrereqs: true, prereqDetails: [{ type: 'Certification', obligatory: true, met: false }],
      semanticScore: 0, experienceScore: 0, levelScore: 0, recommendation: 'blocked', analysis: '',
    }]);

    const req = { user: { _id: CAND_ID }, query: {} };
    const res = buildRes();
    await getRecommendedJobs(req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    const blocked = body.recommendations.filter(r => r.blockedByPrereqs);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].score).toBe(0);
  });

});
