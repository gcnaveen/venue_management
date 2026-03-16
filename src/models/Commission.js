'use strict';

const mongoose = require('mongoose');

const COMMISSION_DIRECTIONS = ['outflow', 'inflow'];
const COMMISSION_METHODS = ['cash', 'account'];

const commissionSchema = new mongoose.Schema(
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

    direction: {
      type: String,
      enum: COMMISSION_DIRECTIONS,
      required: true,
      trim: true,
    },

    vendorName: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    method: {
      type: String,
      enum: COMMISSION_METHODS,
      required: true,
      trim: true,
    },

    givenDate: {
      type: Date,
      required: true,
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
      enum: ['active', 'deleted'],
      default: 'active',
    },
  },
  { timestamps: true }
);

commissionSchema.index({ venueId: 1, leadId: 1, direction: 1, givenDate: -1 });

module.exports = mongoose.models.Commission || mongoose.model('Commission', commissionSchema);
module.exports.COMMISSION_DIRECTIONS = COMMISSION_DIRECTIONS;
module.exports.COMMISSION_METHODS = COMMISSION_METHODS;

