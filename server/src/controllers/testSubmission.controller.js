'use strict';
// controllers/testSubmission.controller.js
// Module: Test Submissions — scoring engine, submit & evaluate endpoints
//
// SCORING RULES
// ─────────────────────────────────────────────────────────────────
//  Problem Solving : 100 if ALL test cases pass, else 0 (Codeforces-style)
//  Complexity      : stored informatively — never affects the score
//  No test cases   : status = 'pending_review' (manual correction required)

const TestSubmission = require('../models/testSubmission.model');
const TestRh         = require('../models/testRh.model');
const TechnicalTest  = require('../models/technical-test.model');
const JobOffer       = require('../models/jobOffer.model');
const User           = require('../models/user.model');
const Notification   = require('../models/notification.model');
const { getIO }      = require('../utils/socket');

const BUILTIN_MODELS = TestRh.schema.statics.BUILTIN_MODELS || {};

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _notify(userId, type, message, jobId) {
  try {
    const notif = await Notification.create({ userId, type, message, jobId, read: false });
    try { getIO().to(`user:${userId}`).emit('notification', notif); } catch (_) {}
  } catch (err) {
    console.error('[notify]', err.message);
  }
}

async function _refreshCandidateScore(candidateId, jobId) {
  try {
    const evaluated = await TestSubmission.find({
      candidate: candidateId,
      job:       jobId,
      status:    'evaluated',
      score:     { $ne: null },
    });
    if (!evaluated.length) return;
    const avg = Math.round(evaluated.reduce((s, e) => s + e.score, 0) / evaluated.length);
    await User.findByIdAndUpdate(candidateId, { score: avg });
  } catch (err) {
    console.error('[_refreshCandidateScore]', err);
  }
}

function _getAppliedJobIds(candidate) {
  return (candidate?.applications || []).map(a => String(a.jobOffer?._id || a.jobOffer));
}

// ── Scoring engines ───────────────────────────────────────────────────────────

/**
 * Score an RH psychometric test.
 * Returns { score (0-100), maxScore: 100, breakdown: { [criterionKey]: pct } }
 */
function _scoreRhTest(rhTest, answers) {
  const answerMap = Object.fromEntries(answers.map(a => [String(a.questionId), a.value]));
  const criterionData = {};

  function ensureCriterion(key) {
    criterionData[key] = criterionData[key] || { earned: 0, max: 0, count: 0 };
  }

  for (const theme of (rhTest.themes || [])) {
    for (const model of (theme.models || [])) {
      const criteriaList = model.customCriteria?.length
        ? model.customCriteria
        : (BUILTIN_MODELS[model.modelType]?.criteria ?? []);

      const validCriteria = new Set(criteriaList.map(c => c.key));

      for (const question of (model.questions || [])) {
        const answer = answerMap[String(question._id)];
        if (answer === undefined || answer === null) continue;

        if (question.answerType === 'likert') {
          const key = question.likertCriterionKey;
          if (!key || !validCriteria.has(key)) continue;
          const val        = Math.min(Math.max(Number(answer) || 1, 1), 5);
          let normalised   = ((val - 1) / 4) * 100;
          if (question.likertReversed) normalised = 100 - normalised;
          ensureCriterion(key);
          criterionData[key].earned += normalised;
          criterionData[key].count  += 1;
          continue;
        }

        if (question.answerType === 'single_choice') {
          const chosen = question.options.find(o => o.text === answer);
          if (!chosen) continue;
          const { criterionKey: key, score: pts = 0 } = chosen;
          const maxPts = Math.max(...question.options.map(o => o.score ?? 0), 0);
          if (key && validCriteria.has(key)) {
            ensureCriterion(key);
            criterionData[key].earned += pts;
            criterionData[key].max    += maxPts;
          }
          continue;
        }

        if (question.answerType === 'multiple_choice') {
          const selected = Array.isArray(answer) ? answer : [];
          for (const opt of question.options) {
            const { criterionKey: key, score: pts = 0 } = opt;
            if (key && validCriteria.has(key)) {
              ensureCriterion(key);
              if (selected.includes(opt.text)) criterionData[key].earned += pts;
              criterionData[key].max += Math.max(pts, 0);
            }
          }
          continue;
        }
      }
    }
  }

  const breakdown = {};
  let totalEarned = 0, totalMax = 0;

  for (const [key, data] of Object.entries(criterionData)) {
    let pct;
    if (data.count > 0 && data.max === 0) {
      pct = Math.round(data.earned / data.count);
      totalEarned += (pct / 100) * data.count * 25;
      totalMax    += data.count * 25;
    } else if (data.max > 0) {
      pct = Math.round((data.earned / data.max) * 100);
      totalEarned += data.earned;
      totalMax    += data.max;
    } else {
      pct = 0;
    }
    breakdown[key] = pct;
  }

  const score = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : 0;
  return { score, maxScore: 100, breakdown };
}

