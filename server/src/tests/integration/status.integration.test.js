'use strict';
/**
 * Tests d'intégration — PATCH /api/jobs/:id/status
 * Vérifie la machine à états des offres via HTTP avec authentification JWT.
 */

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../../src/app');
const JobOffer = require('../../src/models/jobOffer.model');
const { createUser, tokenFor } = require('../helpers/auth.helper');

jest.mock('../../src/services/hf.service', () => ({
  encodeJobSkills:        jest.fn().mockResolvedValue(null),
  extractCVFromPDFBuffer: jest.fn(),
  matchCVToJobs:          jest.fn(),
}));

async function makeJob(status = 'draft') {
  return JobOffer.create({
    title: 'Offre test',
    status,
    createdBy: new mongoose.Types.ObjectId(),
  });
}

// ════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/jobs/:id/status', () => {

  let rhToken;

  beforeEach(async () => {
    const rh = await createUser({ role: 'rh' });
    rhToken  = tokenFor(rh);
  });

  // ── Transitions autorisées ────────────────────────────────────────────────

  test('DRAFT → OPEN : 200 + statut mis à jour', async () => {
    const job = await makeJob('draft');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'open' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    const saved = await JobOffer.findById(job._id);
    expect(saved.status).toBe('open');
  });

  test('OPEN → PAUSED : 200 + statut mis à jour', async () => {
    const job = await makeJob('open');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
  });

  test('PAUSED → OPEN : 200 + réactivation', async () => {
    const job = await makeJob('paused');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'open' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
  });

  test('OPEN → CLOSED : 200 + statut persisté', async () => {
    const job = await makeJob('open');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'closed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  test('PAUSED → CLOSED : 200 + statut persisté', async () => {
    const job = await makeJob('paused');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'closed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  // ── Transitions interdites ────────────────────────────────────────────────

  const FORBIDDEN = [
    ['draft',  'paused'],
    ['draft',  'closed'],
    ['open',   'draft'],
    ['closed', 'open'],
    ['closed', 'paused'],
    ['closed', 'draft'],
  ];

  test.each(FORBIDDEN)(
    '%s → %s : 422 transition refusée',
    async (from, to) => {
      const job = await makeJob(from);
      const res = await request(app)
        .patch(`/api/jobs/${job._id}/status`)
        .set('Authorization', `Bearer ${rhToken}`)
        .send({ status: to });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/not allowed/i);

      const unchanged = await JobOffer.findById(job._id);
      expect(unchanged.status).toBe(from);
    }
  );

  // ── Sécurité / erreurs ────────────────────────────────────────────────────

  test('401 — sans token', async () => {
    const job = await makeJob('draft');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .send({ status: 'open' });

    expect(res.status).toBe(401);
  });

  test('403 — candidat non autorisé', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const token     = tokenFor(candidate);
    const job       = await makeJob('draft');

    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'open' });

    expect(res.status).toBe(403);
  });

  test('400 — ID invalide', async () => {
    const res = await request(app)
      .patch('/api/jobs/not-an-id/status')
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'open' });

    expect(res.status).toBe(400);
  });

  test('404 — job introuvable', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .patch(`/api/jobs/${fakeId}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'open' });

    expect(res.status).toBe(404);
  });

  test('400 — body sans statut', async () => {
    const job = await makeJob('draft');
    const res = await request(app)
      .patch(`/api/jobs/${job._id}/status`)
      .set('Authorization', `Bearer ${rhToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

});
