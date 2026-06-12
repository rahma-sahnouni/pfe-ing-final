'use strict';

/**
 * candidate.controller.js — avec logs détaillés
 */

const fs            = require('fs');
const pdfParse      = require('pdf-parse');
const User          = require('../models/user.model');
const JobOffer      = require('../models/jobOffer.model');
const TestRh        = require('../models/testRh.model');
const TechnicalTest = require('../models/technical-test.model');
const TestSubmission = require('../models/testSubmission.model');
const Notification  = require('../models/notification.model');
const { getIO }     = require('../utils/socket');

const {
  extractCVFromPDFBuffer,
  matchCVToJobs,
  encodeJobSkills,
} = require('../services/hf.service');

// ── Logger ────────────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log  ('\x1b[36m[candidate.ctrl]\x1b[0m', ...a),
  success: (...a) => console.log  ('\x1b[32m[candidate.ctrl]\x1b[0m', ...a),
  warn:    (...a) => console.warn ('\x1b[33m[candidate.ctrl]\x1b[0m', ...a),
  error:   (...a) => console.error('\x1b[31m[candidate.ctrl]\x1b[0m', ...a),
  section: (t)   => console.log  ('\x1b[35m[candidate.ctrl]\x1b[0m ──', t, '──'),
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SAFE_SELECT = '-password -refreshTokens -loginAttempts -lockUntil -passwordChangedAt -cvRawText';
const MAX_JOBS_PER_RECOMMENDATION = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _notify(userId, type, message, jobId) {
  try {
    const notif = await Notification.create({ userId, type, message, jobId, read: false });
    try { getIO().to(`user:${userId}`).emit('notification', notif); } catch (_) {}
    log.info(`Notification sent to user ${userId}: "${message.slice(0, 60)}..."`);
  } catch (err) {
    log.warn(`Notification failed: ${err.message}`);
  }
}