/**
 * Score a QCM-type technical test.
 */
function _scoreQcm(technicalTest, qcmAnswers) {
  if (!technicalTest.qcm?.questions?.length) {
    return { score: 0, maxScore: 0, breakdown: { qcm: 0, total: 0 }, needsReview: false };
  }

  const answerMap = Object.fromEntries(qcmAnswers.map(a => [String(a.questionId), a]));
  let earned = 0, max = 0;

  for (const q of technicalTest.qcm.questions) {
    const pts = q.points ?? 1;
    max      += pts;
    const answer = answerMap[String(q._id)];
    if (!answer || q.type === 'open') continue;

    const correctIds  = q.options.filter(o => o.isCorrect).map(o => String(o._id));
    const selectedIds = (answer.selectedOptions ?? []).map(String);

    if (
      correctIds.every(id => selectedIds.includes(id)) &&
      selectedIds.every(id => correctIds.includes(id))
    ) {
      earned += pts;
    }
  }

  return {
    score:      max > 0 ? Math.round((earned / max) * 100) : 0,
    maxScore:   max,
    breakdown:  { qcm: earned, total: max },
    needsReview: technicalTest.qcm.questions.some(q => q.type === 'open'),
  };
}

/**
 * Score a problem-solving submission (Codeforces-style).
 * All pass → 100, any fail → 0, no results → pending_review.
 */
function _scoreProblemSolving(testResults, complexity) {
  if (!Array.isArray(testResults) || testResults.length === 0) {
    return {
      score: null,
      needsReview: true,
      breakdown: {
        code:            'pending_review',
        reason:          'No test case results received — manual review required.',
        testsPassed:     0,
        testsTotal:      0,
        allPassed:       false,
        complexityTime:  complexity?.time?.notation  ?? 'N/A',
        complexitySpace: complexity?.space?.notation ?? 'N/A',
        timeEfficiency:  complexity?.time?.efficiency  ?? null,
        spaceEfficiency: complexity?.space?.efficiency ?? null,
      },
    };
  }

  const total     = testResults.length;
  const passed    = testResults.filter(r => r.pass === true).length;
  const allPassed = passed === total;
  const codeScore = allPassed ? 100 : 0;

  return {
    score:       codeScore,
    needsReview: false,
    breakdown: {
      code:            codeScore,
      testsPassed:     passed,
      testsTotal:      total,
      allPassed,
      complexityTime:  complexity?.time?.notation  ?? 'N/A',
      complexitySpace: complexity?.space?.notation ?? 'N/A',
      timeEfficiency:  complexity?.time?.efficiency  ?? null,
      spaceEfficiency: complexity?.space?.efficiency ?? null,
    },
  };
}

// ── Submit RH ─────────────────────────────────────────────────────────────────

exports.submitRhAnswers = async (req, res, next) => {
  try {
    const candidateId = req.user._id;

    // Accept both rhTestId and jobId as the route param
    const param = req.params.rhTestId || req.params.jobId;
    let rhTest  = await TestRh.findById(param).catch(() => null);
    if (!rhTest) rhTest = await TestRh.findOne({ job: param });
    if (!rhTest) return res.status(404).json({ message: 'RH test not found.' });

    const jobId     = String(rhTest.job);
    const candidate = await User.findById(candidateId);

    if (!_getAppliedJobIds(candidate).includes(jobId)) {
      return res.status(403).json({ message: 'You have not applied to this job.' });
    }

    const application = candidate.applications.find(
      app => String(app.jobOffer?._id || app.jobOffer) === jobId
    );
    if (!application?.preSelected) {
      return res.status(403).json({ message: 'You must be pre-selected by HR before taking tests.' });
    }

    if (await TestSubmission.findOne({ candidate: candidateId, job: jobId, rhTest: rhTest._id })) {
      return res.status(409).json({ message: 'Already submitted.' });
    }

    const { answers = [] } = req.body;
    const { score, maxScore, breakdown } = _scoreRhTest(rhTest, answers);

    const submission = await TestSubmission.create({
      candidate:    candidateId,
      job:          jobId,
      testKind:     'rh',
      rhTest:       rhTest._id,
      rhAnswers:    answers,
      score,
      maxScore,
      scoreBreakdown: breakdown,
      status:       'evaluated',
      evaluatedAt:  new Date(),
    });

    await _refreshCandidateScore(candidateId, jobId);

    // Notify assigned RH agents and job creator
    try {
      const jobFull = await JobOffer.findById(jobId).select('title testAssignments createdBy');
      if (jobFull) {
        const cand = await User.findById(candidateId).select('name email');
        const msg  = `${cand?.name || cand?.email || 'A candidate'} submitted the RH test for "${jobFull.title}".`;
        const assignedTo = jobFull.testAssignments?.rhTest?.assignedTo ?? [];
        for (const id of assignedTo) await _notify(id, 'rh_test_submitted', msg, jobFull._id);
        const creatorId = String(jobFull.createdBy);
        if (!assignedTo.map(String).includes(creatorId))
          await _notify(creatorId, 'rh_test_submitted', msg, jobFull._id);
      }
    } catch (e) {
      console.error('[submitRhAnswers] notify error:', e.message);
    }

    res.status(201).json({ message: 'RH test submitted.', score, scoreBreakdown: breakdown, submission: submission._id });
  } catch (err) {
    console.error('[submitRhAnswers]', err);
    next(err);
  }
};

