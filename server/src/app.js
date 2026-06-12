const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');

const authRoutes            = require('./routes/auth.routes');
const errorHandler          = require('./middlewares/errorHandler');
const { globalRateLimiter } = require('./middlewares/rateLimiter');
const UserRoutes            = require('./routes/user.routes');
const candidateRoutes       = require('./routes/candidate.routes');
const jobTestRHRoutes       = require('./routes/testRH.routes');
const codeRunnerRoutes      = require('./routes/codeRunner.routes');
const notificationRoutes    = require('./routes/notification.routes'); // ← added

const fs = require('fs');
fs.mkdirSync('uploads/tests', { recursive: true });

const app = express();
app.set('trust proxy', 1);

app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origine non autorisée → ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS',"PATCH"],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Sanitisation NoSQL
app.use((req, res, next) => {
  const sanitizeObj = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$') || key.includes('.')) {
          delete obj[key];
        } else {
          sanitizeObj(obj[key]);
        }
      }
    }
  };
  sanitizeObj(req.body);
  next();
});

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use(globalRateLimiter);

// ── Routes ──
app.use('/api/auth',            authRoutes);
app.use('/api/admin/users',     UserRoutes);
app.use('/api/jobs',            require('./routes/jobOffer.routes'));
app.use('/api/candidates',      candidateRoutes);
app.use('/uploads',             express.static('uploads'));
app.use('/api/technical-tests', require('./routes/technical-test.routes'));
app.use('/api/job-tests',       jobTestRHRoutes);
app.use('/api/submissions',     require('./routes/testSubmission.routes'));
app.use('/api/code-runner',     codeRunnerRoutes);
app.use('/api/notifications',   notificationRoutes);            
// interview

const interviewSessionRoutes = require('./routes/interviewSession.routes');

app.use('/api/interview-sessions', interviewSessionRoutes);

// ── Also add these models to be loaded at startup (if you use explicit loading) ──
require('./models/interviewSession.model');

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route introuvable' });
});

app.use(errorHandler);

module.exports = app;