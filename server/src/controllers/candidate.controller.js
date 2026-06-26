'use strict';

/**
 * candidate.controller.js — Logique métier candidat
 * ==================================================
 * Gère toutes les opérations liées aux candidats :
 *   - Profil (lecture, mise à jour)
 *   - Upload et extraction CV (via hf.service → FastAPI → phi4)
 *   - Candidature à une offre (applyWithCV)
 *   - Recommandations de jobs (matching IA)
 *   - Gestion des tests RH et techniques
 *   - Suivi du parcours candidat (journey)
 *   - Décisions RH (présélection, approbation tests, statuts)
 */

const mongoose        = require('mongoose');
const { isValidObjectId } = mongoose;
const fs              = require('node:fs');
const crypto          = require('node:crypto');
const pdfParse        = require('pdf-parse');

// ── Modèles Mongoose ──────────────────────────────────────────────────────────
const User            = require('../models/user.model');
const JobOffer        = require('../models/jobOffer.model');
const TestRh          = require('../models/testRh.model');
const TechnicalTest   = require('../models/technical-test.model');
const TestSubmission  = require('../models/testSubmission.model');
const Notification    = require('../models/notification.model');
const InterviewSession = require('../models/interviewSession.model');
const { getIO }       = require('../utils/socket');

// ── Service IA ────────────────────────────────────────────────────────────────
const {
  extractCVFromPDFBuffer,
  matchCVToJobs,
  encodeJobSkills,
  scoreSkillsForJob,
  scoreFromExtractData,
} = require('../services/hf.service');

// ── Logger coloré ─────────────────────────────────────────────────────────────
const log = { // NOSONAR
  info:    (...a) => console.log  ('\x1b[36m[candidate.ctrl]\x1b[0m', ...a), // NOSONAR
  success: (...a) => console.log  ('\x1b[32m[candidate.ctrl]\x1b[0m', ...a), // NOSONAR
  warn:    (...a) => console.warn ('\x1b[33m[candidate.ctrl]\x1b[0m', ...a), // NOSONAR
  error:   (...a) => console.error('\x1b[31m[candidate.ctrl]\x1b[0m', ...a), // NOSONAR
  section: (t)   => console.log  ('\x1b[35m[candidate.ctrl]\x1b[0m ──', t, '──'), // NOSONAR
};

// ── Constantes ────────────────────────────────────────────────────────────────

/** Champs sensibles exclus de toutes les réponses API (jamais exposés au client). */
const SAFE_SELECT = '-password -refreshTokens -loginAttempts -lockUntil -passwordChangedAt -cvRawText';

/** Nombre maximum de jobs analysés par la recommandation. */
const MAX_JOBS_PER_RECOMMENDATION = 50;

/**
 * Cache mémoire pour les recommandations de jobs.
 * Structure : Map<userId, {data, expiresAt}>
 * TTL : 5 minutes (évite de re-scorer si l'utilisateur recharge la page)
 */
const _recCache   = new Map();
const _REC_TTL_MS = 5 * 60 * 1000;


// ═════════════════════════════════════════════════════════════════════════════
// UTILITAIRES INTERNES
// ═════════════════════════════════════════════════════════════════════════════

/** Valide qu'un ID est un ObjectId MongoDB valide. */
function _validateId(id) {
  return typeof id === 'string' && isValidObjectId(id);
}

/**
 * Crée et émet une notification temps réel via Socket.IO.
 * Si Socket.IO n'est pas initialisé, log un warning sans crasher.
 */
async function _notify(userId, type, message, jobId) {
  try {
    const notif = await Notification.create({ userId, type, message, jobId, read: false });
    try {
      getIO().to(`user:${userId}`).emit('notification', notif);
    } catch { /* Socket.IO peut ne pas être initialisé en test */ }
    log.info(`Notification → user ${userId}: "${message.slice(0, 60)}..."`);
  } catch (err) {
    log.warn(`Notification failed: ${err.message}`);
  }
}

