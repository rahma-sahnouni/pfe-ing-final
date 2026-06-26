const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const languageSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true },
    code:  { type: String, required: true, minlength: 2, maxlength: 5 },
    level: { type: String, default: null },
  },
  { _id: false }
);

const educationItemSchema = new mongoose.Schema(
  {
    degree:      { type: String, default: null },
    institution: { type: String, default: null },
    year:        { type: String, default: null },
  },
  { _id: false }
);

const experienceItemSchema = new mongoose.Schema(
  {
    title:       { type: String, default: null },
    company:     { type: String, default: null },
    duration:    { type: String, default: null },
    description: { type: String, default: null },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema(
  {
    email: {
      type:      String,
      required:  [true, "L'email est obligatoire"],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, "Format d'email invalide"],
    },
    password: {
      type:      String,
      required:  [true, 'Le mot de passe est obligatoire'],
      minlength: [8, 'Le mot de passe doit contenir au moins 8 caractères'],
      select:    false,
    },
    role: {
      type:    String,
      enum:    { values: ['admin', 'rh', 'candidate', 'technical evaluator'], message: 'Rôle invalide : {VALUE}' },
      default: 'candidate',
    },
    isActive: { type: Boolean, default: true },

    loginAttempts:     { type: Number,   default: 0 },
    lockUntil:         { type: Date,     default: null },
    refreshTokens:     { type: [String], select: false, default: [] },
    lastLogin:         { type: Date,     default: null },
    passwordChangedAt: { type: Date,     default: null },

    // ── Password reset (stocké dans User, pas de modèle séparé) ───────────
    passwordResetToken:   { type: String, default: null, select: false },
    passwordResetExpires: { type: Date,   default: null, select: false },

    name:       { type: String, trim: true, default: null },
    phone:      { type: String, trim: true, default: null },
    location:   { type: String, default: null },
    experience: { type: Number, default: 0, min: 0 },
    score:      { type: Number, default: 0, min: 0, max: 100 },

    applications: [{
      jobOffer: {
        type:     mongoose.Schema.Types.ObjectId,
        ref:      'JobOffer',
        required: true,
      },
      appliedDate:  { type: Date,   default: Date.now },
      status: {
        type:    String,
        enum:    ['Pending', 'In Review', 'RH Interview', 'Tech Interview', 'Accepted', 'Rejected'],
        default: 'Pending',
      },
      aiMatchScore:   { type: Number,   default: null },
      matchedSkills:  { type: [String], default: [] },
      missingSkills:  { type: [String], default: [] },
      prereqDetails:  { type: [Object], default: [] },
      scoreBreakdown: { type: Object,   default: null },
      recommendation: { type: String,   default: null },
      preSelected:  { type: Boolean, default: false },
      rhApproved:   { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      techStatus:   { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      interviews: {
        rh: {
          scheduledAt: { type: Date,   default: null },
          location:    { type: String, default: null },
          type:        { type: String, enum: ['on-site', 'video', 'phone', null], default: null },
          notes:       { type: String, default: null },
          completed:   { type: Boolean, default: false },
        },
        tech: {
          scheduledAt: { type: Date,   default: null },
          location:    { type: String, default: null },
          type:        { type: String, enum: ['on-site', 'video', 'phone', null], default: null },
          notes:       { type: String, default: null },
          completed:   { type: Boolean, default: false },
        },
      },
    }],

    cv: {
      path:         String,
      originalName: String,
      uploadedAt:   Date,
    },

    cvExtracted: {
      name:            { type: String,               default: null },
      email:           { type: String,               default: null },
      phone:           { type: String,               default: null },
      location:        { type: String,               default: null },
      summary:         { type: String,               default: null },
      skills:          { type: [String],             default: [] },
      languages:       { type: [languageSchema],     default: [] },
      certifications:  { type: [String],             default: [] },
      education:       { type: [educationItemSchema],   default: [] },
      experience:      { type: [experienceItemSchema],  default: [] },
      yearsExperience: { type: Number,               default: 0 },
    },

    cvEmbedding: {
      type:    [Number],
      default: null,
      select:  false,
    },

    cvRawText: {
      type:    String,
      default: null,
      select:  false,
    },
    cvRawTextExpiresAt: {
      type:    Date,
      default: null,
      index:   { expireAfterSeconds: 0 },
    },

    avatarColor: {
      type:    String,
      default: 'linear-gradient(135deg,#4f6ef7,#7c3aed)',
    },
  },
  { timestamps: true }
);

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_LOGIN_ATTEMPTS    = 5;
const LOCK_DURATION_MINUTES = 15;
const CV_RAW_TEXT_TTL_DAYS  = 365;

// ─── Hooks ────────────────────────────────────────────────────────────────────

userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    const saltRounds       = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;
    this.password          = await bcrypt.hash(this.password, saltRounds);
    this.passwordChangedAt = new Date();
  }

  if (this.isModified('cvRawText') && this.cvRawText) {
    const expires = new Date();
    expires.setDate(expires.getDate() + CV_RAW_TEXT_TTL_DAYS);
    this.cvRawTextExpiresAt = expires;
  }

  if (this.isModified('applications')) {
    const scores = this.applications
      .map(a => a.aiMatchScore)
      .filter(s => typeof s === 'number' && !isNaN(s));
    if (scores.length) {
      this.score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
  }
});

// ─── Methods ──────────────────────────────────────────────────────────────────

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

userSchema.methods.incLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS && !this.isLocked()) {
    updates.$set = { lockUntil: new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000) };
  }
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set:   { loginAttempts: 0, lastLogin: new Date() },
    $unset: { lockUntil: 1 },
  });
};

userSchema.methods.toSafeObject = function () {
  const base = {
    id:        this._id,
    email:     this.email,
    role:      this.role,
    isActive:  this.isActive,
    lastLogin: this.lastLogin,
    createdAt: this.createdAt,
    name:      this.name,
  };

  if (this.role === 'candidate') {
    return {
      ...base,
      phone:        this.phone,
      location:     this.location,
      experience:   this.experience,
      score:        this.score,
      applications: this.applications,
      cv:           this.cv,
      cvExtracted:  this.cvExtracted,
      avatarColor:  this.avatarColor,
    };
  }

  return base;
};

module.exports = mongoose.model('User', userSchema);