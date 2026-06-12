'use strict';
// controllers/testRh.controller.js
// Module: RH Psychometric Tests — CRUD for test structure (themes → models → questions)

const JobTest      = require('../models/testRh.model');
const JobOffer     = require('../models/jobOffer.model');
const Notification = require('../models/notification.model');
const { getIO }    = require('../utils/socket');

const BUILTIN_MODELS = JobTest.schema.statics?.BUILTIN_MODELS
  || require('../models/testRh.model').BUILTIN_MODELS
  || {};

// ── Top-level Test ────────────────────────────────────────────────────────────

exports.getBuiltinModels = (req, res) => {
  res.json(JobTest.schema.statics.BUILTIN_MODELS || {});
};

exports.getTestByJob = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    res.json(test || null);
  } catch (err) {
    next(err);
  }
};

exports.createTest = async (req, res, next) => {
  try {
    const job = await JobOffer.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const existing = await JobTest.findOne({ job: req.params.jobId });
    if (existing) return res.status(409).json({ message: 'Test already exists for this job.', test: existing });

    const test = await JobTest.create({
      job:       req.params.jobId,
      name:      req.body.name || `${job.title} — Assessment`,
      description: req.body.description || '',
      status:    'draft',
      createdBy: req.user._id,
    });

    await JobOffer.findByIdAndUpdate(req.params.jobId, {
      $push: {
        tests: {
          category: req.body.category || 'personality',
          subType:  req.body.subType  || 'custom',
          label:    test.name,
          isCustom: true,
        },
      },
    });

    res.status(201).json(test);
  } catch (err) {
    next(err);
  }
};

exports.updateTest = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    const { name, description, status } = req.body;
    if (name        !== undefined) test.name        = name;
    if (description !== undefined) test.description = description;
    if (status      !== undefined) test.status      = status;

    await test.save();
    res.json(test);
  } catch (err) {
    next(err);
  }
};

exports.deleteTest = async (req, res, next) => {
  try {
    const test = await JobTest.findOneAndDelete({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });
    await JobOffer.findByIdAndUpdate(req.params.jobId, { $set: { tests: [] } });
    res.json({ message: 'Test deleted.' });
  } catch (err) {
    next(err);
  }
};

exports.completeTest = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    if (test.status === 'active') return res.json({ test, alreadyCompleted: true });

    test.status = 'active';
    await test.save();

    const job = await JobOffer.findById(req.params.jobId).select('createdBy title');
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const notification = await Notification.create({
      userId:  job.createdBy,
      type:    'rh_test_completed',
      message: `The RH assessment for "${job.title}" has been completed and is ready for review.`,
      jobId:   job._id,
      read:    false,
    });

    try { getIO().to(`user:${job.createdBy}`).emit('notification', notification); } catch (_) {}

    res.json({ test, notification });
  } catch (err) {
    next(err);
  }
};

// ── Themes ────────────────────────────────────────────────────────────────────

exports.addTheme = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    const { name, category } = req.body;
    if (!name || !category)
      return res.status(400).json({ message: 'name and category are required.' });

    test.themes.push({ name, category, models: [] });
    await test.save();
    res.status(201).json(test);
  } catch (err) {
    next(err);
  }
};

exports.deleteTheme = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    const theme = test.themes.id(req.params.themeId);
    if (!theme) return res.status(404).json({ message: 'Theme not found.' });

    theme.deleteOne();
    await test.save();
    res.json(test);
  } catch (err) {
    next(err);
  }
};

// ── Models (within a theme) ───────────────────────────────────────────────────

exports.addModel = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    const theme = test.themes.id(req.params.themeId);
    if (!theme) return res.status(404).json({ message: 'Theme not found.' });

    const { modelType, weight, customCriteria, label } = req.body;
    if (!modelType) return res.status(400).json({ message: 'modelType is required.' });

    const modelData = { modelType, weight: weight ?? 50, questions: [] };

    if (modelType === 'custom') {
      modelData.label          = label || 'Custom Model';
      modelData.customCriteria = customCriteria || [];
    } else if (BUILTIN_MODELS[modelType]) {
      modelData.label = BUILTIN_MODELS[modelType].label;
    }

    theme.models.push(modelData);
    await test.save();
    res.status(201).json(test);
  } catch (err) {
    next(err);
  }
};