function _safeParseJson(val) {
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

function _assertPDF(file) {
  if (!file) throw Object.assign(new Error('No file uploaded.'), { status: 400 });
  const allowed = ['application/pdf', 'application/x-pdf'];
  if (!allowed.includes(file.mimetype) && !file.originalname?.toLowerCase().endsWith('.pdf')) {
    throw Object.assign(new Error('Only PDF files are accepted.'), { status: 415 });
  }
}

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

// ── Controllers ───────────────────────────────────────────────────────────────

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

exports.updateCandidateProfile = async (req, res, next) => {
  log.section('UPDATE CANDIDATE PROFILE');
  log.info(`User: ${req.user._id} | Fields: ${Object.keys(req.body).join(', ')}`);
  try {
    const ALLOWED = ['name', 'phone', 'location', 'experience', 'avatarColor'];
    const update  = {};
    ALLOWED.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    log.info(`Applying update: ${JSON.stringify(update)}`);

    const updated = await User
      .findByIdAndUpdate(req.user._id, update, { new: true, runValidators: false })
      .select(SAFE_SELECT);
    if (!updated) return res.status(404).json({ message: 'Candidate not found.' });
    log.success(`Profile updated for ${updated.name || updated.email}`);
    res.json(updated);
  } catch (err) { next(err); }
};

exports.uploadAndExtractCV = async (req, res, next) => {
  log.section('UPLOAD & EXTRACT CV');
  const startTime = Date.now();

  try {
    // 1. Validate
    log.info(`File received: ${req.file?.originalname} (${req.file?.size} bytes)`);
    try { _assertPDF(req.file); } catch (e) {
      log.error(`File validation failed: ${e.message}`);
      return res.status(e.status || 400).json({ message: e.message });
    }
    log.success('File validation passed (PDF confirmed)');

    // 2. Read PDF
    log.info('Reading PDF buffer from disk...');
    const pdfBuffer = await fs.promises.readFile(req.file.path);
    log.info(`PDF buffer loaded: ${pdfBuffer.length} bytes`);

    // 3. Extract via FastAPI + LLM
    log.info('Sending to hf.service → FastAPI → qwen2.5:3b...');
    let extracted;
    try {
      extracted = await extractCVFromPDFBuffer(pdfBuffer);
    } catch (err) {
      log.error(`Extraction error: ${err.message}`);
      return res.status(422).json({ message: 'PDF appears to be empty or unreadable (OCR failed).' });
    }

    const { _embedding, cvRawText, ...extractedClean } = extracted;

    log.success('Extraction complete:');
    log.info(`  name     : ${extractedClean.name}`);
    log.info(`  email    : ${extractedClean.email}`);
    log.info(`  skills   : ${extractedClean.skills?.length} → [${(extractedClean.skills || []).slice(0,5).join(', ')}]`);
    log.info(`  languages: ${extractedClean.languages?.length}`);
    log.info(`  education: ${extractedClean.education?.length}`);
    log.info(`  experience: ${extractedClean.experience?.length}`);
    log.info(`  yearsExp : ${extractedClean.yearsExperience}`);
    log.info(`  embedding: ${_embedding ? _embedding.length + ' dims' : 'null'}`);
    log.info(`  rawText  : ${cvRawText?.length} chars`);

    // 4. Build update payload
    const cvPayload = {
      cv:           { path: req.file.path, originalName: req.file.originalname, uploadedAt: new Date() },
      cvExtracted:  extractedClean,
      cvRawText:    cvRawText || '',
      cvEmbedding:  _embedding || null,
    };

    // 5. Auto-fill profile fields if empty
    const candidate = await User.findById(req.user._id);
    if (candidate) {
      if (!candidate.name     && extracted.name)     { cvPayload.name     = extracted.name;     log.info(`Auto-fill name: ${extracted.name}`); }
      if (!candidate.phone    && extracted.phone)    { cvPayload.phone    = extracted.phone;    log.info(`Auto-fill phone: ${extracted.phone}`); }
      if (!candidate.location && extracted.location) { cvPayload.location = extracted.location; log.info(`Auto-fill location: ${extracted.location}`); }
    }

    // 6. Save to MongoDB
    log.info('Saving to MongoDB...');
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

exports.getRecommendedJobs = async (req, res, next) => {
  log.section('GET RECOMMENDED JOBS');
  const startTime = Date.now();

  try {
    log.info(`User: ${req.user._id}`);

    // 1. Load candidate with CV data
    const candidate = await User
      .findById(req.user._id)
      .select('+cvRawText +cvEmbedding cvExtracted');

    if (!candidate?.cvRawText && !candidate?.cvExtracted) {
      log.warn('No CV found for candidate');
      return res.status(400).json({ message: 'No CV found. Please upload your CV first.' });
    }

    log.info(`CV raw text: ${candidate.cvRawText?.length || 0} chars`);
    log.info(`CV embedding: ${candidate.cvEmbedding ? candidate.cvEmbedding.length + ' dims (pre-computed)' : 'null (will recompute)'}`);

    // 2. Load open jobs
    const filter = { status: 'open' };
    if (req.query.department) filter.department = req.query.department;
    if (req.query.location)   filter.location   = { $regex: req.query.location, $options: 'i' };

    log.info(`Loading jobs with filter: ${JSON.stringify(filter)}`);
    const jobs = await JobOffer
      .find(filter)
      .select('+embedding')
      .limit(MAX_JOBS_PER_RECOMMENDATION)
      .lean();

    log.info(`Found ${jobs.length} open jobs`);
    if (!jobs.length) return res.json({ recommendations: [] });

    const jobsWithEmbedding = jobs.filter(j => j.embedding).length;
    log.info(`Jobs with pre-computed embeddings: ${jobsWithEmbedding}/${jobs.length}`);

    // 3. Match
    const cvText      = candidate.cvRawText || JSON.stringify(candidate.cvExtracted, null, 2);
    const cvEmbedding = candidate.cvEmbedding || null;

    log.info('Starting AI matching...');
    const matches = await matchCVToJobs(cvText, jobs, cvEmbedding);

    if (!matches.length) {
      log.error('AI matching returned no results');
      return res.status(503).json({ message: 'AI matching service unavailable.' });
    }

    // 4. Format and sort
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
    log.success(`Matching complete in ${elapsed}s:`);
    recommendations.slice(0, 5).forEach((r, i) => {
      log.info(`  ${i+1}. "${r.job.title}" → ${r.score}% (${r.recommendation})`);
    });

    res.json({ recommendations });
  } catch (err) { next(err); }
};

exports.applyWithCV = async (req, res, next) => {
  log.section('APPLY WITH CV');
  const startTime = Date.now();

  try {
    log.info(`User: ${req.user._id} | Job: ${req.params.id}`);
    log.info(`File: ${req.file?.originalname} (${req.file?.size} bytes)`);

    // 1. Validate file
    try { _assertPDF(req.file); } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }

    // 2. Load job
    const job = await JobOffer.findById(req.params.id).select('+embedding');
    if (!job)                   return res.status(404).json({ message: 'Job not found.' });
    if (job.status !== 'open') return res.status(400).json({ message: 'This job offer is not open.' });
    log.info(`Job: "${job.title}" (${job.department})`);

    // 3. Check duplicate application
    const alreadyApplied = await User.exists({
      _id: req.user._id,
      'applications.jobOffer': job._id,
    });
    if (alreadyApplied) {
      log.warn('Candidate already applied to this job');
      return res.status(409).json({ message: 'You have already applied to this job.' });
    }

    // 4. Extract CV
    log.info('Extracting CV for application...');
    const pdfBuffer = await fs.promises.readFile(req.file.path);
    let extracted;
    try {
      extracted = await extractCVFromPDFBuffer(pdfBuffer);
    } catch (err) {
      log.error(`Extraction error: ${err.message}`);
      return res.status(422).json({ message: 'PDF appears to be empty or unreadable.' });
    }

    const { _embedding: cvEmbedding, cvRawText, ...extractedClean } = extracted;
    log.info(`CV extracted: ${extractedClean.skills?.length} skills, ${extractedClean.yearsExperience} years exp`);

    // 5. AI Matching for this specific job
    log.info(`Computing AI match score for "${job.title}"...`);
    let aiScore = null, aiReport = null;
    try {
      const matches = await matchCVToJobs(cvRawText || '', [job], cvEmbedding);
      if (matches?.[0]) {
        aiScore  = matches[0].score;
        aiReport = {
          matchedSkills:    matches[0].matchedSkills,
          missingSkills:    matches[0].missingSkills,
          blockedByPrereqs: matches[0].blockedByPrereqs,
          prereqDetails:    matches[0].prereqDetails,
          semanticScore:    matches[0].semanticScore,
          experienceScore:  matches[0].experienceScore,
          levelScore:       matches[0].levelScore,
          recommendation:   matches[0].recommendation,
          analysis:         matches[0].analysis,
        };
        log.success(`AI match score: ${aiScore}% (${matches[0].recommendation})`);
      }
    } catch (aiErr) {
      log.warn(`AI scoring failed: ${aiErr.message}`);
    }

    // 6. Build payloads
    const cvPayload = {
      cv:          { path: req.file.path, originalName: req.file.originalname, uploadedAt: new Date() },
      cvExtracted: { ...extractedClean, yearsExperience: extracted.yearsExperience || 0 },
      cvRawText:   cvRawText || '',
      cvEmbedding: cvEmbedding || null,
    };

    const profilePatch = {};
    const candidate = await User.findById(req.user._id).select('name phone location');
    if (candidate) {
      if (!candidate.name     && extracted.name)     profilePatch.name     = extracted.name;
      if (!candidate.phone    && extracted.phone)    profilePatch.phone    = extracted.phone;
      if (!candidate.location && extracted.location) profilePatch.location = extracted.location;
    }

    const newApp = {
      jobOffer:    job._id,
      appliedDate: new Date(),
      status:      'Pending',
      aiMatchScore: aiScore,
    };

    // 7. Atomic save
    log.info('Saving application to MongoDB (atomic $push)...');
    await User.findByIdAndUpdate(
      req.user._id,
      { ...cvPayload, ...profilePatch, $push: { applications: newApp } },
      { runValidators: false }
    );
    await JobOffer.findByIdAndUpdate(job._id, { $inc: { applicationsCount: 1 } });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.success(`Application submitted in ${elapsed}s | aiScore=${aiScore}%`);

    res.status(200).json({
      message:   'Application submitted successfully.',
      jobId:     job._id,
      aiScore,
      aiReport,
      extracted: extractedClean,
    });
  } catch (err) { next(err); }
};

exports.getCandidatesByJob = async (req, res, next) => {
  log.section('GET CANDIDATES BY JOB');
  log.info(`Job ID: ${req.params.jobId}`);
  try {
    const { jobId } = req.params;
    const candidates = await User
      .find({ 'applications.jobOffer': jobId, role: 'candidate' })
      .select(SAFE_SELECT)
      .lean();

    log.info(`Found ${candidates.length} candidates`);

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
        aiMatchScore:      app?.aiMatchScore ?? null,
        preSelected:       app?.preSelected  ?? false,
        avatarColor:       c.avatarColor,
        cv:                c.cv,
        cvExtracted:       c.cvExtracted,
        applicationStatus: app?.status     || 'Pending',
        appliedDate:       app?.appliedDate,
        rhApproved:        app?.rhApproved ?? 'pending',
        techStatus:        app?.techStatus ?? 'pending',
        interviews:        app?.interviews ?? { rh: null, tech: null },
      };
    });

    candidates.forEach(c => {
      const app = c.applications.find(a => a.jobOffer.toString() === jobId);
      log.info(`  ${c.name || c.email}: aiScore=${app?.aiMatchScore}% status=${app?.status}`);
    });

    res.json({ candidates: result });
  } catch (err) { next(err); }
};

