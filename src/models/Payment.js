'use strict';

const mongoose = require('mongoose');

const PAYMENT_METHODS = ['cash', 'account'];
const PAYMENT_STATUSES = ['active', 'deleted'];

const paymentSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    method: { type: String, required: true, enum: PAYMENT_METHODS },

    receivedAt: { type: Date, required: true, default: Date.now },
    receivedByName: { type: String, required: true, trim: true },
    givenByName: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: '' },

    reminderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentReminder', default: null },

    status: { type: String, enum: PAYMENT_STATUSES, default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paymentSchema.index({ venueId: 1, leadId: 1, createdAt: -1 });
paymentSchema.index({ leadId: 1, receivedAt: -1 });

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;

