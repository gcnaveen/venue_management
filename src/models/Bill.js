'use strict';

const mongoose = require('mongoose');

const PAYMENT_MODES = ['cash', 'account'];
const BILL_STATUSES = ['active', 'deleted'];

const emiStatusSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 1970, max: 3000 },
    emiAmount: { type: Number, required: true, min: 0 },
    paid: { type: Boolean, default: false },
    amountPaid: { type: Number, default: 0, min: 0 },
    remarks: { type: String, default: '', trim: true },
    paymentMode: { type: String, enum: PAYMENT_MODES, default: 'cash' },
    paymentDate: { type: Date, default: null },
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    name: { type: String, required: true, trim: true },
    emi_end_date: { type: Date, required: true },
    emiType: { type: String, required: true, trim: true },
    emiDate: { type: Date, required: true },
    defaultAmount: { type: Number, required: true, min: 0 },
    emiStatus: { type: [emiStatusSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: BILL_STATUSES, default: 'active' },
  },
  { timestamps: true }
);

billSchema.index({ venueId: 1, name: 1 });
billSchema.index({ venueId: 1, status: 1 });

module.exports = mongoose.models.Bill || mongoose.model('Bill', billSchema);
module.exports.PAYMENT_MODES = PAYMENT_MODES;
module.exports.BILL_STATUSES = BILL_STATUSES;