exports.preSelectCandidate = async (req, res, next) => {
  log.section('PRE-SELECT CANDIDATE');
  try {
    const { candidateId, jobId } = req.params;
    const { preSelected }        = req.body;
    log.info(`Candidate: ${candidateId} | Job: ${jobId} | preSelected: ${preSelected}`);

    const candidate = await User.findById(candidateId);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const app = candidate.applications.find(a => a.jobOffer?.toString() === jobId);
    if (!app) return res.status(404).json({ message: 'Application not found.' });

    app.preSelected = preSelected;
    await candidate.save();

    if (preSelected) {
      const job = await JobOffer.findById(jobId).select('title');
      if (job) {
        await _notify(candidateId, 'application_status_changed',
          `You have been pre-selected for "${job.title}"! Complete your tests to proceed.`, jobId);
      }
    }

    log.success(`Candidate ${preSelected ? 'pre-selected' : 'unselected'}`);
    res.json({ message: `Candidate ${preSelected ? 'pre-selected' : 'unselected'}.`, preSelected });
  } catch (err) { next(err); }
};

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

      let orderedTech = [];
      try {
        const techTestIds = (jobTechRefs || []).map(t => t.testId);
        const techTests   = await TechnicalTest.find({ _id: { $in: techTestIds } }).lean();
        orderedTech = (jobTechRefs || [])
          .map(ref => {
            const found = techTests.find(t => String(t._id) === String(ref.testId));
            if (!found) return null;
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
        technicalTests:   orderedTech,
        submissions,
        submittedRhIds,
        submittedTechIds,
      };
    }));

    res.json({ jobs: jobsData.filter(Boolean) });
  } catch (err) { next(err); }
};

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

      const [rhTests, submissions] = await Promise.all([
        TestRh.find({ job: jobId }).select('_id name status themes').lean().catch(() => []),
        TestSubmission
          .find({ candidate: req.user._id, job: jobId })
          .select('_id testKind rhTest technicalTest score status scoreBreakdown submittedAt evaluatedAt')
          .lean()
          .catch(() => []),
      ]);

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
        app.status, app.preSelected, rhTests, technicalTests, submittedRhIds, submittedTechIds
      );

      const evaluated = submissions.filter(s => s.status === 'evaluated' && s.score !== null);
      const avgScore  = evaluated.length
        ? Math.round(evaluated.reduce((acc, s) => acc + s.score, 0) / evaluated.length)
        : null;

      const interviews = app.interviews || {};

      return {
        jobOffer: {
          _id: job._id, title: job.title, department: job.department,
          location: job.location, contractType: job.contractType, status: job.status,
        },
        testPeriod:        job.testPeriod || { start: null, end: null },
        applicationStatus: app.status,
        appliedDate:       app.appliedDate,
        interviews:        { rh: interviews.rh || null, tech: interviews.tech || null },
        interview:         app.interview || interviews.rh || interviews.tech || null,
        currentStage,
        rhApproved:        app.rhApproved  ?? 'pending',
        techStatus:        app.techStatus  ?? 'pending',
        aiMatchScore:      app.aiMatchScore ?? null,
        preSelected:       app.preSelected ?? false,
        overallTestScore:  avgScore,
        rhTests: rhTests.map(t => ({
          _id: t._id, name: t.name, status: t.status,
          submitted:  submittedRhIds.includes(String(t._id)),
          submission: submissions.find(s => String(s.rhTest) === String(t._id)) || null,
        })),
        technicalTests: technicalTests.map(t => ({
          _id: t._id, title: t.title, testType: t.testType, difficulty: t.difficulty,
          submitted:  submittedTechIds.includes(String(t._id)),
          submission: submissions.find(s => String(s.technicalTest) === String(t._id)) || null,
        })),
        submissions,
      };
    }));

    res.json({ journey: journeyItems.filter(Boolean) });
  } catch (err) { next(err); }
};