// ── Submit Technical ──────────────────────────────────────────────────────────

exports.submitTechnicalAnswers = async (req, res, next) => {
  try {
    const { testId }  = req.params;
    const candidateId = req.user._id;

    const techTest = await TechnicalTest.findById(testId);
    if (!techTest) return res.status(404).json({ message: 'Technical test not found.' });

    const job = await JobOffer.findOne({ 'technicalTests.testId': techTest._id });
    if (!job)  return res.status(404).json({ message: 'Test not assigned to any job.' });

    const jobId     = String(job._id);
    const candidate = await User.findById(candidateId);

    if (!_getAppliedJobIds(candidate).includes(jobId)) {
      return res.status(403).json({ message: 'You have not applied to this job.' });
    }

    const application = candidate.applications.find(
      app => String(app.jobOffer?._id || app.jobOffer) === jobId
    );
    if (!application?.preSelected) {
      return res.status(403).json({ message: 'You must be pre-selected by HR before taking tests.' });
    }

    if (await TestSubmission.findOne({ candidate: candidateId, job: jobId, technicalTest: testId })) {
      return res.status(409).json({ message: 'Already submitted.' });
    }

    const {
      code             = null,
      language         = null,
      complexity       = null,
      testResults      = [],
      qcmAnswers       = [],
      timeSpentSeconds = null,
      antiCheatReport  = null,
    } = req.body;

    const hasPS  = ['problem_solving', 'mixed'].includes(techTest.testType);
    const hasQCM = ['qcm', 'mixed'].includes(techTest.testType);

    let finalScore  = 0;
    let maxScore    = 0;
    let breakdown   = {};
    let needsReview = false;

    if (hasQCM) {
      const qcmResult = _scoreQcm(techTest, qcmAnswers);
      maxScore    = qcmResult.maxScore;
      breakdown   = { ...breakdown, ...qcmResult.breakdown };
      needsReview = qcmResult.needsReview;
      if (!hasPS) finalScore = qcmResult.score;
    }

    if (hasPS && code) {
      const psResult = _scoreProblemSolving(testResults, complexity);
      breakdown      = { ...breakdown, ...psResult.breakdown };
      maxScore       = 100;

      if (psResult.needsReview) {
        needsReview = true;
        finalScore  = hasQCM ? Math.round(_scoreQcm(techTest, qcmAnswers).score * 0.5) : 0;
        if (hasQCM) breakdown.pendingCodeReview = true;
      } else {
        finalScore = hasQCM
          ? Math.round((_scoreQcm(techTest, qcmAnswers).score * 0.5) + (psResult.score * 0.5))
          : psResult.score;
      }
    }

    if (hasPS && !code) {
      needsReview    = true;
      breakdown.code = 'pending_review';
      breakdown.reason = 'No code submitted.';
      if (!hasQCM) { finalScore = 0; maxScore = 100; }
    }

    const status = needsReview ? 'pending_review' : 'evaluated';

    const submission = await TestSubmission.create({
      candidate:        candidateId,
      job:              jobId,
      testKind:         'technical',
      technicalTest:    testId,
      code:             hasPS  ? code     : null,
      language:         hasPS  ? language : null,
      complexity:       hasPS  ? complexity : null,
      timeSpentSeconds: hasPS  ? timeSpentSeconds : null,
      qcmAnswers:       hasQCM ? qcmAnswers : [],
      score:            needsReview ? null : finalScore,
      maxScore,
      scoreBreakdown:   breakdown,
      status,
      evaluatedAt:      needsReview ? null : new Date(),
      antiCheatReport:  antiCheatReport ?? null,
    });

    await _refreshCandidateScore(candidateId, jobId);

    // Notify assigned technical evaluators and job creator
    try {
      const jobFull = await JobOffer.findById(jobId).select('title testAssignments createdBy');
      if (jobFull) {
        const cand = await User.findById(candidateId).select('name email');
        const msg  = `${cand?.name || cand?.email || 'A candidate'} submitted the technical test "${techTest.title}" for "${jobFull.title}".`;
        const assignedTo = jobFull.testAssignments?.technicalTest?.assignedTo ?? [];
        for (const id of assignedTo) await _notify(id, 'technical_test_submitted', msg, jobFull._id);
        const creatorId = String(jobFull.createdBy);
        if (!assignedTo.map(String).includes(creatorId))
          await _notify(creatorId, 'technical_test_submitted', msg, jobFull._id);
      }
    } catch (e) {
      console.error('[submitTechnicalAnswers] notify error:', e.message);
    }

    res.status(201).json({
      message:        needsReview ? 'Submitted. Pending manual review.' : 'Technical test scored.',
      score:          needsReview ? null : finalScore,
      needsReview,
      scoreBreakdown: breakdown,
      submission:     submission._id,
    });
  } catch (err) {
    console.error('[submitTechnicalAnswers]', err);
    next(err);
  }
};

