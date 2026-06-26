const mongoose = require("mongoose");

/* ─── Response Option (per question) ─── */
const responseOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    score: { type: Number, default: 0 },
    criterionKey: { type: String, default: null },
  },
  { _id: false }
);

/* ─── Question ─── */
const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    answerType: {
      type: String,
      enum: ["single_choice", "likert", "multiple_choice", "drag_rank"],
      required: true,
    },
    options: [responseOptionSchema],

    /* Likert-specific */
    likertMin:        { type: String, default: "Strongly Disagree" },
    likertMax:        { type: String, default: "Strongly Agree" },
    likertCriterionKey: { type: String, default: null },
    likertReversed:   { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ─── Criterion (used by custom models) ─── */
const criterionSchema = new mongoose.Schema(
  {
    key:   { type: String, required: true },
    label: { type: String, required: true },
    color: { type: String, default: "#6366f1" },
  },
  { _id: false }
);

/* ─── Built-in model definitions ─── */
const BUILTIN_MODELS = {
  disc: {
    label: "DISC Behavioral Profile",
    criteria: [
      { key: "D", label: "Dominance",          color: "#ef4444" },
      { key: "I", label: "Influence",           color: "#f97316" },
      { key: "S", label: "Steadiness",          color: "#22c55e" },
      { key: "C", label: "Conscientiousness",   color: "#3b82f6" },
    ],
  },
  mbti: {
    label: "MBTI Cognitive Framework",
    criteria: [
      { key: "E_I", label: "Extraversion / Introversion", color: "#8b5cf6" },
      { key: "S_N", label: "Sensing / Intuition",         color: "#06b6d4" },
      { key: "T_F", label: "Thinking / Feeling",          color: "#f59e0b" },
      { key: "J_P", label: "Judging / Perceiving",        color: "#ec4899" },
    ],
  },
  big_five: {
    label: "Big Five (OCEAN)",
    criteria: [
      { key: "O", label: "Openness",           color: "#6366f1" },
      { key: "C", label: "Conscientiousness",  color: "#3b82f6" },
      { key: "E", label: "Extraversion",       color: "#f97316" },
      { key: "A", label: "Agreeableness",      color: "#22c55e" },
      { key: "N", label: "Neuroticism",        color: "#ef4444" },
    ],
  },
  eq_i: {
    label: "Emotional Intelligence (EQ-i)",
    criteria: [
      { key: "self_awareness",  label: "Self-Awareness",  color: "#8b5cf6" },
      { key: "self_regulation", label: "Self-Regulation", color: "#06b6d4" },
      { key: "motivation",      label: "Motivation",      color: "#f59e0b" },
      { key: "empathy",         label: "Empathy",         color: "#ec4899" },
      { key: "social_skills",   label: "Social Skills",   color: "#22c55e" },
    ],
  },
  custom: {
    label: "Custom Model",
    criteria: [],
  },
};

/* ─── Model within a Theme ─── */
const testModelSchema = new mongoose.Schema(
  {
    modelType: {
      type: String,
      enum: ["disc", "mbti", "big_five", "eq_i", "custom"],
      required: true,
    },
    label: {
      type: String,
      default: function () {
        return BUILTIN_MODELS[this.modelType]?.label ?? "Custom Model";
      },
    },
    weight:          { type: Number, min: 0, max: 100, default: 50 },
    customCriteria:  [criterionSchema],
    questions:       [questionSchema],
  },
  { timestamps: true }
);

/* ─── Theme ─── */
const themeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ["personality","motivation","behavior","logical_reasoning","emotional_intelligence","custom"],
      required: true,
    },
    models: [testModelSchema],
  },
  { timestamps: true }
);

/* ─── Job Test ─── */
const TestRhSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobOffer",
      required: true,
      unique: true,
    },
    name:        { type: String, required: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "active",
    },
    themes:           [themeSchema],
    timeLimitMinutes: { type: Number, default: null },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

TestRhSchema.statics.BUILTIN_MODELS = BUILTIN_MODELS;

module.exports = mongoose.model("TestRh", TestRhSchema);