/** Parse un JSON stringifié de manière sécurisée (retourne la valeur brute si échec). */
function _safeParseJson(val) {
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

/**
 * Valide qu'un fichier PDF est bien présent et au bon format MIME.
 * Lance une erreur avec status HTTP si invalide.
 */
function _assertPDF(file) {
  if (!file) throw Object.assign(new Error('No file uploaded.'), { status: 400 });
  const allowed = ['application/pdf', 'application/x-pdf'];
  if (!allowed.includes(file.mimetype) || !file.originalname?.toLowerCase().endsWith('.pdf')) {
    throw Object.assign(new Error('Only PDF files are accepted.'), { status: 415 });
  }
}

/**
 * Calcule l'étape courante du pipeline de recrutement pour un candidat.
 * Utilisé par getJourney pour afficher la progression.
 *
 * Étapes :
 *   1 → Candidature soumise (pas encore présélectionné)
 *   2 → Tests RH assignés (en cours)
 *   3 → Tests techniques assignés (en cours) ou tests RH terminés
 *   4 → En revue (tous tests validés, attente décision RH)
 *   5 → Entretien RH planifié
 *   6 → Entretien technique planifié
 *   7 → Décision finale (Accepted ou Rejected)
 */
function _computeCurrentStage(status, preSelected, rhTests, techTests, submittedRhIds, submittedTechIds) {
  if (['Accepted', 'Rejected'].includes(status)) return 7;
  if (status === 'Tech Interview')               return 6;
  if (status === 'RH Interview')                 return 5;
  if (status === 'In Review')                    return 4;
  if (!preSelected)                              return 1;

  const hasRh    = rhTests.length   > 0;
  const hasTech  = techTests.length > 0;
  const rhDone   = hasRh   && rhTests.every(t   => submittedRhIds.includes(String(t._id)));
  const techDone = hasTech && techTests.every(t  => submittedTechIds.includes(String(t._id)));

  if (hasRh   && !rhDone)   return 2;
  if (hasTech && !techDone) return 3;
  if (rhDone  || techDone)  return 3;
  return 2;
}

/**
 * Auto-remplit les champs profil manquants depuis les données extraites du CV.
 * Ne remplace jamais une valeur déjà présente.
 */
function _buildProfilePatch(candidate, extracted, patch) {
  if (!candidate) return;
  if (!candidate.name     && extracted.name)     patch.name     = extracted.name;
  if (!candidate.phone    && extracted.phone)    patch.phone    = extracted.phone;
  if (!candidate.location && extracted.location) patch.location = extracted.location;
}


// ═════════════════════════════════════════════════════════════════════════════
// PROFIL CANDIDAT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/candidate/profile
 * Retourne le profil complet du candidat avec ses candidatures.
 */
exports.getCandidateProfile = async (req, res, next) => {
  log.section('GET CANDIDATE PROFILE');
  log.info(`User: ${req.user._id}`);
  try {
    const candidate = await User
      .findById(req.user._id)
      .select(SAFE_SELECT)
      .populate('applications.jobOffer', 'title department status');
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });
    log.success(`Profile loaded: ${candidate.name || candidate.email}`);
    res.json(candidate);
  } catch (err) { next(err); }
};

/**
 * PUT /api/candidate/profile
 * Met à jour les champs autorisés du profil candidat.
 * Seuls les champs de la liste ALLOWED peuvent être modifiés (whitelist).
 */
