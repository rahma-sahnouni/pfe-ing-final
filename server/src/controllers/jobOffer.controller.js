'use strict';
// controllers/jobOffer.controller.js
// Phase 1 de l'architecture matching :
//   createJob / updateJob → encodeJobSkills() → embedding JobBERT stocké sur job.embedding

const JobOffer       = require('../models/jobOffer.model');
const Notification   = require('../models/notification.model');
const { encodeJobSkills } = require('../services/hf.service');

function _stripFrontendId(arr = []) {
  return (arr || []).map(({ id, ...rest }) => rest);
}

const POPULATE_TEST_ASSIGNMENTS = [
  { path: 'testAssignments.rhTest.assignedTo',        select: 'name email' },
  { path: 'testAssignments.technicalTest.assignedTo', select: 'name email' },
];

// ── Helpers notifications ─────────────────────────────────────────────────────

async function _sendNotifications(job, notifications) {
  if (!notifications.length) return;
  await Notification.insertMany(notifications);
  try {
    const { getIO } = require('../utils/socket');
    const io = getIO();
    notifications.forEach(n =>
      io.to(`user:${n.userId.toString()}`).emit('notification', {
        message: n.message, type: n.type, jobId: n.jobId, createdAt: new Date(),
      })
    );
  } catch (_) {}
}

function _buildAssignmentNotifications(job) {
  const notifications = [];
  const { rhTest, technicalTest } = job.testAssignments || {};
  if (rhTest?.enabled) {
    rhTest.assignedTo.forEach(uid => notifications.push({
      userId: uid, jobId: job._id, type: 'RH_TEST_ASSIGNMENT',
      message: `You have been assigned to create the RH test for job "${job.title}".`,
    }));
  }
  if (technicalTest?.enabled) {
    technicalTest.assignedTo.forEach(uid => notifications.push({
      userId: uid, jobId: job._id, type: 'TECH_TEST_ASSIGNMENT',
      message: `You have been assigned to create the technical test for job "${job.title}".`,
    }));
  }
  const { intervAssignments } = job;
  if (intervAssignments?.rhTest?.enabled) {
    intervAssignments.rhTest.assignedTo.forEach(uid => notifications.push({
      userId: uid, jobId: job._id, type: 'RH_INTERVIEW_ASSIGNMENT',
      message: `You have been assigned to conduct the RH interview for job "${job.title}".`,
    }));
  }
  if (intervAssignments?.technicalTest?.enabled) {
    intervAssignments.technicalTest.assignedTo.forEach(uid => notifications.push({
      userId: uid, jobId: job._id, type: 'TECH_INTERVIEW_ASSIGNMENT',
      message: `You have been assigned to conduct the technical interview for job "${job.title}".`,
    }));
  }
  return notifications;
}

// ── Create ────────────────────────────────────────────────────────────────────

exports.createJob = async (req, res, next) => {
  try {
    const job = new JobOffer({
      title:           req.body.title,
      department:      req.body.department,
      location:        req.body.location,
      contractType:    req.body.contractType,
      experienceLevel: req.body.experienceLevel,
      description:     req.body.description,
      prerequisites:   _stripFrontendId(req.body.prerequisites),
      skills:          _stripFrontendId(req.body.skills),
      createdBy:       req.user._id,
      status:          'draft',
      testAssignments: req.body.testAssignments || {
        rhTest:        { enabled: false, assignedTo: [], deadline: null },
        technicalTest: { enabled: false, assignedTo: [], deadline: null },
      },
      testPeriod: req.body.testPeriod || { start: null, end: null },
      intervAssignments: req.body.intervAssignments || {
        rhTest:        { enabled: false, assignedTo: [], deadline: null },
        technicalTest: { enabled: false, assignedTo: [], deadline: null },
      },
    });

    await job.save();

    // ── PHASE 1 : Encode les skills via JobBERT (Python FastAPI /encode-job) ──
    // Asynchrone et non bloquant : l'offre est créée même si FastAPI est indispo
    encodeJobSkills(job).then(async (embedding) => {
      if (embedding) {
        await JobOffer.findByIdAndUpdate(job._id, {
          embedding,
          embeddingUpdatedAt: new Date(),
        });
        console.info(`[Phase 1] Embedding stocké pour job "${job.title}" (${embedding.length} dims)`);
      } else {
        console.warn(`[Phase 1] Embedding indisponible pour job "${job.title}" — matching sémantique dégradé`);
      }
    }).catch(err => console.error('[Phase 1] encodeJobSkills error:', err.message));

    // Notifications
    await _sendNotifications(job, _buildAssignmentNotifications(job));

    res.status(201).json({ message: 'Job created successfully.', job });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        message: 'Validation failed',
        errors:  Object.values(err.errors).map(e => e.message),
      });
    }
    next(err);
  }
};

// ── Read ──────────────────────────────────────────────────────────────────────

