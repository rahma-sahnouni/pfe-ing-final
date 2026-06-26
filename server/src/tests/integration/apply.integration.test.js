'use strict';
/**
 * Tests d'intégration — POST /api/candidates/:id/apply
 * Vérifie la soumission de candidature (avec mock du service ML).
 */

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.JWT_ACCESS_SECRET  = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const path     = require('node:path');
const fs       = require('node:fs');
const os       = require('node:os');
const mongoose = require('mongoose');
const request  = require('supertest');

const app      = require('../../src/app');
const JobOffer = require('../../src/models/jobOffer.model');
const User     = require('../../src/models/user.model');
const { createUser, tokenFor } = require('../helpers/auth.helper');

// ── Mock du service ML (évite les appels Python FastAPI) ─────────────────────
jest.mock('../../src/services/hf.service', () => ({
  encodeJobSkills:        jest.fn().mockResolvedValue(null),
  extractCVFromPDFBuffer: jest.fn().mockResolvedValue({
    name:            'Alice Dupont',
    skills:          ['JavaScript', 'Node.js'],
    yearsExperience: 3,
    phone:           null,
    location:        null,
    _embedding:      null,
    cvRawText:       'Alice Dupont Node.js developer',
  }),
  matchCVToJobs: jest.fn().mockResolvedValue([{
    score:            72,
    matchedSkills:    ['JavaScript'],
    missingSkills:    [],
    blockedByPrereqs: false,
    prereqDetails:    [],
    semanticScore:    0.8,
    experienceScore:  0.7,
    levelScore:       0.9,
    recommendation:   'good match',
    analysis:         '',
  }]),
}));

// ── PDF minimal valide pour multer ───────────────────────────────────────────
let fakePdfPath;
beforeAll(() => {
  fakePdfPath = path.join(os.tmpdir(), 'test_cv.pdf');
  fs.writeFileSync(fakePdfPath, Buffer.from('%PDF-1.4 fake content'));
});

afterAll(() => {
  try { fs.unlinkSync(fakePdfPath); } catch { /* noop */ }
});

// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/candidates/:id/apply', () => {

  async function makeOpenJob() {
    return JobOffer.create({
      title:     'Offre test apply',
      status:    'open',
      createdBy: new mongoose.Types.ObjectId(),
    });
  }

  test('401 — sans token', async () => {
    const job = await makeOpenJob();
    const res = await request(app)
      .post(`/api/candidates/${job._id}/apply`)
      .send();

    expect(res.status).toBe(401);
  });

  test('400 — sans fichier CV', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const token     = tokenFor(candidate);
    const job       = await makeOpenJob();

    const res = await request(app)
      .post(`/api/candidates/${job._id}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
  });

  test('400 — offre clôturée', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const token     = tokenFor(candidate);
    const job = await JobOffer.create({
      title:     'Offre fermée',
      status:    'closed',
      createdBy: new mongoose.Types.ObjectId(),
    });

    const res = await request(app)
      .post(`/api/candidates/${job._id}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .attach('cv', fakePdfPath);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not open/i);
  });

  test('409 — double candidature', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const token     = tokenFor(candidate);
    const job       = await makeOpenJob();

    // Insérer une candidature directement en base pour simuler l'existant
    await User.findByIdAndUpdate(candidate._id, {
      $push: { applications: { jobOffer: job._id, status: 'Pending', appliedDate: new Date() } },
    });

    const res = await request(app)
      .post(`/api/candidates/${job._id}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .attach('cv', fakePdfPath);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already applied/i);
  });

  test('200 — candidature nominale (PDF + ML mockés)', async () => {
    const candidate = await createUser({ role: 'candidate' });
    const token     = tokenFor(candidate);
    const job       = await makeOpenJob();

    const res = await request(app)
      .post(`/api/candidates/${job._id}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .attach('cv', fakePdfPath);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/submitted/i);
    expect(res.body.jobId.toString()).toBe(job._id.toString());

    // Vérifier la persistance en base
    const updated = await User.findById(candidate._id);
    const app_ = updated.applications.find(a => a.jobOffer.toString() === job._id.toString());
    expect(app_).toBeDefined();
    expect(app_.status).toBe('Pending');
  });

});