exports.updateModel = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    const theme = test.themes.id(req.params.themeId);
    if (!theme) return res.status(404).json({ message: 'Theme not found.' });

    const model = theme.models.id(req.params.modelId);
    if (!model) return res.status(404).json({ message: 'Model not found.' });

    if (req.body.weight         !== undefined) model.weight         = req.body.weight;
    if (req.body.label          !== undefined) model.label          = req.body.label;
    if (req.body.customCriteria !== undefined) model.customCriteria = req.body.customCriteria;

    await test.save();
    res.json(test);
  } catch (err) {
    next(err);
  }
};

exports.deleteModel = async (req, res, next) => {
  try {
    const test = await JobTest.findOne({ job: req.params.jobId });
    if (!test) return res.status(404).json({ message: 'Test not found.' });

    const theme = test.themes.id(req.params.themeId);
    if (!theme) return res.status(404).json({ message: 'Theme not found.' });

    const model = theme.models.id(req.params.modelId);
    if (!model) return res.status(404).json({ message: 'Model not found.' });

    model.deleteOne();
    await test.save();
    res.json(test);
  } catch (err) {
    next(err);
  }
};

// ── Questions (within a model) ────────────────────────────────────────────────

/** Apply question fields from request body to a question document. */
function _applyQuestionFields(question, body) {
  const fields = [
    'text', 'answerType', 'options',
    'likertMin', 'likertMax', 'likertCriterionKey', 'likertReversed',
  ];
  fields.forEach(f => { if (body[f] !== undefined) question[f] = body[f]; });
}

/** Resolve theme → model → question or return 404. */
async function _resolveQuestion(jobId, themeId, modelId, questionId, res) {
  const test = await JobTest.findOne({ job: jobId });
  if (!test) { res.status(404).json({ message: 'Test not found.' }); return null; }

  const theme = test.themes.id(themeId);
  if (!theme) { res.status(404).json({ message: 'Theme not found.' }); return null; }

  const model = theme.models.id(modelId);
  if (!model) { res.status(404).json({ message: 'Model not found.' }); return null; }

  if (questionId) {
    const question = model.questions.id(questionId);
    if (!question) { res.status(404).json({ message: 'Question not found.' }); return null; }
    return { test, question };
  }
  return { test, model };
}

exports.addQuestion = async (req, res, next) => {
  try {
    const { jobId, themeId, modelId } = req.params;
    if (!req.body.text || !req.body.answerType) {
      return res.status(400).json({ message: 'text and answerType are required.' });
    }

    const resolved = await _resolveQuestion(jobId, themeId, modelId, null, res);
    if (!resolved) return;

    const q = { text: req.body.text, answerType: req.body.answerType, options: req.body.options || [] };
    _applyQuestionFields(q, req.body);
    resolved.model.questions.push(q);
    await resolved.test.save();
    res.status(201).json(resolved.test);
  } catch (err) {
    next(err);
  }
};

exports.updateQuestion = async (req, res, next) => {
  try {
    const { jobId, themeId, modelId, questionId } = req.params;
    const resolved = await _resolveQuestion(jobId, themeId, modelId, questionId, res);
    if (!resolved) return;

    _applyQuestionFields(resolved.question, req.body);
    await resolved.test.save();
    res.json(resolved.test);
  } catch (err) {
    next(err);
  }
};

exports.deleteQuestion = async (req, res, next) => {
  try {
    const { jobId, themeId, modelId, questionId } = req.params;
    const resolved = await _resolveQuestion(jobId, themeId, modelId, questionId, res);
    if (!resolved) return;

    resolved.question.deleteOne();
    await resolved.test.save();
    res.json(resolved.test);
  } catch (err) {
    next(err);
  }
};