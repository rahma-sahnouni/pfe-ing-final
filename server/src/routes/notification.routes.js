// routes/notification.routes.js
const express    = require('express');
const router     = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const {
  getNotifications,
  markAllRead
} = require('../controllers/notification.controller');

// GET  /api/notifications        — fetch all notifications for the logged-in user
router.get('/',        authenticate, getNotifications);

// PATCH /api/notifications/read  — mark all as read
router.patch('/read',  authenticate, markAllRead);

module.exports = router;