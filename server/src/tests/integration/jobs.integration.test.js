'use strict';
/**
 * Tests d'intégration — POST /api/jobs
 * Vérifie la création d'offres via HTTP avec authentification JWT réelle.
 */

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app     = require('../../src/app');
const JobOffer = require('../../src/models/jobOffer.model');
const { createUser, tokenFor } = require('../helpers/auth.helper');

jest.mock('../../src/services/hf.service', () => ({
  encodeJobSkills:        jest.fn().mockResolvedValue(null),
  extractCVFromPDFBuffer: jest.fn(),
  matchCVToJobs:          jest.fn(),
}));

// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/jobs', () => {

  test('201 — RH crée une offre valide', async () => {
    const rh    = await createUser({ role: 'rh' });
    const token = tokenFor(rh);

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Développeur Full-Stack', department: 'Engineering' });

    expect(res.status).toBe(201);
    expect(res.body.job.title).toBe('Développeur Full-Stack');
    expect(res.body.job.status).toBe('draft');
  });

  test('201 — Admin crée une offre valide', async () => {
    const admin = await createUser({ role: 'admin' });
    const token = tokenFor(admin);

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Administrateur Système' });

    expect(res.status).toBe(201);
    expect(res.body.job._id).toBeDefined();
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ title: 'Offre sans auth' });

    expect(res.status).toBe(401);
  });

  test('403 — candidat non autorisé', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const token     = tokenFor(candidate);

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tentative candidat' });

    expect(res.status).toBe(403);
  });

  test('422 — titre manquant → validation échoue', async () => {
    const rh    = await createUser({ role: 'rh' });
    const token = tokenFor(rh);

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ department: 'Engineering' });

    expect(res.status).toBe(422);
  });

  test('Offre persistée et récupérable via GET /:id', async () => {
    const rh    = await createUser({ role: 'rh' });
    const token = tokenFor(rh);

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Ingénieur DevOps' });

    expect(createRes.status).toBe(201);
    const id = createRes.body.job._id;

    const getRes = await request(app).get(`/api/jobs/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.title).toBe('Ingénieur DevOps');

    const inDb = await JobOffer.findById(id);
    expect(inDb).not.toBeNull();
    expect(inDb.title).toBe('Ingénieur DevOps');
  });

});
