'use strict';
/**
 * Tests d'intégration — Sprint 3
 * Couvre : changeTechnicalTestStatus (US-51), accept/reject candidat (US-58)
 */

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request        = require('supertest');
const mongoose       = require('mongoose');
const app            = require('../../src/app');
const User           = require('../../src/models/user.model');
const JobOffer       = require('../../src/models/jobOffer.model');
const TechnicalTest  = require('../../src/models/technical-test.model');
const TestSubmission = require('../../src/models/testSubmission.model');
const Notification   = require('../../src/models/notification.model');
const { createUser, tokenFor } = require('../helpers/auth.helper');

jest.mock('../../src/services/hf.service', () => ({
  encodeJobSkills:        jest.fn().mockResolvedValue(null),
  extractCVFromPDFBuffer: jest.fn(),
  matchCVToJobs:          jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeCompleteQCMTest(evaluator) {
  return TechnicalTest.create({
    title:            `Test Sprint3 ${Date.now()}`,
    testType:         'qcm',
    difficulty:       'medium',
    timeLimitMinutes: 45,
    createdBy:        evaluator._id,
    tags:             ['Node.js'],
    status:           'draft',
    qcm: {
      questions: [{
        questionText: 'Q1',
        type:         'single_choice',
        options:      [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }],
      }],
    },
  });
}

async function makeTestWithStatus(evaluator, status) {
  const test = await makeCompleteQCMTest(evaluator);
  await TechnicalTest.findByIdAndUpdate(test._id, { status });
  return TechnicalTest.findById(test._id);
}

async function addApplication(candidateId, jobId, status = 'Pending') {
  await User.findByIdAndUpdate(candidateId, {
    $push: { applications: { jobOffer: jobId, status, preSelected: true, appliedDate: new Date() } },
  });
}

// ════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/technical-tests/:id/status (US-51)', () => {

  test('200 — évaluateur propriétaire active un test DRAFT complet', async () => {
    const evaluator = await createUser({ role: 'technical evaluator' });
    const test      = await makeCompleteQCMTest(evaluator);

    const res = await request(app)
      .patch(`/api/technical-tests/${test._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(evaluator)}`)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  test('422 — activation d\'un test incomplet (sans question QCM)', async () => {
    const evaluator = await createUser({ role: 'technical evaluator' });
    const test      = await makeCompleteQCMTest(evaluator);
    await TechnicalTest.collection.updateOne(
      { _id: test._id },
      { $set: { 'qcm.questions': [] } }
    );

    const res = await request(app)
      .patch(`/api/technical-tests/${test._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(evaluator)}`)
      .send({ status: 'active' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/incomplet/i);
  });

  test('409 — désactivation avec des candidats en cours de passation', async () => {
    const evaluator = await createUser({ role: 'technical evaluator' });
    const test      = await makeTestWithStatus(evaluator, 'active');
    await TestSubmission.create({
      candidate:     new mongoose.Types.ObjectId(),
      job:           new mongoose.Types.ObjectId(),
      testKind:      'technical',
      technicalTest: test._id,
      status:        'submitted',
    });

    const res = await request(app)
      .patch(`/api/technical-tests/${test._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(evaluator)}`)
      .send({ status: 'inactive' });

    expect(res.status).toBe(409);
    const unchanged = await TechnicalTest.findById(test._id);
    expect(unchanged.status).toBe('active');
  });

  test('200 — désactivation sans passation en cours', async () => {
    const evaluator = await createUser({ role: 'technical evaluator' });
    const test      = await makeTestWithStatus(evaluator, 'active');

    const res = await request(app)
      .patch(`/api/technical-tests/${test._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(evaluator)}`)
      .send({ status: 'inactive' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });

  test('422 — transition interdite (ex. DRAFT → INACTIVE)', async () => {
    const evaluator = await createUser({ role: 'technical evaluator' });
    const test      = await makeCompleteQCMTest(evaluator);

    const res = await request(app)
      .patch(`/api/technical-tests/${test._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(evaluator)}`)
      .send({ status: 'inactive' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not allowed/i);
  });

  test('403 — rôle candidat non autorisé sur l\'endpoint de statut', async () => {
    const evaluator = await createUser({ role: 'technical evaluator' });
    const candidate = await createUser({ role: 'candidate' });
    const test      = await makeCompleteQCMTest(evaluator);

    const res = await request(app)
      .patch(`/api/technical-tests/${test._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)
      .send({ status: 'active' });

    expect(res.status).toBe(403);
  });

  test('401 — sans authentification', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`/api/technical-tests/${fakeId}/status`)
      .send({ status: 'active' });

    expect(res.status).toBe(401);
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/candidates/:id/application/:jobId/status — acceptation/refus (US-58)', () => {

  test('200 — acceptation d\'un candidat + statut persisté + notification envoyée', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await JobOffer.create({ title: 'Offre Sprint3', status: 'open', createdBy: rh._id });
    await addApplication(candidate._id, job._id);

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ status: 'Accepted' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Accepted');

    const saved        = await User.findById(candidate._id);
    const savedApp     = saved.applications.find(a => a.jobOffer?.toString() === job._id.toString());
    expect(savedApp.status).toBe('Accepted');

    const notif = await Notification.findOne({ userId: candidate._id, type: 'application_status_changed' });
    expect(notif).not.toBeNull();
  });

  test('200 — refus d\'un candidat + statut REJECTED persisté + notification envoyée', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await JobOffer.create({ title: 'Offre Sprint3 B', status: 'open', createdBy: rh._id });
    await addApplication(candidate._id, job._id);

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ status: 'Rejected' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Rejected');

    const notif = await Notification.findOne({ userId: candidate._id, type: 'application_status_changed' });
    expect(notif).not.toBeNull();
  });

  test('200 — statut visible côté candidat après décision RH', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await JobOffer.create({ title: 'Offre Sprint3 C', status: 'open', createdBy: rh._id });
    await addApplication(candidate._id, job._id);

    await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ status: 'Accepted' });

    const profileRes = await request(app)
      .get('/api/candidates/profile')
      .set('Authorization', `Bearer ${tokenFor(candidate)}`);

    expect(profileRes.status).toBe(200);
    const appInProfile = profileRes.body.applications
      .find(a => a.jobOffer?._id?.toString() === job._id.toString()
              || a.jobOffer?.toString()       === job._id.toString());
    expect(appInProfile.status).toBe('Accepted');
  });

  test('409 — double décision sur une candidature déjà finalisée (Accepted)', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await JobOffer.create({ title: 'Offre Sprint3 D', status: 'open', createdBy: rh._id });
    await addApplication(candidate._id, job._id, 'Accepted');

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ status: 'Rejected' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/finalized/i);
  });

  test('409 — double décision sur une candidature déjà finalisée (Rejected)', async () => {
    const rh        = await createUser({ role: 'rh' });
    const candidate = await createUser({ role: 'candidate' });
    const job       = await JobOffer.create({ title: 'Offre Sprint3 E', status: 'open', createdBy: rh._id });
    await addApplication(candidate._id, job._id, 'Rejected');

    const res = await request(app)
      .patch(`/api/candidates/${candidate._id}/application/${job._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(rh)}`)
      .send({ status: 'Accepted' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/finalized/i);
  });

});
