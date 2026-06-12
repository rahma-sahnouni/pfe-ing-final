'use strict';
// models/interviewSession.model.js
const mongoose = require('mongoose');

// ── Criterion value sub-schema ────────────────────────────────────────────────
// Stored per candidate inside candidateEvaluations[].criteria
// "value" is filled by the interviewer during the live session
const criterionValueSchema = new mongoose.Schema(
  {
    label:       { type: String, required: true },
    description: { type: String, default: null },
    type: {
      type:    String,
      enum:    ['rating_5', 'rating_10', 'yes_no', 'text'],
      default: 'rating_5',
    },
    weight: { type: Number, default: 1, min: 0 },
    value:  { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

// ── CandidateEvaluation sub-schema ────────────────────────────────────────────
// One entry per candidate inside a session document.
// Contains that candidate's schedule slot, live evaluation, and admin decision.
const candidateEvaluationSchema = new mongoose.Schema(
  {
    candidate:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conductedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Scheduling ──────────────────────────────────────────────────────────
    scheduledAt:   { type: Date,   default: null },
    interviewType: { type: String, enum: ['video', 'on-site', 'phone'], default: 'on-site' },
    location:      { type: String, default: null },
    notes:         { type: String, default: null },

    // ── Session lifecycle ───────────────────────────────────────────────────
    status:    { type: String, enum: ['scheduled', 'in_progress', 'completed'], default: 'scheduled' },
    startedAt: { type: Date, default: null },
    endedAt:   { type: Date, default: null },

    // ── Live evaluation (filled by the interviewer during the interview) ────
    // criteria is a copy of the session's evaluationGrid with values filled in
    criteria:       { type: [criterionValueSchema], default: [] },
    overallRating:  { type: Number, min: 0, max: 10, default: null },
    recommendation: { type: String, enum: ['hire', 'reject', 'consider', null], default: null },
    comments:       { type: String, default: null },

    // ── Admin final decision (scoped per candidate per stage) ──────────────
    adminDecision: { type: String, enum: ['hire', 'reject', null], default: null },
    adminNotes:    { type: String, default: null },
    decidedAt:     { type: Date,   default: null },
  },
  { _id: true }
);

// ── InterviewSession schema ───────────────────────────────────────────────────
// ONE document per job + stage (enforced by unique index).
// The evaluation grid template lives here; each candidate's filled-in values
// live in their own entry inside candidateEvaluations[].
const interviewSessionSchema = new mongoose.Schema(
  {
    job:   { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer', required: true },
    stage: { type: String, enum: ['rh', 'technical evaluator'], required: true },

    // Primary interviewer responsible for this stage
    conductedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Evaluation grid template (copied from interviewConfig at session creation)
    // Weights and criterion definitions live here; per-candidate values are in
    // candidateEvaluations[i].criteria[j].value
    evaluationGrid: [
      {
        label:       { type: String, required: true },
        description: { type: String, default: null },
        type:        { type: String, enum: ['rating_5', 'rating_10', 'yes_no', 'text'], default: 'rating_5' },
        weight:      { type: Number, default: 1, min: 0 },
      },
    ],

    // Available time slot ranges for this stage (from the config)
    scheduledRanges: [
      {
        date:            { type: String },  // YYYY-MM-DD
        startTime:       { type: String },  // HH:MM
        endTime:         { type: String },  // HH:MM
        durationMinutes: { type: Number },
        breakMinutes:    { type: Number },
      },
    ],

    // One sub-document per candidate assigned to this stage
    candidateEvaluations: { type: [candidateEvaluationSchema], default: [] },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Exactly one session per job+stage
interviewSessionSchema.index({ job: 1, stage: 1 }, { unique: true });
// Fast lookup: find which session contains a given candidate
interviewSessionSchema.index({ 'candidateEvaluations.candidate': 1, job: 1 });

module.exports = mongoose.model('InterviewSession', interviewSessionSchema);