// ─── Test approval/rejection ──────────────────────────────────────────────────

async function _handleTestDecision(req, res, next, action) {
  try {
    const { candidateId, jobId } = req.params;
    const { testKind }           = req.body;
    const userRole               = req.user.role;

    log.section(`TEST DECISION: ${action.toUpperCase()}`);
    log.info(`Candidate: ${candidateId} | Job: ${jobId} | testKind: ${testKind} | action: ${action}`);

    if (testKind === 'rh'        && !['rh', 'admin'].includes(userRole))
      return res.status(403).json({ message: 'Seul un RH peut traiter un test RH.' });
    if (testKind === 'technical' && !['technical evaluator', 'admin'].includes(userRole))
      return res.status(403).json({ message: 'Seul un technical evaluator peut traiter un test technique.' });

    const user = await User.findById(candidateId);
    if (!user) return res.status(404).json({ message: 'Candidat introuvable.' });

    const application = user.applications.find(a => a.jobOffer?.toString() === jobId);
    if (!application) return res.status(404).json({ message: 'Candidature introuvable.' });

    const field   = testKind === 'rh' ? 'rhApproved' : 'techStatus';
    const current = application[field];

    if (action === 'approved' && current === 'approved')
      return res.status(400).json({ message: 'Déjà approuvé.' });
    if (action === 'rejected') {
      if (current === 'rejected') return res.status(400).json({ message: 'Déjà rejeté.' });
      if (current === 'approved') return res.status(400).json({ message: 'Impossible de rejeter après approbation.' });
    }

    application[field] = action;

    if (action === 'approved'
        && application.rhApproved === 'approved'
        && application.techStatus === 'approved') {
      const alreadyAdvanced = ['RH Interview', 'Tech Interview', 'Accepted', 'Rejected'].includes(application.status);
      if (!alreadyAdvanced) {
        application.status = 'In Review';
        log.info('Both tests approved → status set to In Review');
        const job = await JobOffer.findById(jobId).select('title');
        await _notify(candidateId, 'test_validation_complete',
          `Félicitations ! Vos deux tests ont été validés pour "${job?.title || ''}". Votre dossier est en cours de revue.`, jobId);
      }
    }

    if (action === 'rejected') {
      const job = await JobOffer.findById(jobId).select('title');
      await _notify(candidateId, 'test_rejected',
        `Votre test ${testKind === 'rh' ? 'RH' : 'technique'} pour "${job?.title || ''}" a été refusé.`, jobId);
    }

    await user.save();
    log.success(`Test ${testKind} ${action} for candidate ${candidateId}`);
    res.json({
      message:    `Test ${testKind} ${action}.`,
      rhApproved: application.rhApproved,
      techStatus: application.techStatus,
      status:     application.status,
    });
  } catch (err) { next(err); }
}

