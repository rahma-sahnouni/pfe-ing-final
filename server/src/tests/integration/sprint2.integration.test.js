'use strict';
/**
 * Tests d'intégration — Sprint 2
 * Couvre : preSelectCandidate (US-31), submitRhAnswers via HTTP
 */

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request    = require('supertest');
const mongoose   = require('mongoose');
const app        = require('../../src/app');
const User       = require('../../src/models/user.model');
const JobOffer   = require('../../src/models/jobOffer.model');
const TestRh     = require('../../src/models/testRh.model');
const TestSubmission = require('../../src/models/testSubmission.model');
const { createUser, tokenFor } = require('../helpers/auth.helper');

jest.mock('../../src/services/hf.service', () => ({
  encodeJobSkills:        jest.fn().mockResolvedValue(null),
  extractCVFromPDFBuffer: jest.fn(),
  matchCVToJobs:          jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeJobWithOwner(rh) {
  return JobOffer.create({ title: 'Offre intégration', status: 'open', createdBy: rh._id });
}

async function makeActiveTest(jobId, creatorId) {
  return TestRh.create({
    job: jobId, name: 'Test RH Intégration',
    status: 'active', createdBy: creatorId, themes: [],
  });
}

async function applyAndPreSelect(candidateId, jobId, preSelected = true, status = 'Pending') {
  await User.findByIdAndUpdate(candidateId, {
    $push: { applications: { jobOffer: jobId, status, preSelected, appliedDate: new Date() } },
  });
}

// ════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/candidates/:candidateId/application/:jobId/preselect (US-31)', () => {

  test('200 — RH propriétaire présélectionne un candidat', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    await applyAndPreSelect(candidate._id, job._id, false);

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/preselect`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ preSelected: true });

    expect(res.status).toBe(200);
    expect(res.body.preSelected).toBe(true);
  });

  test('403 — RH non propriétaire refusé', async () => {
    const owner     = await createUser({ role: 'rh' });
    const otherRh   = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(owner);
    await applyAndPreSelect(candidate._id, job._id, false);

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/preselect`)
      .set('Authorization', `Bearer ${tokenFor(otherRh)}`)
      .send({ preSelected: true });

    expect(res.status).toBe(403);
  });

  test('401 — sans authentification', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const fakeJobId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${fakeJobId}/preselect`)
      .send({ preSelected: true });

    expect(res.status).toBe(401);
  });

  test('409 — candidature déjà acceptée (statut Accepted)', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    await applyAndPreSelect(candidate._id, job._id, true, 'Accepted');

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/preselect`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ preSelected: false });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/finalized/i);
  });

  test('409 — candidature déjà rejetée (statut Rejected)', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    await applyAndPreSelect(candidate._id, job._id, false, 'Rejected');

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/preselect`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ preSelected: true });

    expect(res.status).toBe(409);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/job-tests/:rhTestId/submit — soumission du test RH', () => {

  test('201 — candidat présélectionné, test actif → soumission acceptée', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    const rhTest    = await makeActiveTest(job._id, rh._id);
    await applyAndPreSelect(candidate._id, job._id);

    const res = await request(app)
      .post(`/api/job-tests/${rhTest._id}/submit`)
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)
      .send({ answers: [] });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/submitted/i);
  });

  test('409 — re-passation d\'un test déjà soumis refusée', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    const rhTest    = await makeActiveTest(job._id, rh._id);
    await applyAndPreSelect(candidate._id, job._id);

    // Première soumission
    await TestSubmission.create({
      candidate: candidate._id, job: job._id,
      rhTest: rhTest._id, testKind: 'rh', status: 'evaluated', score: 60,
    });

    const res = await request(app)
      .post(`/api/job-tests/${rhTest._id}/submit`)
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)
      .send({ answers: [] });

    expect(res.status).toBe(409);
  });

  test('401 — passation sans authentification', async () => {
    const rhTest = await TestRh.create({
      job: new mongoose.Types.ObjectId(), name: 'Test', status: 'active',
      createdBy: new mongoose.Types.ObjectId(), themes: [],
    });

    const res = await request(app)
      .post(`/api/job-tests/${rhTest._id}/submit`)
      .send({ answers: [] });

    expect(res.status).toBe(401);
  });

  test('422 — test désactivé par le RH → accès refusé', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    const rhTest    = await TestRh.create({
      job: job._id, name: 'Test inactif', status: 'draft',
      createdBy: rh._id, themes: [],
    });
    await applyAndPreSelect(candidate._id, job._id);

    const res = await request(app)
      .post(`/api/job-tests/${rhTest._id}/submit`)
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)
      .send({ answers: [] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/non disponible/i);
  });

  test('422 — passation après la fermeture du test (testPeriod.end dépassée)', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    await JobOffer.findByIdAndUpdate(job._id, {
      testPeriod: { end: new Date(Date.now() - 3600_000) }, // il y a 1h
    });
    const rhTest = await makeActiveTest(job._id, rh._id);
    await applyAndPreSelect(candidate._id, job._id);

    const res = await request(app)
      .post(`/api/job-tests/${rhTest._id}/submit`)
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)
      .send({ answers: [] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/closed/i);
  });

  test('201 — soumission partielle acceptée (réponses partielles enregistrées)', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await makeJobWithOwner(rh);
    const rhTest    = await makeActiveTest(job._id, rh._id);
    await applyAndPreSelect(candidate._id, job._id);

    const partialAnswers = [
      { questionId: new mongoose.Types.ObjectId(), value: 3 },
    ];

    const res = await request(app)
      .post(`/api/job-tests/${rhTest._id}/submit`)
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)
      .send({ answers: partialAnswers });

    expect(res.status).toBe(201);
    const saved = await TestSubmission.findById(res.body.submission);
    expect(saved.rhAnswers).toHaveLength(1);
  });

});
