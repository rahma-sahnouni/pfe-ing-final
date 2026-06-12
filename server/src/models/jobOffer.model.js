// jobOffer.model.js
const mongoose = require("mongoose");

const testRhRefSchema = new mongoose.Schema(
  {
    customTestId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomTest", default: null },
    category:     { type: String, enum: ["personality", "logic", "visual"], required: true },
    subType:      { type: String, required: true },
    label:        { type: String },
    duration:     { type: Number },
    minScore:     { type: Number, default: 0 },
    questionCount: { type: Number, default: 0 },
    difficulty:   { type: String, enum: ["easy", "medium", "hard"] },
    isCustom:     { type: Boolean, default: false },
  },
  { _id: false }
);

const prerequisiteSchema = new mongoose.Schema(
  {
    icon:        { type: String, default: "verified" },
    type: {
      type: String,
      enum: ["Certification", "Language", "Experience", "Education", "Location", "Custom"],
      required: true,
    },
    customLabel: { type: String, default: null },
    value:       String,
    role:        String,
    obligatory:  { type: Boolean, default: false },
  },
  { _id: false }
);

const skillSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true },
    minLevel:   { type: Number, min: 1, max: 5 },
    weight:     { type: Number, min: 0, max: 100 },
    obligatory: Boolean,
  },
  { _id: false }
);

const stageSchema = new mongoose.Schema(
  { label: String, evaluator: { type: String, default: null } },
  { _id: false }
);

const technicalTestRefSchema = new mongoose.Schema(
  {
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'TechnicalTest', required: true },
    order:  { type: Number, default: 0 },
  },
  { _id: false }
);

const testAssignmentSchema = new mongoose.Schema(
  {
    enabled:    { type: Boolean, default: false },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deadline:   { type: Date, default: null },
  },
  { _id: false }
);

const evaluationCriterionSchema = new mongoose.Schema(
  {
    label:       { type: String, required: true },
    description: { type: String, default: null },
    type: {
      type: String,
      enum: ['rating_5', 'rating_10', 'yes_no', 'text'],
      default: 'rating_5',
    },
    weight: { type: Number, default: 1, min: 0 },
  },
  { _id: true }
);

const interviewDayConfigSchema = new mongoose.Schema(
  {
    date:            { type: String, required: true },
    startTime:       { type: String, required: true },
    endTime:         { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 15 },
    breakMinutes:    { type: Number, default: 10, min: 0 },
  },
  { _id: false }
);

const testPeriodSchema = new mongoose.Schema(
  { start: { type: Date, default: null }, end: { type: Date, default: null } },
  { _id: false }
);

const interviewAssignmentSchema = new mongoose.Schema(
  {
    enabled:    { type: Boolean, default: false },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deadline:   { type: Date, default: null },
  },
  { _id: false }
);

const jobOfferSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Job title is required"] },
    department: {
      type: String,
      enum: {
        values: ["Engineering","Design","People","Marketing","Finance","Product","Security","Data"],
        message: "Invalid department: {VALUE}",
      },
    },
    location:    String,
    contractType: {
      type: String,
      enum: {
        values: ["Full-time","Part-time","Contract","Freelance","Internship","Apprenticeship"],
        message: "Invalid contract type: {VALUE}",
      },
    },
    experienceLevel: {
      type: String,
      enum: {
        values: ["Junior (0-2 years)","Mid-level (3-5 years)","Senior (5-8 years)","Lead / Staff (8+ years)","Principal / Architect"],
        message: "Invalid experience level: {VALUE}",
      },
    },
    description:    String,
    prerequisites: [prerequisiteSchema],
    skills:        [skillSchema],
    tests:         [testRhRefSchema],
    technicalTests: [technicalTestRefSchema],
    stages:        [stageSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "createdBy is required"],
    },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: {
      type: String,
      enum: { values: ["draft","open","paused","closed"], message: "Invalid status: {VALUE}" },
      default: "draft",
    },
    deadline:          Date,
    applicationsCount: { type: Number, default: 0 },

    embedding: {
      type:    [Number],
      default: null,
      select:  false,
    },
    embeddingUpdatedAt: { type: Date, default: null },

    testAssignments: {
      rhTest:        { type: testAssignmentSchema, default: () => ({}) },
      technicalTest: { type: testAssignmentSchema, default: () => ({}) },
    },
    intervAssignments: {
      rhTest:        { type: interviewAssignmentSchema, default: () => ({}) },
      technicalTest: { type: interviewAssignmentSchema, default: () => ({}) },
    },
    testPeriod: testPeriodSchema,

    interviewConfig: {
      enabled:        { type: Boolean, default: false },
      ranges:         [interviewDayConfigSchema],
      evaluationGrid: [evaluationCriterionSchema],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JobOffer", jobOfferSchema);