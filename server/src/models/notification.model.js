const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
  message: { type: String },
  type:    { type: String },
  jobId:   { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer' },
  read:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);