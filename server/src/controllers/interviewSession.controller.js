'use strict';

const InterviewSession = require('../models/interviewSession.model');
const User             = require('../models/user.model');
const JobOffer         = require('../models/jobOffer.model');
const Notification     = require('../models/notification.model');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _notify(userId, type, message, jobId) {
  try {
    const { getIO } = require('../utils/socket');
    const notif = await Notification.create({ userId, type, message, jobId, read: false });
    try { getIO().to(`user:${userId}`).emit('notification', notif); } catch (_) {}
  } catch (_) {}
}

function _generateSlots(ranges = []) {
  const slots = [];
  for (const range of ranges) {
    // Construire des dates UTC pour éviter le décalage horaire
    const start = new Date(`${range.date}T${range.startTime}:00Z`);
    const end   = new Date(`${range.date}T${range.endTime}:00Z`);
    let current = new Date(start);

    while (current < end) {
      const slotEnd = new Date(current.getTime() + range.durationMinutes * 60000);
      if (slotEnd > end) break;
      slots.push({
        date:            range.date,
        startTime:       current.toISOString().slice(11, 16),
        scheduledAt:     new Date(current),
        durationMinutes: range.durationMinutes,
      });
      current = new Date(current.getTime() + (range.durationMinutes + range.breakMinutes) * 60000);
    }
  }
  return slots.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

function _stageForRole(role) {
  if (role === 'rh') return 'rh';
  if (role === 'technical evaluator') return 'technical evaluator';
  return null;
}

function _configKeyForStage(stage) {
  return stage === 'technical evaluator' ? 'tech' : 'rh';
}

function _interviewKeyForStage(stage) {
  return stage === 'technical evaluator' ? 'tech' : 'rh';
}

async function _hasOverlappingInterview(candidateId, jobId, newStart, newDuration, excludeStage) {
  const otherStage = excludeStage === 'rh' ? 'technical evaluator' : 'rh';
  const session = await InterviewSession.findOne({ job: jobId, stage: otherStage });
  if (!session) return false;

  const existing = session.candidateEvaluations.find(e =>
    String(e.candidate) === String(candidateId) && e.scheduledAt
  );
  if (!existing) return false;

  const existingDuration = existing.durationMinutes || 30;
  const existingStart = new Date(existing.scheduledAt);
  const existingEnd   = new Date(existingStart.getTime() + existingDuration * 60000);
  const newStartDate  = new Date(newStart);
  const newEndDate    = new Date(newStartDate.getTime() + newDuration * 60000);

  return (newStartDate < existingEnd && newEndDate > existingStart);
}

// ── Interview Config ──────────────────────────────────────────────────────────

exports.getInterviewConfig = async (req, res, next) => {
  try {
    const job = await JobOffer.findById(req.params.jobId).select('interviewConfig');
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const [rhSession, techSession] = await Promise.all([
      InterviewSession.findOne({ job: req.params.jobId, stage: 'rh' })
        .select('scheduledRanges evaluationGrid').lean(),
      InterviewSession.findOne({ job: req.params.jobId, stage: 'technical evaluator' })
        .select('scheduledRanges evaluationGrid').lean(),
    ]);

    const base = job.interviewConfig || {};
    res.json({
      rh: {
        enabled:        base.rh?.enabled ?? true,
        ranges:         rhSession?.scheduledRanges   || base.rh?.ranges         || [],
        evaluationGrid: rhSession?.evaluationGrid    || base.rh?.evaluationGrid  || [],
      },
      tech: {
        enabled:        base.tech?.enabled ?? true,
        ranges:         techSession?.scheduledRanges  || base.tech?.ranges        || [],
        evaluationGrid: techSession?.evaluationGrid   || base.tech?.evaluationGrid || [],
      },
    });
  } catch (err) { next(err); }
};
exports.saveInterviewConfig = async (req, res, next) => {
  try {
    const job = await JobOffer.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const userRole = req.user.role;
    const reqStage = req.body.stage;

    if (userRole !== 'admin') {
      if (userRole === 'rh' && reqStage !== 'rh') {
        return res.status(403).json({ message: 'RH can only configure RH interviews.' });
      }
      if (userRole === 'technical evaluator' && reqStage !== 'technical evaluator') {
        return res.status(403).json({ message: 'Technical evaluator can only configure their own interviews.' });
      }
    }

    const oldSession = await InterviewSession.findOne({ job: req.params.jobId, stage: reqStage });
    const oldRanges = oldSession?.scheduledRanges || [];

    if (!job.interviewConfig) {
      job.interviewConfig = {
        rh:   { enabled: false, ranges: [], evaluationGrid: [] },
        tech: { enabled: false, ranges: [], evaluationGrid: [] },
      };
    }

    const configKey = _configKeyForStage(reqStage);
    const newRanges = req.body.ranges || [];
const newGrid = Array.isArray(req.body.evaluationGrid) ? req.body.evaluationGrid : [];

    job.interviewConfig[configKey] = {
      enabled:        req.body.enabled ?? true,
      ranges:         newRanges,
      evaluationGrid: newGrid,
    };
    job.markModified('interviewConfig');
    await job.save();

    await InterviewSession.findOneAndUpdate(
      { job: req.params.jobId, stage: reqStage },
      {
        $set: {
          evaluationGrid:  newGrid,
          scheduledRanges: newRanges,
          conductedBy:     req.user._id,
        },
        $setOnInsert: {
          job:                  req.params.jobId,
          stage:                reqStage,
          candidateEvaluations: [],
        },
      },
      { upsert: true, new: true }
    );

    // Suppression des affectations pour les ranges supprimés
    const deletedRanges = oldRanges.filter(oldRange =>
      !newRanges.some(newRange =>
        newRange.date === oldRange.date &&
        newRange.startTime === oldRange.startTime &&
        newRange.endTime === oldRange.endTime &&
        newRange.durationMinutes === oldRange.durationMinutes
      )
    );

    if (deletedRanges.length > 0) {
      const session = await InterviewSession.findOne({ job: req.params.jobId, stage: reqStage });
      if (session && session.candidateEvaluations.length) {
        for (const range of deletedRanges) {
          const startDateTime = new Date(`${range.date}T${range.startTime}:00Z`);
          const endDateTime = new Date(`${range.date}T${range.endTime}:00Z`);
          const toDelete = session.candidateEvaluations.filter(ev => {
            if (!ev.scheduledAt) return false;
            const evDate = new Date(ev.scheduledAt);
            return evDate >= startDateTime && evDate < endDateTime;
          });

          if (toDelete.length > 0) {
            const idsToDelete = toDelete.map(ev => ev._id);
            await InterviewSession.updateOne(
              { _id: session._id },
              { $pull: { candidateEvaluations: { _id: { $in: idsToDelete } } } }
            );

            const candidateIds = toDelete.map(ev => ev.candidate.toString());
            const interviewKey = _interviewKeyForStage(reqStage);
            for (const candId of candidateIds) {
              await User.updateOne(
                { _id: candId, 'applications.jobOffer': req.params.jobId },
                { $unset: { [`applications.$.interviews.${interviewKey}`]: "" } }
              );
            }
          }
        }
      }
    }

    res.json({ message: 'Configuration saved.', config: job.interviewConfig });
  } catch (err) {
    next(err);
  }
};

exports.autoAssignSlots = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userRole  = req.user.role;
    const reqStage  = req.body.stage || _stageForRole(userRole) || 'rh';

    if (userRole !== 'admin') {
      if (userRole === 'rh' && reqStage !== 'rh') {
        return res.status(403).json({ message: 'Forbidden.' });
      }
      if (userRole === 'technical evaluator' && reqStage !== 'technical evaluator') {
        return res.status(403).json({ message: 'Forbidden.' });
      }
    }

    const job = await JobOffer.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const configKey   = _configKeyForStage(reqStage);
    const stageConfig = job.interviewConfig?.[configKey] || {};
    const ranges      = req.body.ranges?.length ? req.body.ranges : (stageConfig.ranges || []);
    if (!ranges.length) return res.status(400).json({ message: 'No ranges configured.' });

    let slots = _generateSlots(ranges);
    if (!slots.length) return res.status(400).json({ message: 'No slots generated from ranges.' });

    const existingSession = await InterviewSession.findOne({ job: jobId, stage: reqStage });
    const usedSlots = new Set();
    if (existingSession) {
      existingSession.candidateEvaluations.forEach(ev => {
        if (ev.scheduledAt) {
          const key = `${ev.scheduledAt.toISOString()}_${ev.durationMinutes || 30}`;
          usedSlots.add(key);
        }
      });
    }

    slots = slots.filter(slot => {
      const key = `${slot.scheduledAt.toISOString()}_${slot.durationMinutes}`;
      return !usedSlots.has(key);
    });

    const gridToUse = stageConfig.evaluationGrid?.length
      ? stageConfig.evaluationGrid
      : (existingSession?.evaluationGrid || []);

    const session = await InterviewSession.findOneAndUpdate(
      { job: jobId, stage: reqStage },
      {
        $set: {
          scheduledRanges:      ranges,
          evaluationGrid:       gridToUse,
          conductedBy:          req.user._id,
        },
        $setOnInsert: {
          job:   jobId,
          stage: reqStage,
          candidateEvaluations: [],
        },
      },
      { upsert: true, new: true }
    );

    const users = await User.find({
      'applications.jobOffer': jobId,
      role: 'candidate',
    }).lean();

    const eligible = users.reduce((acc, u) => {
      const app = u.applications.find(a => String(a.jobOffer) === String(jobId));
      if (!app) return acc;
      if (app.rhApproved === 'approved' && app.techStatus === 'approved') {
        acc.push({
          _id: u._id,
          name: u.name || u.email,
          email: u.email,
          score: app.aiMatchScore || 0,
        });
      }
      return acc;
    }, []);

    if (!eligible.length) {
      return res.status(400).json({ message: 'No eligible candidates.' });
    }

    eligible.sort((a, b) => b.score - a.score);

    const assignments = [];
    const newlyUsedSlots = new Set();

    for (const cand of eligible) {
  let assignedSlot = null;

  // Vérifier si ce candidat a déjà une évaluation pour cette session
  const existingEval = session.candidateEvaluations.find(
    e => String(e.candidate) === String(cand._id)
  );

  // Si une évaluation existe déjà et qu'elle est en cours ou terminée, on la saute
  if (existingEval && (existingEval.status === 'in_progress' || existingEval.status === 'completed')) {
    console.log(`Candidate ${cand._id} already has an evaluation in progress/completed, skipping.`);
    continue;
  }

  for (const slot of slots) {
    const slotKey = `${slot.scheduledAt.toISOString()}_${slot.durationMinutes}`;
    if (usedSlots.has(slotKey) || newlyUsedSlots.has(slotKey)) continue;

    const hasOverlap = await _hasOverlappingInterview(
      cand._id, jobId, slot.scheduledAt, slot.durationMinutes, reqStage
    );

    if (!hasOverlap) {
      assignedSlot = slot;
      newlyUsedSlots.add(slotKey);
      break;
    }
  }

  if (!assignedSlot) {
    console.warn(`No conflict‑free slot for candidate ${cand._id}`);
    continue;
  }

  const criteriaForCandidate = gridToUse.map(c => ({
    label:       c.label,
    description: c.description || null,
    type:        c.type,
    weight:      c.weight,
    value:       null,
  }));

  // Mettre à jour ou créer l'évaluation
  if (existingEval) {
    // Mise à jour de l'évaluation existante (changement de créneau)
    await InterviewSession.updateOne(
      { _id: session._id, 'candidateEvaluations.candidate': cand._id },
      {
        $set: {
          'candidateEvaluations.$.scheduledAt':     assignedSlot.scheduledAt,
          'candidateEvaluations.$.durationMinutes': assignedSlot.durationMinutes,
          'candidateEvaluations.$.interviewType':   'video',
          'candidateEvaluations.$.status':          'scheduled',
          'candidateEvaluations.$.criteria':        criteriaForCandidate,
        }
      }
    );
  } else {
    // Création d'une nouvelle évaluation
    await InterviewSession.updateOne(
      { _id: session._id },
      {
        $push: {
          candidateEvaluations: {
            candidate:         cand._id,
            conductedBy:       req.user._id,
            scheduledAt:       assignedSlot.scheduledAt,
            durationMinutes:   assignedSlot.durationMinutes,
            interviewType:     'video',
            status:            'scheduled',
            criteria:          criteriaForCandidate,
          },
        },
      }
    );
  }

  const interviewKey = _interviewKeyForStage(reqStage);
  await User.updateOne(
    { _id: cand._id, 'applications.jobOffer': jobId },
    {
      $set: {
        [`applications.$.interviews.${interviewKey}`]: {
          scheduledAt: assignedSlot.scheduledAt,
          location:    null,
          type:        'video',
          notes:       null,
          completed:   false,
        },
        'applications.$.status': reqStage === 'rh' ? 'RH Interview' : 'Tech Interview',
      },
    }
  );

  assignments.push({
    candidateId:   cand._id,
    candidateName: cand.name,
    slot: assignedSlot,
    sessionId:     session._id,
  });

  await _notify(
    cand._id,
    'interview_scheduled',
    `You have been scheduled for a ${reqStage === 'technical evaluator' ? 'technical' : reqStage.toUpperCase()} interview on ${assignedSlot.date} at ${assignedSlot.startTime} for "${job.title}".`,
    jobId
  );
}

    if (assignments.length === 0) {
      return res.status(409).json({ message: 'No available slot without time conflict for any candidate.' });
    }

    res.json({ message: `${assignments.length} candidate(s) assigned.`, assignments });
  } catch (err) {
    console.error('[autoAssignSlots]', err);
    next(err);
  }
};