exports.getJobs = async (req, res, next) => {
  try {
    const jobs = await JobOffer.find()
      .populate('createdBy',  'email role')
      .populate('assignedTo', 'email role')
      .populate(POPULATE_TEST_ASSIGNMENTS)
      .sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
};

exports.getJobById = async (req, res, next) => {
  try {
    const job = await JobOffer.findById(req.params.id)
      .populate('createdBy', 'email role')
      .populate(POPULATE_TEST_ASSIGNMENTS);
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    res.json(job);
  } catch (err) {
    next(err);
  }
};

exports.getMyJobs = async (req, res, next) => {
  try {
    const jobs = await JobOffer.find({ createdBy: req.user._id })
      .populate('createdBy',  'email role')
      .populate('assignedTo', 'email role')
      .populate(POPULATE_TEST_ASSIGNMENTS)
      .sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
};

exports.getMyRhTestJobs = async (req, res, next) => {
  try {
    const jobs = await JobOffer.find({
      'testAssignments.rhTest.enabled':    true,
      'testAssignments.rhTest.assignedTo': req.user._id,
    }).populate('createdBy', 'email role name').sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
};

exports.getMyTechTestJobs = async (req, res, next) => {
  try {
    const jobs = await JobOffer.find({
      'testAssignments.technicalTest.enabled':    true,
      'testAssignments.technicalTest.assignedTo': req.user._id,
    }).populate('createdBy', 'email role name').sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
};

// ── Update ────────────────────────────────────────────────────────────────────

exports.updateJob = async (req, res, next) => {
  try {
    if (req.body.prerequisites) req.body.prerequisites = _stripFrontendId(req.body.prerequisites);
    if (req.body.skills)        req.body.skills        = _stripFrontendId(req.body.skills);
    if (req.body.tests)         req.body.tests         = _stripFrontendId(req.body.tests);
    if (req.body.stages)        req.body.stages        = _stripFrontendId(req.body.stages);

    const job = await JobOffer.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    // ── PHASE 1 : Re-encode si les skills/description ont changé ─────────────
    const skillsOrDescriptionChanged =
      req.body.skills || req.body.description || req.body.title || req.body.prerequisites;

    if (skillsOrDescriptionChanged) {
      encodeJobSkills(job).then(async (embedding) => {
        if (embedding) {
          await JobOffer.findByIdAndUpdate(job._id, { embedding, embeddingUpdatedAt: new Date() });
          console.info(`[Phase 1] Embedding mis à jour pour job "${job.title}"`);
        }
      }).catch(err => console.error('[Phase 1] re-encode error:', err.message));
    }

    res.json(job);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        message: 'Validation failed',
        errors:  Object.values(err.errors).map(e => e.message),
      });
    }
    next(err);
  }
};

// ── Delete ────────────────────────────────────────────────────────────────────

exports.deleteJob = async (req, res, next) => {
  try {
    const job = await JobOffer.findByIdAndDelete(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const jobId = req.params.id;
    const TestRh         = require('../models/testRh.model');
    const TechnicalTest  = require('../models/technical-test.model');
    const TestSubmission = require('../models/testSubmission.model');
    const User           = require('../models/user.model');

    const [rhResult, techResult, subResult, pullResult] = await Promise.all([
      TestRh.deleteMany({ job: jobId }),
      TechnicalTest.deleteMany({ _id: { $in: (job.technicalTests ?? []).map(t => t.testId) } }),
      TestSubmission.deleteMany({ job: jobId }),
      User.updateMany(
        { 'applications.jobOffer': jobId },
        { $pull: { applications: { jobOffer: jobId } } }
      ),
    ]);

    res.json({
      message: 'Job deleted successfully.',
      deleted: {
        rhTests: rhResult.deletedCount, techTests: techResult.deletedCount,
        submissions: subResult.deletedCount, applications: pullResult.modifiedCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Accessible Jobs (RH + Admin) ─────────────────────────────────────────────

exports.getAccessibleJobs = async (req, res, next) => {
  try {
    const userId   = req.user._id;
    const userRole = req.user.role;

    const filter = userRole === 'admin' ? {} : {
      $or: [
        { 'intervAssignments.rhTest.assignedTo':        userId },
        { 'intervAssignments.technicalTest.assignedTo': userId },
      ],
    };

    const jobs = await JobOffer.find(filter)
      .populate('createdBy', 'email role name')
      .populate('assignedTo', 'email role')
      .populate(POPULATE_TEST_ASSIGNMENTS)
      .sort({ createdAt: -1 });

    res.json(jobs);
  } catch (err) {
    next(err);
  }
};

// ── Re-encode manuel (admin) ──────────────────────────────────────────────────
// POST /jobs/:id/encode — force le recalcul de l'embedding d'une offre

exports.reEncodeJob = async (req, res, next) => {
  try {
    const job = await JobOffer.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const embedding = await encodeJobSkills(job);
    if (!embedding) {
      return res.status(503).json({
        message: 'FastAPI /encode-job unavailable. Embedding not updated.',
      });
    }

    await JobOffer.findByIdAndUpdate(job._id, { embedding, embeddingUpdatedAt: new Date() });
    res.json({
      message: 'Job embedding re-encoded successfully.',
      dims:    embedding.length,
      updatedAt: new Date(),
    });
  } catch (err) {
    next(err);
  }
};