// ── Read ──────────────────────────────────────────────────────────────────────

exports.getRhSubmissions = async (req, res, next) => {
  try {
    const { _id: userId, role } = req.user;
    const jobFilter = role === 'admin'
      ? { 'testAssignments.rhTest.enabled': true }
      : { 'testAssignments.rhTest.enabled': true, 'testAssignments.rhTest.assignedTo': userId };

    const jobIds = (await JobOffer.find(jobFilter).select('_id').lean()).map(j => j._id);

    const submissions = await TestSubmission.find({ testKind: 'rh', job: { $in: jobIds } })
      .populate('candidate', 'name email avatarColor')
      .populate('job',       'title department')
      .populate({ path: 'rhTest', select: 'name themes' })
      .sort({ submittedAt: -1 })
      .lean();

    res.json(submissions);
  } catch (err) {
    next(err);
  }
};

exports.getTechnicalSubmissions = async (req, res, next) => {
  try {
    const { _id: userId, role } = req.user;
    const jobFilter = role === 'admin'
      ? { 'testAssignments.technicalTest.enabled': true }
      : { 'testAssignments.technicalTest.enabled': true, 'testAssignments.technicalTest.assignedTo': userId };

    const jobIds = (await JobOffer.find(jobFilter).select('_id').lean()).map(j => j._id);

    const submissions = await TestSubmission.find({
      testKind:       'technical',
      job:            { $in: jobIds },
      technicalTest:  { $ne: null },
    })
      .populate('candidate',    'name email avatarColor')
      .populate('job',          'title department')
      .populate('technicalTest', 'title testType difficulty timeLimitMinutes qcm problemSolving tags description')
      .sort({ submittedAt: -1 })
      .lean();

    res.json(submissions);
  } catch (err) {
    next(err);
  }
};

exports.getMySubmissions = async (req, res, next) => {
  try {
    const submissions = await TestSubmission.find({ candidate: req.user._id })
      .populate('job',           'title department status')
      .populate('rhTest',        'name')
      .populate('technicalTest', 'title testType difficulty')
      .sort({ submittedAt: -1 });
    res.json(submissions);
  } catch (err) {
    next(err);
  }
};

exports.getCandidateSubmissions = async (req, res, next) => {
  try {
    const { jobId, candidateId } = req.params;
    const submissions = await TestSubmission.find({ job: jobId, candidate: candidateId })
      .populate({ path: 'rhTest', select: 'name themes' })
      .populate('technicalTest', 'title testType difficulty timeLimitMinutes')
      .sort({ submittedAt: -1 })
      .lean();
    res.json(submissions);
  } catch (err) {
    next(err);
  }
};

exports.getAllSubmissionsForJob = async (req, res, next) => {
  try {
    const submissions = await TestSubmission.find({ job: req.params.jobId })
      .populate('candidate',    'name email avatarColor')
      .populate('job',          'title department')
      .populate('rhTest',       'name themes')
      .populate('technicalTest', 'title testType difficulty')
      .lean();
    res.json(submissions);
  } catch (err) {
    next(err);
  }
};


exports.evaluateSubmission = async (req, res, next) => {
  try {
    const { status, score, scoreBreakdown, evaluatedAt } = req.body;
    const update = {
      ...(status         && { status }),
      ...(score !== undefined && { score }),
      ...(scoreBreakdown && { scoreBreakdown }),
      evaluatedAt: evaluatedAt || new Date(),
    };

    const submission = await TestSubmission.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    )
      .populate('candidate', 'name email avatarColor')
      .populate('job',       'title department')
      .lean();

    if (!submission) return res.status(404).json({ message: 'Submission not found.' });
    res.json(submission);
  } catch (err) {
    next(err);
  }
};