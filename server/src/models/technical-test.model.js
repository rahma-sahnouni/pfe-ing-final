// models/technical-test.model.js
const mongoose = require('mongoose');

/* ── Shared sub-schemas ── */

/**
 * exampleSchema — input est toujours un OBJET JSON structuré.
 *
 * Exemples valides stockés :
 *   { nums: [2,7,11,15], target: 9 }          ← two sum
 *   { grid: [[1,0],[0,1]], k: 2 }              ← matrix
 *   { s: "hello world", t: "world" }           ← strings
 *   { n: 5 }                                   ← single int
 *   { input: "3 3 2\nS00\n010\n00E" }          ← grid encodée
 *
 * Le champ `input` est mongoose.Schema.Types.Mixed pour accepter
 * n'importe quelle structure JSON (objet, tableau, primitif).
 * Le champ `output` est aussi Mixed (peut être int, tableau, string…).
 */
const exampleSchema = new mongoose.Schema(
  {
    // Toujours un objet { paramName: value, … } après normalisation
    input: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      validate: {
        validator: function (v) {
          // Doit être un objet non-null (pas un tableau, pas une primitive)
          return (
            v !== null &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            Object.keys(v).length > 0
          );
        },
        message:
          'input must be a non-empty object like { nums: [1,2], target: 3 }',
      },
    },
    // Peut être n'importe quoi : number, string, boolean, array, object
    output: { type: mongoose.Schema.Types.Mixed, required: true },
    explanation: { type: String, default: null },
  },
  { _id: false }
);

const constraintSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
  },
  { _id: false }
);

/* ── QCM sub-schemas ── */
const qcmOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

const qcmQuestionSchema = new mongoose.Schema(
  {
    questionText: { type: String, required: true },
    type: {
      type: String,
      enum: ['single_choice', 'multiple_choice', 'open'],
      required: true,
    },
    options: { type: [qcmOptionSchema], default: [] },
    correctAnswer: { type: String, default: null },
    points: { type: Number, default: 1, min: 0 },
  },
  { _id: true }
);

/* ── Main schema ── */
const technicalTestSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, sparse: true, lowercase: true },
    description: { type: String, default: '' },
    testType: {
      type: String,
      enum: ['problem_solving', 'qcm', 'mixed'],
      required: true,
      default: 'problem_solving',
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      required: true,
    },
    timeLimitMinutes: { type: Number, required: true, min: 5, max: 360 },
    problemSolving: {
      examples: { type: [exampleSchema], default: [] },
      constraints: { type: [constraintSchema], default: [] },
      expectedComplexity: { type: String, default: null },
    },
    qcm: {
      questions: { type: [qcmQuestionSchema], default: [] },
    },
    tags: [{ type: String, trim: true }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ── Validation by testType ── */
technicalTestSchema.pre('validate', function () {
  const t = this.testType;
  const hasPS = t === 'problem_solving' || t === 'mixed';
  const hasQCM = t === 'qcm' || t === 'mixed';

  if (
    hasPS &&
    (!this.problemSolving?.examples || this.problemSolving.examples.length === 0)
  ) {
    throw new Error('Problem-solving tests require at least one example.');
  }
  if (
    hasQCM &&
    (!this.qcm?.questions || this.qcm.questions.length === 0)
  ) {
    throw new Error('QCM tests require at least one question.');
  }
});

/* ── Auto slug ── */
technicalTestSchema.pre('save', function () {
  if (this.isModified('title')) {
    this.slug =
      this.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Date.now();
  }
});

module.exports = mongoose.model('TechnicalTest', technicalTestSchema);