exports.approveCandidateTest = (req, res, next) => _handleTestDecision(req, res, next, 'approved');
exports.rejectCandidateTest  = (req, res, next) => _handleTestDecision(req, res, next, 'rejected');

exports.updateApplicationStatus = async (req, res, next) => {
  log.section('UPDATE APPLICATION STATUS');
  try {
    const { candidateId, jobId } = req.params;
    const { status, feedback }   = req.body;
    log.info(`Candidate: ${candidateId} | Job: ${jobId} | New status: ${status}`);

    const ALLOWED_STATUSES = ['Pending', 'In Review', 'RH Interview', 'Tech Interview', 'Accepted', 'Rejected'];
    if (!ALLOWED_STATUSES.includes(status))
      return res.status(400).json({ message: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}` });

    const candidate = await User.findById(candidateId);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const app = candidate.applications.find(a => a.jobOffer?.toString() === jobId);
    if (!app) return res.status(404).json({ message: 'Application not found.' });

    const oldStatus = app.status;
    app.status = status;
    await candidate.save();
    log.success(`Status changed: ${oldStatus} → ${status}`);

    try {
      const job = await JobOffer.findById(jobId).select('title');
      if (job) {
        const msgMap = {
          'In Review':     `Your application for "${job.title}" is now under review.`,
          'RH Interview':  `You have been invited to an RH interview for "${job.title}".`,
          'Tech Interview': `You have been invited to a technical interview for "${job.title}".`,
          'Accepted':      `Congratulations! You have been accepted for "${job.title}".`,
          'Rejected':      `Your application for "${job.title}" was not successful this time.`,
        };
        const message = (msgMap[status] || `Your application status changed to ${status}.`)
          + (feedback ? ` Note: ${feedback}` : '');
        await _notify(candidateId, 'application_status_changed', message, jobId);
      }
    } catch (e) {
      log.error(`Notification error: ${e.message}`);
    }

    res.json({ message: 'Application status updated.', status, application: app });
  } catch (err) { next(err); }
};