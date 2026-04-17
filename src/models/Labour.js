'use strict';

const mongoose = require('mongoose');

const SHIFT_TYPES = ['day', 'night', 'both'];
const LABOUR_STATUSES = ['active', 'deleted'];

const labourSchema = new mongoose.Schema(
  {
    venueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venue',
      required: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
    },
    shiftType: {
      type: String,
      enum: SHIFT_TYPES,
      required: true,
      trim: true,
    },
    labourCount: {
      type: Number,
      required: true,
      min: 1,
    },
    dayRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    nightRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    taxableAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    gstIncluded: {
      type: Boolean,
      default: false,
    },
    gstRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    gstAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    status: {
      type: String,
      enum: LABOUR_STATUSES,
      default: 'active',
    },
  },
  { timestamps: true }
);

labourSchema.index({ venueId: 1, leadId: 1, date: -1 });

module.exports = mongoose.models.Labour || mongoose.model('Labour', labourSchema);
module.exports.SHIFT_TYPES = SHIFT_TYPES;
module.exports.LABOUR_STATUSES = LABOUR_STATUSES;
