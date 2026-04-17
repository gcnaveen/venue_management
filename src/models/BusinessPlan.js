'use strict';

const mongoose = require('mongoose');

const ROW_TYPES = ['venue_buyout', 'space'];
const DURATION_KEYS = ['12', '24', '36', '48'];

const durationPlanSchema = new mongoose.Schema(
  {
    expectedBookings: { type: Number, default: 0, min: 0 },
    expectedBusiness: { type: Number, default: 0, min: 0 },
    expectedExpenses: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const businessPlanRowSchema = new mongoose.Schema(
  {
    rowType: { type: String, enum: ROW_TYPES, required: true },
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },
    spaceName: { type: String, required: true, trim: true },
    durations: {
      type: new mongoose.Schema(
        {
          '12': { type: durationPlanSchema, default: () => ({}) },
          '24': { type: durationPlanSchema, default: () => ({}) },
          '36': { type: durationPlanSchema, default: () => ({}) },
          '48': { type: durationPlanSchema, default: () => ({}) },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    expectedBookings: { type: Number, default: 0, min: 0 },
    expectedBusiness: { type: Number, default: 0, min: 0 },
    expectedExpenses: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const businessPlanSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2020, max: 2040 },
    rows: { type: [businessPlanRowSchema], default: [] },
  },
  { timestamps: true }
);

businessPlanSchema.index({ venueId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.models.BusinessPlan || mongoose.model('BusinessPlan', businessPlanSchema);
module.exports.ROW_TYPES = ROW_TYPES;
module.exports.DURATION_KEYS = DURATION_KEYS;
