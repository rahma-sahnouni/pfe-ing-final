// models/testSubmission.model.js
const mongoose = require('mongoose');

/* ── RH Answer ── */
const rhAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    value: { type: mongoose.Schema.Types.Mixed }, // string | string[] | number
  },
  { _id: false }
);

/* ── QCM Answer ── */
const qcmAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOptions: [{ type: mongoose.Schema.Types.ObjectId }],
    openText: { type: String, default: null },
  },
  { _id: false }
);

/* ── Anti-Cheat Event ── */
const antiCheatEventSchema = new mongoose.Schema(
  {
    type:      { type: String },
    timestamp: { type: String },
    timeLabel: { type: String },
    count:     { type: Number },
    detail:    { type: String },
  },
  { _id: false }
);

/* ── Anti-Cheat Report ── */
const antiCheatReportSchema = new mongoose.Schema(
  {
    riskLevel:             { type: String, enum: ['low', 'medium', 'high'], default: null },
    totalSuspiciousEvents: { type: Number, default: 0 },
    focusLosses:           { type: Number, default: 0 },
    tabChanges:            { type: Number, default: 0 },
    pastes:                { type: Number, default: 0 },
    focusGains:            { type: Number, default: 0 },
    events:                { type: [antiCheatEventSchema], default: [] },
  },
  { _id: false }
);

/* ── Main Submission Schema ── */
const testSubmissionSchema = new mongoose.Schema(
  {
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobOffer',
      required: true,
    },

    /* ─ Type discriminator ─ */
    testKind: {
      type: String,
      enum: ['rh', 'technical'],
      required: true,
    },

    /* ─ Reference to the actual test ─ */
    rhTest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TestRh',
      default: null,
    },
    technicalTest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TechnicalTest',
      default: null,
    },

    /* ─ Answers ─ */
    rhAnswers: { type: [rhAnswerSchema], default: [] },

    // Technical: code submission
    code:             { type: String, default: null },
    language:         { type: String, default: null },
    timeSpentSeconds: { type: Number, default: null },
    complexity:       { type: mongoose.Schema.Types.Mixed, default: null },

    // Technical: QCM answers
    qcmAnswers: { type: [qcmAnswerSchema], default: [] },

    /* ─ Scoring ─ */
    score:          { type: Number, default: null, min: 0, max: 100 },
    maxScore:       { type: Number, default: null },
    scoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },

    /* ─ Anti-cheat ─ */
    antiCheatReport: { type: antiCheatReportSchema, default: null },

    /* ─ Status ─ */
    status: {
      type: String,
      enum: ['submitted', 'evaluated', 'pending_review'],
      default: 'submitted',
    },

    submittedAt: { type: Date, default: Date.now },
    evaluatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* One submission per (candidate, job, test) */
testSubmissionSchema.index(
  { candidate: 1, job: 1, rhTest: 1 },
  { unique: true, sparse: true }
);
testSubmissionSchema.index(
  { candidate: 1, job: 1, technicalTest: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('TestSubmission', testSubmissionSchema);