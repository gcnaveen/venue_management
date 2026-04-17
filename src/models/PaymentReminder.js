'use strict';

const mongoose = require('mongoose');

const REMINDER_STATUSES = ['pending', 'received'];

const paymentReminderSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    quoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null, index: true },

    expectedAmount: { type: Number, required: true, min: 0 },
    expectedDate: { type: Date, required: true },

    status: { type: String, enum: REMINDER_STATUSES, default: 'pending' },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  },
  { timestamps: true }
);

paymentReminderSchema.index({ venueId: 1, leadId: 1, expectedDate: 1 });
paymentReminderSchema.index({ venueId: 1, leadId: 1, quoteId: 1, expectedDate: 1 });

module.exports = mongoose.models.PaymentReminder || mongoose.model('PaymentReminder', paymentReminderSchema);
module.exports.REMINDER_STATUSES = REMINDER_STATUSES;

