'use strict';
// controllers/technicalTest.controller.js
// Module: Technical Tests — CRUD + job assignment

const TechnicalTest = require('../models/technical-test.model');
const JobOffer      = require('../models/jobOffer.model');
const Notification  = require('../models/notification.model');
const { getIO }     = require('../utils/socket');

function _handleValidationError(err, res) {
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      message: 'Validation failed',
      errors:  Object.values(err.errors).map(e => e.message),
    });
  }
  if (err.message?.includes('example') || err.message?.includes('question')) {
    return res.status(422).json({ message: err.message });
  }
  return res.status(500).json({ message: err.message });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

exports.createTest = async (req, res, next) => {
  try {
    const test = await new TechnicalTest({ ...req.body, createdBy: req.user._id }).save();
    res.status(201).json(test);
  } catch (err) {
    _handleValidationError(err, res);
  }
};

/** Create a test AND immediately assign it to a job in a single request. */
exports.createAndAssign = async (req, res, next) => {
  try {
    const { jobId, order, ...testData } = req.body;

    const test = await new TechnicalTest({ ...testData, createdBy: req.user._id }).save();

    const job = await JobOffer.findByIdAndUpdate(
      jobId,
      { $addToSet: { technicalTests: { testId: test._id, order: order ?? 0 } } },
      { new: true }
    ).populate('technicalTests.testId');

    if (!job) {
      await TechnicalTest.findByIdAndDelete(test._id);
      return res.status(404).json({ message: 'Job not found.' });
    }

    // Notify job creator
    try {
      const notification = await Notification.create({
        userId:  job.createdBy,
        type:    'technical_test_assigned',
        message: `A technical test "${test.title}" has been assigned to the job "${job.title}".`,
        jobId:   job._id,
        read:    false,
      });
      try { getIO().to(`user:${job.createdBy}`).emit('notification', notification); } catch (_) {}
    } catch (e) {
      console.error('[createAndAssign] notification error:', e.message);
    }

    res.status(201).json({ test, job });
  } catch (err) {
    _handleValidationError(err, res);
  }
};

exports.getMyTests = async (req, res, next) => {
  try {
    const filter = { createdBy: req.user._id };
    if (req.query.difficulty) filter.difficulty = req.query.difficulty;
    if (req.query.tag)        filter.tags       = req.query.tag;
    if (req.query.testType)   filter.testType   = req.query.testType;

    const tests = await TechnicalTest.find(filter).sort({ createdAt: -1 });
    res.json(tests);
  } catch (err) {
    next(err);
  }
};

exports.getTestById = async (req, res, next) => {
  try {
    const test = await TechnicalTest.findById(req.params.id).populate('createdBy', 'name email');
    if (!test) return res.status(404).json({ message: 'Test not found.' });
    res.json(test);
  } catch (err) {
    next(err);
  }
};

exports.updateTest = async (req, res, next) => {
  try {
    const test = await TechnicalTest.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!test) return res.status(404).json({ message: 'Test not found or unauthorized.' });
    res.json(test);
  } catch (err) {
    _handleValidationError(err, res);
  }
};

exports.deleteTest = async (req, res, next) => {
  try {
    const deleted = await TechnicalTest.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user._id,
    });
    if (!deleted) return res.status(404).json({ message: 'Test not found or unauthorized.' });
    res.json({ message: 'Test deleted.' });
  } catch (err) {
    next(err);
  }
};

// ── Job assignment ────────────────────────────────────────────────────────────

exports.assignTestToJob = async (req, res, next) => {
  try {
    const { testId, order } = req.body;

    if (!(await TechnicalTest.findById(testId))) {
      return res.status(404).json({ message: 'Test not found.' });
    }

    const job = await JobOffer.findByIdAndUpdate(
      req.params.jobId,
      { $addToSet: { technicalTests: { testId, order: order ?? 0 } } },
      { new: true }
    ).populate('technicalTests.testId');

    if (!job) return res.status(404).json({ message: 'Job not found.' });
    res.json(job);
  } catch (err) {
    next(err);
  }
};

exports.removeTestFromJob = async (req, res, next) => {
  try {
    const job = await JobOffer.findByIdAndUpdate(
      req.params.jobId,
      { $pull: { technicalTests: { testId: req.params.testId } } },
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    res.json(job);
  } catch (err) {
    next(err);
  }
};

exports.getTestsByJob = async (req, res, next) => {
  try {
    const job = await JobOffer.findById(req.params.jobId).populate('technicalTests.testId');
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const tests = job.technicalTests.map(t => ({ ...t.testId?.toObject(), order: t.order }));
    res.json(tests);
  } catch (err) {
    next(err);
  }
};