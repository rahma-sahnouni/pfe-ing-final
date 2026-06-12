'use strict';
// controllers/notification.controller.js
// Module: Notifications — fetch & mark-read

const Notification = require('../models/notification.model');

exports.getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const filter = { userId: req.user._id, read: false };

    // Si des types sont fournis, on filtre par type
    if (req.body.types && req.body.types.length > 0) {
      filter.type = { $in: req.body.types };
    }

    await Notification.updateMany(filter, { $set: { read: true } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};