exports.updateCandidateProfile = async (req, res, next) => {
  log.section('UPDATE CANDIDATE PROFILE');
  log.info(`User: ${req.user._id} | Fields: ${Object.keys(req.body).join(', ')}`);
  try {
    const ALLOWED = ['name', 'phone', 'location', 'experience', 'avatarColor'];
    const update  = {};
    ALLOWED.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

    const updated = await User
      .findByIdAndUpdate(req.user._id, update, { new: true, runValidators: false })
      .select(SAFE_SELECT);
    if (!updated) return res.status(404).json({ message: 'Candidate not found.' });
    log.success(`Profile updated for ${updated.name || updated.email}`);
    res.json(updated);
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// UPLOAD ET EXTRACTION CV
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/candidate/cv
 * Upload un PDF, l'envoie à FastAPI pour extraction phi4, sauvegarde en MongoDB.
 * Auto-remplit le profil si les champs name/phone/location sont vides.
 */
exports.uploadAndExtractCV = async (req, res, next) => {
  log.section('UPLOAD & EXTRACT CV');
  const startTime = Date.now();

  try {
    log.info(`File received: ${req.file?.originalname} (${req.file?.size} bytes)`);
    try { _assertPDF(req.file); } catch (e) {
      log.error(`File validation failed: ${e.message}`);
      return res.status(e.status || 400).json({ message: e.message });
    }

    // Lecture du PDF en mémoire
    const pdfBuffer = await fs.promises.readFile(req.file.path);
    log.info(`PDF buffer loaded: ${pdfBuffer.length} bytes`);

    // Hash SHA-256 pour détecter les CV identiques (évite re-extraction inutile)
    const cvHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    // Extraction via FastAPI → phi4
    log.info('Envoi vers FastAPI → phi4...');
    let extracted;
    try {
      extracted = await extractCVFromPDFBuffer(pdfBuffer);
    } catch (err) {
      log.error(`Extraction error: ${err.message}`);
      return res.status(422).json({ message: 'PDF appears to be empty or unreadable (OCR failed).' });
    }

    const { _embedding, cvRawText, ...extractedClean } = extracted;

    log.success('Extraction complete:');
    log.info(`  name      : ${extractedClean.name}`);
    log.info(`  email     : ${extractedClean.email}`);
    log.info(`  skills    : ${extractedClean.skills?.length} → [${(extractedClean.skills || []).slice(0, 5).join(', ')}]`);
    log.info(`  languages : ${extractedClean.languages?.length}`);
    log.info(`  yearsExp  : ${extractedClean.yearsExperience}`);
    log.info(`  rawText   : ${cvRawText?.length} chars`);

    // Payload de mise à jour MongoDB
    const cvPayload = {
      cv:          { path: req.file.path, originalName: req.file.originalname, uploadedAt: new Date() },
      cvExtracted: extractedClean,
      cvRawText:   cvRawText || '',
      cvEmbedding: _embedding || null,
      cvHash,
    };

    // Auto-remplissage profil si champs vides
    const candidate = await User.findById(req.user._id);
    if (candidate) {
      if (!candidate.name     && extracted.name)     { cvPayload.name     = extracted.name;     log.info(`Auto-fill name: ${extracted.name}`); }
      if (!candidate.phone    && extracted.phone)    { cvPayload.phone    = extracted.phone;    log.info(`Auto-fill phone: ${extracted.phone}`); }
      if (!candidate.location && extracted.location) { cvPayload.location = extracted.location; log.info(`Auto-fill location: ${extracted.location}`); }
    }

    // Sauvegarde MongoDB
    const updated = await User
      .findByIdAndUpdate(req.user._id, cvPayload, { new: true, runValidators: false })
      .select(SAFE_SELECT);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.success(`CV saved to MongoDB in ${elapsed}s total`);

    res.json({
      message:   'CV uploaded and analysed.',
      cv:        updated.cv,
      extracted: extractedClean,
      candidate: updated,
    });
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// RECOMMANDATIONS DE JOBS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/candidate/recommended-jobs
 * Calcule et retourne les jobs ouverts les mieux adaptés au CV du candidat.
 * Utilise /score-skills (bge-m3 uniquement, sans phi4) pour la rapidité.
 * Résultats mis en cache 5 minutes.
 */
exports.getRecommendedJobs = async (req, res, next) => {
  log.section('GET RECOMMENDED JOBS');
  const startTime = Date.now();

  try {
    const userId = String(req.user._id);

    // Vérification du cache
    const cached = _recCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      log.info('Cache hit — returning cached recommendations');
      return res.json(cached.data);
    }

    // Filtres optionnels (département, localisation)
    const filter = { status: 'open' };
    const ALLOWED_DEPARTMENTS = ['Engineering', 'Design', 'People', 'Marketing', 'Finance', 'Product', 'Security', 'Data'];
    if (req.query.department) {
      const safeDept = ALLOWED_DEPARTMENTS.find(d => d === req.query.department);
      if (safeDept) filter.department = safeDept;
    }
    if (req.query.location && typeof req.query.location === 'string') {
      const safeLocation = req.query.location.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`).slice(0, 100);
      filter.location = { $regex: safeLocation, $options: 'i' };
    }

    // Chargement candidat + jobs en parallèle
    const [candidate, jobs] = await Promise.all([
      User.findById(req.user._id).select('+cvRawText +cvEmbedding cvExtracted'),
      JobOffer.find(filter).select('+embedding').limit(MAX_JOBS_PER_RECOMMENDATION).lean(),
    ]);

    // Vérification CV disponible
    const hasCVData = candidate?.cvRawText
      || candidate?.cvExtracted?.skills?.length
      || candidate?.cvExtracted?.experience?.length;
    if (!hasCVData) {
      log.warn('No CV found for candidate');
      return res.status(400).json({ message: 'No CV found. Please upload your CV first.' });
    }

    if (!jobs.length) return res.json({ recommendations: [] });

    log.info(`CV disponible | ${jobs.length} jobs ouverts`);

    // Mapping du CV extrait vers le format attendu par scoreSkillsForJob
    const cvExtracted = candidate.cvExtracted || null;
    const cvMapped = {
      skills:          cvExtracted?.skills          || [],
      soft_skills:     [],
      cvRawText:       candidate.cvRawText           || '',
      rawExtracted:    cvExtracted                   || {},
      yearsExperience: cvExtracted?.yearsExperience  ?? 0,
    };

    // Scoring parallèle (bge-m3, pas phi4 → rapide)
    log.info('Scoring IA en parallèle (bge-m3 uniquement)...');
    const matchResults = await Promise.all(
      jobs.map(async (job, idx) => {
        try {
          const result = await scoreSkillsForJob(cvMapped, job);
          return { jobIndex: idx, ...result };
        } catch (err) {
          log.warn(`Recommandation job[${idx}] failed: ${err.message}`);
          return null;
        }
      })
    );
    const matches = matchResults.filter(Boolean);

    if (!matches.length) {
      return res.status(503).json({ message: 'AI matching service unavailable.' });
    }

    // Construction et tri des recommandations (meilleur score en premier)
    const recommendations = matches
      .filter(m => jobs[m.jobIndex])
      .map(m => ({
        job:              jobs[m.jobIndex],
        score:            m.score,
        matchedSkills:    m.matchedSkills,
        missingSkills:    m.missingSkills,
        blockedByPrereqs: m.blockedByPrereqs,
        prereqDetails:    m.prereqDetails,
        semanticScore:    m.semanticScore,
        experienceScore:  m.experienceScore,
        levelScore:       m.levelScore,
        recommendation:   m.recommendation,
        analysis:         m.analysis,
      }))
      .sort((a, b) => b.score - a.score);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.success(`Matching terminé en ${elapsed}s:`);
    recommendations.slice(0, 5).forEach((r, i) => {
      log.info(`  ${i + 1}. "${r.job.title}" → ${r.score}% (${r.recommendation})`);
    });

    const payload = { recommendations };
    _recCache.set(userId, { data: payload, expiresAt: Date.now() + _REC_TTL_MS });
    res.json(payload);
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// CANDIDATURE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/candidate/apply/:id
 * Soumet une candidature à une offre d'emploi avec un PDF.
 *
 * Optimisation clé : si le candidat soumet le même PDF qu'un upload précédent
 * (détection par hash SHA-256), l'extraction phi4 est ignorée et les données
 * existantes sont réutilisées → gain de 5-10 minutes.
 *
 * Calcul du score IA :
 *   1. scoreFromExtractData() si l'extraction phi4 vient juste d'être faite
 *   2. scoreSkillsForJob() sinon (bge-m3 sur données existantes)
 */
exports.applyWithCV = async (req, res, next) => {
  log.section('APPLY WITH CV');
  const startTime = Date.now();

  try {
    log.info(`User: ${req.user._id} | Job: ${req.params.id}`);

    // Validation du fichier et de l'ID job
    try { _assertPDF(req.file); } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }
    if (!_validateId(req.params.id)) return res.status(400).json({ message: 'Invalid job ID.' });

    const safeJobId = new mongoose.Types.ObjectId(req.params.id);
    const job = await JobOffer.findById(safeJobId).select('+embedding');
    if (!job)                    return res.status(404).json({ message: 'Job not found.' });
    if (job.status !== 'open')  return res.status(400).json({ message: 'This job offer is not open.' });
    log.info(`Job: "${job.title}" (${job.department})`);

    // Vérification candidature déjà existante
    const alreadyApplied = await User.exists({
      _id: req.user._id,
      'applications.jobOffer': job._id,
    });
    if (alreadyApplied) {
      log.warn('Candidate already applied to this job');
      return res.status(409).json({ message: 'You have already applied to this job.' });
    }

    // Lecture du PDF et calcul du hash
    const candidate  = await User.findById(req.user._id).select('+cvRawText +cvHash cvExtracted name phone location');
    const pdfBuffer  = await fs.promises.readFile(req.file.path);
    const uploadHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    // Détection même CV (hash identique + extraction déjà présente)
    const sameCV = candidate?.cvHash
      && candidate.cvHash === uploadHash
      && (candidate.cvExtracted?.skills?.length ?? 0) > 0;

    let extracted, cvPayload;

    if (sameCV) {
      // ── Optimisation : réutilisation des données existantes
      log.info('Même CV détecté — réutilisation de l\'extraction existante (phi4 ignoré)');
      const cvExt      = candidate.cvExtracted;
      const totalMonths = Math.round((cvExt.yearsExperience || 0) * 12);
      extracted = {
        skills:          cvExt.skills    || [],
        soft_skills:     [],
        cvRawText:       candidate.cvRawText || '',
        yearsExperience: cvExt.yearsExperience ?? 0,
        _embedding:      null,
        rawExtracted: {
          hard_skills:    cvExt.skills          || [],
          soft_skills:    [],
          languages:      (cvExt.languages    || []).map(l => ({ langue: l.name || '', niveau: l.level || '' })),
          all_diplomas:   (cvExt.education    || []).map(e => ({ titre: e.degree || '', annee: e.year || '' })),
          certifications: cvExt.certifications || [],
          experience:     { total_months: totalMonths, positions: [] },
        },
      };
      cvPayload = {
        cv: { path: req.file.path, originalName: req.file.originalname, uploadedAt: new Date() },
      };
    } else {
      // ── Nouveau CV : extraction complète phi4 avec contexte du job
      log.info('Nouveau CV — extraction phi4 avec contexte job...');
      try {
        extracted = await extractCVFromPDFBuffer(pdfBuffer, job);
      } catch (err) {
        log.error(`Extraction error: ${err.message}`);
        return res.status(422).json({ message: 'PDF appears to be empty or unreadable.' });
      }
      const { _embedding: cvEmbedding, cvRawText } = extracted;
      const extractedCleanNew = (({ _embedding, cvRawText: _r, rawExtracted: _e, ...rest }) => rest)(extracted);
      cvPayload = {
        cv:          { path: req.file.path, originalName: req.file.originalname, uploadedAt: new Date() },
        cvExtracted: { ...extractedCleanNew, yearsExperience: extracted.yearsExperience || 0 },
        cvRawText:   cvRawText || '',
        cvEmbedding: cvEmbedding || null,
        cvHash:      uploadHash,
      };
    }

    log.info(`CV prêt: ${extracted.skills?.length ?? 0} skills, ${extracted.yearsExperience ?? 0} years exp`);

    // Calcul du score IA
    let aiScore = null, aiReport = null;
    try {
      // Priorité 1 : données déjà dans _scoreData (si phi4 vient d'être appelé avec contexte job)
      const result = scoreFromExtractData(extracted, job) ?? await scoreSkillsForJob(extracted, job);
      aiScore  = result.score;
      aiReport = {
        matchedSkills:    result.matchedSkills,
        missingSkills:    result.missingSkills,
        blockedByPrereqs: result.blockedByPrereqs,
        prereqDetails:    result.prereqDetails,
        semanticScore:    result.semanticScore,
        experienceScore:  result.experienceScore,
        levelScore:       result.levelScore,
        recommendation:   result.recommendation,
        analysis:         result.analysis,
        scoreBreakdown:   result.scoreBreakdown ?? null,
      };
      log.success(`Score IA: ${aiScore}% (${result.recommendation})`);
    } catch (aiErr) {
      log.warn(`AI scoring failed: ${aiErr.message}`);
    }

    // Auto-remplissage profil
    const profilePatch = {};
    _buildProfilePatch(candidate, extracted, profilePatch);

    // Construction de la candidature
    const newApp = {
      jobOffer:       job._id,
      appliedDate:    new Date(),
      status:         'Pending',
      aiMatchScore:   aiScore,
      matchedSkills:  aiReport?.matchedSkills   ?? [],
      missingSkills:  aiReport?.missingSkills   ?? [],
      recommendation: aiReport?.recommendation  ?? null,
      scoreBreakdown: aiReport?.scoreBreakdown  ?? null,
      prereqDetails:  aiReport?.prereqDetails   ?? [],
    };

    // Sauvegarde atomique (CV + profil + candidature en un seul appel MongoDB)
    await User.findByIdAndUpdate(
      req.user._id,
      { ...cvPayload, ...profilePatch, $push: { applications: newApp } },
      { runValidators: false },
    );
    await JobOffer.findByIdAndUpdate(job._id, { $inc: { applicationsCount: 1 } });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.success(`Candidature soumise en ${elapsed}s | aiScore=${aiScore}%`);

    // Nettoyage des champs internes avant réponse
    const { _embedding: _emb, cvRawText: _raw, rawExtracted: _re, soft_skills: _ss, ...extractedForRes } = extracted;
    res.status(200).json({
      message:   'Application submitted successfully.',
      jobId:     job._id,
      aiScore,
      aiReport,
      extracted: extractedForRes,
    });
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// VUE RH — CANDIDATS PAR JOB
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/candidate/by-job/:jobId
 * Retourne tous les candidats ayant postulé à un job, avec leurs scores IA.
 * Vue destinée au responsable RH.
 */
exports.getCandidatesByJob = async (req, res, next) => {
  log.section('GET CANDIDATES BY JOB');
  log.info(`Job ID: ${req.params.jobId}`);
  try {
    const { jobId } = req.params;
    const candidates = await User
      .find({ 'applications.jobOffer': jobId, role: 'candidate' })
      .select(SAFE_SELECT)
      .lean();

    log.info(`${candidates.length} candidats trouvés`);

    const result = candidates.map(c => {
      const app = c.applications.find(a => a.jobOffer.toString() === jobId);
      return {
        _id:               c._id,
        name:              c.name || c.email,
        email:             c.email,
        phone:             c.phone,
        location:          c.location,
        experience:        c.experience,
        score:             c.score,
        aiMatchScore:      app?.aiMatchScore   ?? null,
        matchedSkills:     app?.matchedSkills  ?? [],
        missingSkills:     app?.missingSkills  ?? [],
        recommendation:    app?.recommendation ?? null,
        scoreBreakdown:    app?.scoreBreakdown ?? null,
        prereqDetails:     app?.prereqDetails  ?? [],
        preSelected:       app?.preSelected    ?? false,
        avatarColor:       c.avatarColor,
        cv:                c.cv,
        cvExtracted:       c.cvExtracted,
        applicationStatus: app?.status         || 'Pending',
        appliedDate:       app?.appliedDate,
        rhApproved:        app?.rhApproved     ?? 'pending',
        techStatus:        app?.techStatus     ?? 'pending',
        interviews:        app?.interviews     ?? { rh: null, tech: null },
      };
    });

    res.json({ candidates: result });
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// PRÉSÉLECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/candidate/:candidateId/job/:jobId/preselect
 * Présélectionne ou dé-sélectionne un candidat.
 * Seul le propriétaire de l'offre ou un admin peut présélectionner.
 * Envoie une notification au candidat si présélectionné.
 */
exports.preSelectCandidate = async (req, res, next) => {
  log.section('PRE-SELECT CANDIDATE');
  try {
    const { candidateId, jobId } = req.params;
    const { preSelected }        = req.body;
    log.info(`Candidate: ${candidateId} | Job: ${jobId} | preSelected: ${preSelected}`);

    if (typeof preSelected !== 'boolean') {
      return res.status(400).json({ message: 'preSelected must be a boolean.' });
    }

    // Vérification des droits (propriétaire du job ou admin)
    if (req.user.role !== 'admin') {
      const job = await JobOffer.findById(jobId).select('createdBy');
      if (!job) return res.status(404).json({ message: 'Job not found.' });
      if (String(job.createdBy) !== String(req.user._id)) {
        return res.status(403).json({ message: 'Access denied: you are not the owner of this job offer.' });
      }
    }

    const candidate = await User.findById(candidateId);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const app = candidate.applications.find(a => a.jobOffer?.toString() === jobId);
    if (!app) return res.status(404).json({ message: 'Application not found.' });

    if (['Accepted', 'Rejected'].includes(app.status)) {
      return res.status(409).json({ message: 'Cannot modify a finalized application.' });
    }

    // Mise à jour atomique native MongoDB (évite les validations Mongoose sur le sous-document)
    await User.collection.updateOne(
      {
        _id:                     new mongoose.Types.ObjectId(candidateId),
        'applications.jobOffer': new mongoose.Types.ObjectId(jobId),
      },
      { $set: { 'applications.$.preSelected': preSelected } },
    );

    // Notification si présélectionné
    if (preSelected) {
      const job = await JobOffer.findById(jobId).select('title');
      if (job) {
        await _notify(
          candidateId,
          'application_status_changed',
          `You have been pre-selected for "${job.title}"! Complete your tests to proceed.`,
          jobId,
        );
      }
    }

    log.success(`Candidate ${preSelected ? 'pre-selected' : 'unselected'}`);
    res.json({ message: `Candidate ${preSelected ? 'pre-selected' : 'unselected'}.`, preSelected });
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// TESTS (VUE CANDIDAT)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/candidate/my-tests
 * Retourne tous les tests assignés au candidat, regroupés par offre d'emploi.
 */
exports.getMyTests = async (req, res, next) => {
  try {
    const candidate = await User
      .findById(req.user._id)
      .populate({ path: 'applications.jobOffer', select: '_id title department status technicalTests' });
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const applications = candidate.applications || [];
    if (!applications.length) return res.json({ jobs: [] });

    const jobsData = await Promise.all(applications.map(async app => {
      if (!app.jobOffer?._id) return null;
      const { _id: jobId, title, department, status, technicalTests: jobTechRefs } = app.jobOffer;

      const [rhTests, submissions] = await Promise.all([
        TestRh.find({ job: jobId }).lean().catch(() => []),
        TestSubmission.find({ candidate: req.user._id, job: jobId }).lean().catch(() => []),
      ]);

      // Chargement des tests techniques dans l'ordre défini par le job
      let orderedTech = [];
      try {
        const techTestIds = (jobTechRefs || []).map(t => t.testId);
        const techTests   = await TechnicalTest.find({ _id: { $in: techTestIds } }).lean();
        orderedTech = (jobTechRefs || [])
          .map(ref => {
            const found = techTests.find(t => String(t._id) === String(ref.testId));
            if (!found) return null;
            // Parse les exemples JSON stockés en string
            if (found.problemSolving?.examples) {
              found.problemSolving.examples = found.problemSolving.examples.map(ex => ({
                ...ex,
                input:  _safeParseJson(ex.input),
                output: _safeParseJson(ex.output),
              }));
            }
            return { ...found, order: ref.order ?? 0 };
          })
          .filter(Boolean);
      } catch (e) {
        log.warn(`[getMyTests] technicalTests error: ${e.message}`);
      }

      const submittedRhIds   = submissions.filter(s => s.testKind === 'rh').map(s => String(s.rhTest));
      const submittedTechIds = submissions.filter(s => s.testKind === 'technical').map(s => String(s.technicalTest));

      return {
        jobOffer:          { _id: jobId, title, department, status },
        applicationStatus: app.status,
        appliedDate:       app.appliedDate,
        rhTests,
        technicalTests:    orderedTech,
        submissions,
        submittedRhIds,
        submittedTechIds,
      };
    }));

    res.json({ jobs: jobsData.filter(Boolean) });
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// PARCOURS CANDIDAT (JOURNEY)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/candidate/journey
 * Retourne le parcours complet du candidat pour toutes ses candidatures :
 * étape courante, tests, soumissions, scores, entretiens.
 */
exports.getJourney = async (req, res, next) => {
  try {
    const candidate = await User
      .findById(req.user._id)
      .select('+cvRawText cvExtracted score avatarColor applications cv')
      .populate({
        path:   'applications.jobOffer',
        select: '_id title department location contractType status technicalTests testAssignments testPeriod',
      });
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const applications = candidate.applications || [];
    if (!applications.length) return res.json({ journey: [] });

    const journeyItems = await Promise.all(applications.map(async app => {
      if (!app.jobOffer?._id) return null;
      const job   = app.jobOffer;
      const jobId = job._id;

      const [rhTests, submissions, interviewSessions] = await Promise.all([
        TestRh.find({ job: jobId }).select('_id name status themes').lean().catch(() => []),
        TestSubmission
          .find({ candidate: req.user._id, job: jobId })
          .select('_id testKind rhTest technicalTest score status scoreBreakdown submittedAt evaluatedAt')
          .lean()
          .catch(() => []),
        InterviewSession.find({ job: jobId })
          .select('stage candidateEvaluations')
          .lean()
          .catch(() => []),
      ]);

      // Tests techniques
      let technicalTests = [];
      try {
        const techTestIds = (job.technicalTests || []).map(t => t.testId);
        technicalTests = await TechnicalTest
          .find({ _id: { $in: techTestIds } })
          .select('_id title testType difficulty timeLimitMinutes tags')
          .lean();
      } catch (e) {
        log.warn(`[getJourney] technicalTests error: ${e.message}`);
      }

      const submittedRhIds   = submissions.filter(s => s.testKind === 'rh').map(s => String(s.rhTest));
      const submittedTechIds = submissions.filter(s => s.testKind === 'technical').map(s => String(s.technicalTest));

      const currentStage = _computeCurrentStage(
        app.status, app.preSelected, rhTests, technicalTests, submittedRhIds, submittedTechIds,
      );

      // Score moyen des tests évalués
      const evaluated = submissions.filter(s => s.status === 'evaluated' && s.score !== null);
      const avgScore  = evaluated.length
        ? Math.round(evaluated.reduce((acc, s) => acc + s.score, 0) / evaluated.length)
        : null;

      const interviews = app.interviews || {};

      // Recommandations des évaluateurs d'entretien
      const rhEval = interviewSessions.find(s => s.stage === 'rh')
        ?.candidateEvaluations?.find(e => String(e.candidate) === String(req.user._id));
      const techEval = interviewSessions.find(s => s.stage === 'technical evaluator')
        ?.candidateEvaluations?.find(e => String(e.candidate) === String(req.user._id));

      return {
        jobOffer: {
          _id: job._id, title: job.title, department: job.department,
          location: job.location, contractType: job.contractType, status: job.status,
        },
        testPeriod:        job.testPeriod        || { start: null, end: null },
        applicationStatus: app.status,
        appliedDate:       app.appliedDate,
        interviews: {
          rh:   { ...(interviews.rh   || {}), recommendation: rhEval?.recommendation   ?? null },
          tech: { ...(interviews.tech || {}), recommendation: techEval?.recommendation ?? null },
        },
        interview:         app.interview || interviews.rh || interviews.tech || null,
        currentStage,
        rhApproved:        app.rhApproved  ?? 'pending',
        techStatus:        app.techStatus  ?? 'pending',
        aiMatchScore:      app.aiMatchScore ?? null,
        preSelected:       app.preSelected  ?? false,
        overallTestScore:  avgScore,
        rhTests: rhTests.map(t => ({
          _id:        t._id,
          name:       t.name,
          status:     t.status,
          submitted:  submittedRhIds.includes(String(t._id)),
          submission: submissions.find(s => String(s.rhTest) === String(t._id)) || null,
        })),
        technicalTests: technicalTests.map(t => ({
          _id:        t._id,
          title:      t.title,
          testType:   t.testType,
          difficulty: t.difficulty,
          submitted:  submittedTechIds.includes(String(t._id)),
          submission: submissions.find(s => String(s.technicalTest) === String(t._id)) || null,
        })),
        submissions,
      };
    }));

    res.json({ journey: journeyItems.filter(Boolean) });
  } catch (err) { next(err); }
};


// ═════════════════════════════════════════════════════════════════════════════
// DÉCISIONS SUR LES TESTS
// ═════════════════════════════════════════════════════════════════════════════

/** Vérifie que le rôle de l'utilisateur lui permet de décider sur ce type de test. */
function _checkTestDecisionPermission(testKind, userRole) {
  if (testKind === 'rh'        && !['rh', 'admin'].includes(userRole))
    return 'Seul un RH peut traiter un test RH.';
  if (testKind === 'technical' && !['technical evaluator', 'admin'].includes(userRole))
    return 'Seul un technical evaluator peut traiter un test technique.';
  return null;
}

/** Vérifie les transitions d'état autorisées pour une décision de test. */
function _validateActionState(field, current, action) {
  if (action === 'approved' && current === 'approved') return 'Already approved.';
  if (action === 'rejected' && current === 'rejected') return 'Already rejected.';
  if (action === 'rejected' && current === 'approved') return 'Cannot reject after approval.';
  return null;
}

/**
 * Envoie une notification au candidat après une décision sur ses tests.
 * Si les deux tests sont approuvés → passe le statut à "In Review".
 */
async function _notifyTestDecision(application, action, testKind, candidateId, jobId) {
  if (action === 'approved'
      && application.rhApproved === 'approved'
      && application.techStatus === 'approved') {
    const alreadyAdvanced = ['RH Interview', 'Tech Interview', 'Accepted', 'Rejected'].includes(application.status);
    if (!alreadyAdvanced) {
      application.status = 'In Review';
      const job = await JobOffer.findById(jobId).select('title');
      await _notify(
        candidateId,
        'test_validation_complete',
        `Congratulations! Both your tests have been validated for "${job?.title || ''}". Your application is now under review.`,
        jobId,
      );
    }
  } else if (action === 'rejected') {
    const job = await JobOffer.findById(jobId).select('title');
    await _notify(
      candidateId,
      'test_rejected',
      `Your ${testKind === 'rh' ? 'RH' : 'technical'} test for "${job?.title || ''}" has been rejected.`,
      jobId,
    );
  }
}

/**
 * Handler générique pour approve/reject d'un test.
 * Utilisé par approveCandidateTest et rejectCandidateTest.
 */
async function _handleTestDecision(req, res, next, action) {
  try {
    const { candidateId, jobId } = req.params;
    const { testKind }           = req.body;
    const userRole               = req.user.role;

    log.section(`TEST DECISION: ${action.toUpperCase()}`);
    log.info(`Candidate: ${candidateId} | Job: ${jobId} | testKind: ${testKind}`);

    const permError = _checkTestDecisionPermission(testKind, userRole);
    if (permError) return res.status(403).json({ message: permError });

    const user = await User.findById(candidateId);
    if (!user) return res.status(404).json({ message: 'Candidat introuvable.' });

    const application = user.applications.find(a => a.jobOffer?.toString() === jobId);
    if (!application) return res.status(404).json({ message: 'Candidature introuvable.' });

    const field   = testKind === 'rh' ? 'rhApproved' : 'techStatus';
    const current = application[field];

    const stateErr = _validateActionState(field, current, action);
    if (stateErr) return res.status(400).json({ message: stateErr });

    await _notifyTestDecision(application, action, testKind, candidateId, jobId);

    // Mise à jour atomique native MongoDB
    await User.collection.updateOne(
      {
        _id:                     new mongoose.Types.ObjectId(candidateId),
        'applications.jobOffer': new mongoose.Types.ObjectId(jobId),
      },
      {
        $set: {
          [`applications.$.${field}`]: action,
          ...(application.status === 'In Review' && { 'applications.$.status': 'In Review' }),
        },
      },
    );

    log.success(`Test ${testKind} ${action} for candidate ${candidateId}`);
    res.json({
      message:    `Test ${testKind} ${action}.`,
      rhApproved: testKind === 'rh'        ? action : current,
      techStatus: testKind === 'technical' ? action : current,
      status:     application.status,
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/candidate/:candidateId/job/:jobId/approve-test
 * Approuve un test RH ou technique (rôle : rh ou technical evaluator).
 */
exports.approveCandidateTest = (req, res, next) => _handleTestDecision(req, res, next, 'approved');

/**
 * POST /api/candidate/:candidateId/job/:jobId/reject-test
 * Rejette un test RH ou technique.
 */
exports.rejectCandidateTest  = (req, res, next) => _handleTestDecision(req, res, next, 'rejected');


// ═════════════════════════════════════════════════════════════════════════════
// STATUT DE CANDIDATURE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/candidate/:candidateId/job/:jobId/status
 * Met à jour le statut d'une candidature et notifie le candidat.
 * Statuts possibles : Pending, In Review, RH Interview, Tech Interview, Accepted, Rejected.
 * Une candidature finalisée (Accepted/Rejected) ne peut plus être modifiée.
 */
exports.updateApplicationStatus = async (req, res, next) => {
  log.section('UPDATE APPLICATION STATUS');
  try {
    const { candidateId, jobId } = req.params;
    const { status, feedback }   = req.body;
    log.info(`Candidate: ${candidateId} | Job: ${jobId} | New status: ${status}`);

    const ALLOWED_STATUSES = ['Pending', 'In Review', 'RH Interview', 'Tech Interview', 'Accepted', 'Rejected'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const candidate = await User.findById(candidateId);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const app = candidate.applications.find(a => a.jobOffer?.toString() === jobId);
    if (!app) return res.status(404).json({ message: 'Application not found.' });

    if (['Accepted', 'Rejected'].includes(app.status)) {
      return res.status(409).json({ message: 'Cannot modify a finalized application.' });
    }

    const oldStatus = app.status;

    // Mise à jour atomique native MongoDB
    await User.collection.updateOne(
      {
        _id:                     new mongoose.Types.ObjectId(candidateId),
        'applications.jobOffer': new mongoose.Types.ObjectId(jobId),
      },
      { $set: { 'applications.$.status': status } },
    );

    log.success(`Status changed: ${oldStatus} → ${status}`);

    // Notification au candidat avec message contextualisé
    try {
      const job = await JobOffer.findById(jobId).select('title');
      if (job) {
        const msgMap = {
          'In Review':      `Your application for "${job.title}" is now under review.`,
          'RH Interview':   `You have been invited to an RH interview for "${job.title}".`,
          'Tech Interview': `You have been invited to a technical interview for "${job.title}".`,
          'Accepted':       `Congratulations! You have been accepted for "${job.title}".`,
          'Rejected':       `Your application for "${job.title}" was not successful this time.`,
        };
        const message = (msgMap[status] || `Your application status changed to ${status}.`)
          + (feedback ? ` Note: ${feedback}` : '');
        await _notify(candidateId, 'application_status_changed', message, jobId);
      }
    } catch (e) {
      log.error(`Notification error: ${e.message}`);
    }

    res.json({ message: 'Application status updated.', status });
  } catch (err) { next(err); }
};