// ── Session CRUD (inchangé, mais avec gestion UTC) ───────────────────────────
exports.getSessions = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.jobId) filter.job   = req.query.jobId;
    if (req.query.stage) filter.stage = req.query.stage;

    const sessions = await InterviewSession.find(filter)
      .populate('candidateEvaluations.candidate', 'name email avatarColor')
      .populate('conductedBy', 'name email')
      .sort({ createdAt: 1 })
      .lean();

    if (req.query.date) {
      const datePrefix = req.query.date;
      return res.json(
        sessions.map(s => ({
          ...s,
          candidateEvaluations: s.candidateEvaluations.filter(
            e =>
              e.scheduledAt &&
              new Date(e.scheduledAt).toISOString().slice(0, 10) === datePrefix
          ),
        }))
      );
    }

    res.json(sessions);
  } catch (err) {
    next(err);
  }
};

exports.getSession = async (req, res, next) => {
  try {
    const session = await InterviewSession.findById(req.params.id)
      .populate('candidateEvaluations.candidate', 'name email avatarColor')
      .populate('job',         'title department')
      .populate('conductedBy', 'name email');
    if (!session) return res.status(404).json({ message: 'Session not found.' });
    res.json(session);
  } catch (err) {
    next(err);
  }
};

exports.startCandidateSession = async (req, res, next) => {
  try {
    const { id, candidateId } = req.params;
    const userRole = req.user.role;

    const session = await InterviewSession.findById(id);
    if (!session) return res.status(404).json({ message: 'Session not found.' });

    if (userRole !== 'admin' && session.stage !== _stageForRole(userRole)) {
      return res.status(403).json({ message: 'You cannot start a session for a different stage.' });
    }

    const result = await InterviewSession.findOneAndUpdate(
      { _id: id, 'candidateEvaluations.candidate': candidateId },
      {
        $set: {
          'candidateEvaluations.$.status':    'in_progress',
          'candidateEvaluations.$.startedAt': new Date(),
        },
      },
      { new: true }
    ).populate('candidateEvaluations.candidate', 'name email avatarColor');

    if (!result) return res.status(404).json({ message: 'Candidate evaluation not found.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.completeCandidateSession = async (req, res, next) => {
  try {
    const { id, candidateId } = req.params;
    const { criteria, overallRating, recommendation, comments } = req.body;
    const userRole = req.user.role;

    const session = await InterviewSession.findById(id)
      .populate('job', 'title createdBy');
    if (!session) return res.status(404).json({ message: 'Session not found.' });

    if (userRole !== 'admin' && session.stage !== _stageForRole(userRole)) {
      return res.status(403).json({ message: 'You cannot complete a session for a different stage.' });
    }

    const updateFields = {
      'candidateEvaluations.$.status':  'completed',
      'candidateEvaluations.$.endedAt': new Date(),
    };
    if (criteria       !== undefined) updateFields['candidateEvaluations.$.criteria']       = criteria;
    if (overallRating  !== undefined) updateFields['candidateEvaluations.$.overallRating']  = overallRating;
    if (recommendation !== undefined) updateFields['candidateEvaluations.$.recommendation'] = recommendation;
    if (comments       !== undefined) updateFields['candidateEvaluations.$.comments']       = comments;

    const updated = await InterviewSession.findOneAndUpdate(
      { _id: id, 'candidateEvaluations.candidate': candidateId },
      { $set: updateFields },
      { new: true }
    ).populate('candidateEvaluations.candidate', 'name email avatarColor');

    if (!updated) return res.status(404).json({ message: 'Candidate evaluation not found.' });

    const interviewKey = _interviewKeyForStage(session.stage);
    await User.updateOne(
      { _id: candidateId, 'applications.jobOffer': session.job._id },
      { $set: { [`applications.$.interviews.${interviewKey}.completed`]: true } }
    );

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.scheduleCandidateSession = async (req, res, next) => {
  try {
    const { id, candidateId } = req.params;
    const { scheduledAt, interviewType, location, notes } = req.body;
    const userRole = req.user.role;

    const session = await InterviewSession.findById(id);
    if (!session) return res.status(404).json({ message: 'Session not found.' });

    if (userRole !== 'admin' && session.stage !== _stageForRole(userRole)) {
      return res.status(403).json({ message: 'You cannot reschedule a session for a different stage.' });
    }

    let durationMinutes = 30;
    const rangeForDay = session.scheduledRanges?.find(r => r.date === scheduledAt.slice(0,10));
    if (rangeForDay) durationMinutes = rangeForDay.durationMinutes;

    const existingIndex = session.candidateEvaluations.findIndex(
      e => String(e.candidate) === String(candidateId)
    );

    const configKey = _configKeyForStage(session.stage);
    const job = await JobOffer.findById(session.job).select('interviewConfig');
    const stageConfig = job?.interviewConfig?.[configKey] || {};
    const grid = session.evaluationGrid?.length
      ? session.evaluationGrid
      : (stageConfig.evaluationGrid || []);

    const criteriaForCandidate = grid.map(c => ({
      label:       c.label,
      description: c.description || null,
      type:        c.type,
      weight:      c.weight,
      value:       null,
    }));

    if (existingIndex !== -1) {
      // Mise à jour de l'évaluation existante
      await InterviewSession.updateOne(
        { _id: id, 'candidateEvaluations.candidate': candidateId },
        {
          $set: {
            'candidateEvaluations.$.scheduledAt':     new Date(scheduledAt),
            'candidateEvaluations.$.durationMinutes': durationMinutes,
            'candidateEvaluations.$.interviewType':   interviewType || 'on-site',
            'candidateEvaluations.$.location':        location || null,
            'candidateEvaluations.$.notes':           notes    || null,
            'candidateEvaluations.$.status':          'scheduled',
            'candidateEvaluations.$.criteria':        criteriaForCandidate,
          },
        }
      );
    } else {
      // Création d'une nouvelle évaluation
      await InterviewSession.updateOne(
        { _id: id },
        {
          $push: {
            candidateEvaluations: {
              candidate:         candidateId,
              conductedBy:       req.user._id,
              scheduledAt:       new Date(scheduledAt),
              durationMinutes:   durationMinutes,
              interviewType:     interviewType || 'on-site',
              location:          location || null,
              notes:             notes    || null,
              status:            'scheduled',
              criteria:          criteriaForCandidate,
            },
          },
        }
      );
    }

    const interviewKey = _interviewKeyForStage(session.stage);
    await User.updateOne(
      { _id: candidateId, 'applications.jobOffer': session.job },
      {
        $set: {
          [`applications.$.interviews.${interviewKey}`]: {
            scheduledAt: new Date(scheduledAt),
            location:    location      || null,
            type:        interviewType || 'on-site',
            notes:       notes         || null,
            completed:   false,
          },
        },
      }
    );

    const updated = await InterviewSession.findById(id)
      .populate('candidateEvaluations.candidate', 'name email avatarColor');
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// ── Manual schedule via CandidateService ──────────────────────────────────────

exports.scheduleInterview = async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const { jobId, stage, scheduledAt, location, type: interviewType, notes } = req.body;
    const userRole = req.user.role;

    if (!jobId || !stage) {
      return res.status(400).json({ message: 'jobId and stage are required.' });
    }
    if (userRole !== 'admin' && stage !== _stageForRole(userRole)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const job = await JobOffer.findById(jobId).select('interviewConfig title');
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const configKey   = _configKeyForStage(stage);
    const stageConfig = job.interviewConfig?.[configKey] || {};

    let durationMinutes = 30;
    const rangeForDay = stageConfig.ranges?.find(r => r.date === new Date(scheduledAt).toISOString().slice(0,10));
    if (rangeForDay) durationMinutes = rangeForDay.durationMinutes;

    const hasOverlap = await _hasOverlappingInterview(
      candidateId, jobId, new Date(scheduledAt), durationMinutes, stage
    );
    if (hasOverlap) {
      return res.status(409).json({
        message: `Ce candidat a déjà un entretien pour l'autre étape (${stage === 'rh' ? 'Tech' : 'RH'}) qui chevauche la plage horaire demandée.`
      });
    }

    const session = await InterviewSession.findOneAndUpdate(
      { job: jobId, stage },
      {
        $setOnInsert: {
          job,
          stage,
          conductedBy:    req.user._id,
          evaluationGrid: stageConfig.evaluationGrid || [],
        },
      },
      { upsert: true, new: true }
    );

    const grid = session.evaluationGrid?.length
      ? session.evaluationGrid
      : (stageConfig.evaluationGrid || []);

    const alreadyExists = session.candidateEvaluations.some(
      e => String(e.candidate) === String(candidateId)
    );

    if (alreadyExists) {
      await InterviewSession.updateOne(
        { _id: session._id, 'candidateEvaluations.candidate': candidateId },
        {
          $set: {
            'candidateEvaluations.$.scheduledAt':     new Date(scheduledAt),
            'candidateEvaluations.$.durationMinutes': durationMinutes,
            'candidateEvaluations.$.interviewType':   interviewType || 'on-site',
            'candidateEvaluations.$.location':        location || null,
            'candidateEvaluations.$.notes':           notes    || null,
            'candidateEvaluations.$.status':          'scheduled',
          },
        }
      );
    } else {
      await InterviewSession.updateOne(
        { _id: session._id },
        {
          $push: {
            candidateEvaluations: {
              candidate:         candidateId,
              conductedBy:       req.user._id,
              scheduledAt:       new Date(scheduledAt),
              durationMinutes:   durationMinutes,
              interviewType:     interviewType || 'on-site',
              location:          location || null,
              notes:             notes    || null,
              status:            'scheduled',
              criteria: grid.map(c => ({
                label:       c.label,
                description: c.description || null,
                type:        c.type,
                weight:      c.weight,
                value:       null,
              })),
            },
          },
        }
      );
    }

    const interviewKey = _interviewKeyForStage(stage);
    await User.updateOne(
      { _id: candidateId, 'applications.jobOffer': jobId },
      {
        $set: {
          [`applications.$.interviews.${interviewKey}`]: {
            scheduledAt: new Date(scheduledAt),
            location:    location      || null,
            type:        interviewType || 'on-site',
            notes:       notes         || null,
            completed:   false,
          },
          'applications.$.status': stage === 'rh' ? 'RH Interview' : 'Tech Interview',
        },
      }
    );

    res.json({ message: 'Interview scheduled.', sessionId: session._id });
  } catch (err) {
    next(err);
  }
};

// ── Admin ─────────────────────────────────────────────────────────────────────

exports.getCandidateReport = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only.' });

    const { jobId, candidateId } = req.query;
    if (!jobId || !candidateId) {
      return res.status(400).json({ message: 'jobId and candidateId required.' });
    }

    const sessions = await InterviewSession.find({ job: jobId })
      .populate('candidateEvaluations.candidate', 'name email avatarColor')
      .populate('conductedBy', 'name email')
      .lean();

    const extract = (stage) => {
      const s = sessions.find(s => s.stage === stage);
      if (!s) return null;
      const eval_ = s.candidateEvaluations.find(
        e =>
          String(typeof e.candidate === 'object' ? e.candidate._id : e.candidate) ===
          String(candidateId)
      );
      return eval_ ? { ...eval_, sessionId: s._id, stage: s.stage } : null;
    };

    res.json({
      candidateId,
      rh:   extract('rh'),
      tech: extract('technical evaluator'),
    });
  } catch (err) {
    next(err);
  }
};

exports.adminFinalDecision = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only.' });

    const { jobId, candidateId, decision, notes, stage } = req.body;
    if (!['hire', 'reject'].includes(decision)) {
      return res.status(400).json({ message: "Decision must be 'hire' or 'reject'." });
    }

    const job = await JobOffer.findById(jobId).select('title');
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const stageFilter = stage ? { job: jobId, stage } : { job: jobId };
    await InterviewSession.updateMany(
      { ...stageFilter, 'candidateEvaluations.candidate': candidateId },
      {
        $set: {
          'candidateEvaluations.$.adminDecision': decision,
          'candidateEvaluations.$.adminNotes':    notes || null,
          'candidateEvaluations.$.decidedAt':     new Date(),
        },
      }
    );

    const newStatus = decision === 'hire' ? 'Accepted' : 'Rejected';
    await User.updateOne(
      { _id: candidateId, 'applications.jobOffer': jobId },
      {
        $set: {
          'applications.$.status':        newStatus,
          'applications.$.adminDecision': decision,
          'applications.$.adminNotes':    notes || null,
          'applications.$.decidedAt':     new Date(),
        },
      }
    );

    const msg =
      decision === 'hire'
        ? `Félicitations ! Vous avez été sélectionné(e) pour le poste "${job.title}".`
        : `Votre candidature pour le poste "${job.title}" n'a malheureusement pas été retenue.`;

    await _notify(candidateId, 'application_status_changed', msg, jobId);

    res.json({ message: `Decision '${decision}' applied to candidate ${candidateId}.` });
  } catch (err) {
    next(err);
  }
};

// ─── Suppression complète d'un stage (config + affectations) ──────────────────

exports.deleteStageConfig = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { stage } = req.query;
    const userRole = req.user.role;

    if (!stage || (stage !== 'rh' && stage !== 'technical evaluator')) {
      return res.status(400).json({ message: 'Stage must be "rh" or "technical evaluator".' });
    }

    if (userRole !== 'admin') {
      if (userRole === 'rh' && stage !== 'rh') {
        return res.status(403).json({ message: 'RH can only delete RH configuration.' });
      }
      if (userRole === 'technical evaluator' && stage !== 'technical evaluator') {
        return res.status(403).json({ message: 'Technical evaluator can only delete their own configuration.' });
      }
    }

    const job = await JobOffer.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const configKey = stage === 'technical evaluator' ? 'tech' : 'rh';
    if (job.interviewConfig && job.interviewConfig[configKey]) {
      job.interviewConfig[configKey] = { enabled: false, ranges: [], evaluationGrid: [] };
      job.markModified('interviewConfig');
      await job.save();
    }

    const session = await InterviewSession.findOne({ job: jobId, stage });
    if (session) {
      const candidateIds = session.candidateEvaluations
        .map(ev => ev.candidate?.toString())
        .filter(id => id);
      await InterviewSession.deleteOne({ _id: session._id });

      const interviewKey = stage === 'technical evaluator' ? 'tech' : 'rh';
      for (const candId of candidateIds) {
        await User.updateOne(
          { _id: candId, 'applications.jobOffer': jobId },
          { $unset: { [`applications.$.interviews.${interviewKey}`]: "" } }
        );
      }
    }

    res.json({ message: `All configuration and assignments for stage ${stage} have been deleted.` });
  } catch (err) {
    console.error('[deleteStageConfig]', err);
    next(err);
  }
};