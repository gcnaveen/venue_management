'use strict';

const mongoose = require('mongoose');

const DURATION_KEYS = ['12', '24', '36', '48'];

const rackRatesSchema = new mongoose.Schema(
  {
    '12': { type: String, default: '' },
    '24': { type: String, default: '' },
    '36': { type: String, default: '' },
    '48': { type: String, default: '' },
  },
  { _id: false }
);

const inclusionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    maxQuantity: { type: Number, default: null },
  },
  { _id: true }
);

const addonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    maxQuantity: { type: Number, default: null },
    prices: { type: rackRatesSchema, default: () => ({}) },
  },
  { _id: true }
);

const spacePricingSchema = new mongoose.Schema(
  {
    rackRates: { type: rackRatesSchema, default: () => ({}) },
    inclusions: { type: [inclusionSchema], default: [] },
    addons: { type: [addonSchema], default: [] },
  },
  { _id: false }
);

const venuePricingSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, unique: true },

    // Venue buyout
    buyoutOnly: { type: Boolean, default: false },
    rackRates: { type: rackRatesSchema, default: () => ({}) },
    inclusions: { type: [inclusionSchema], default: [] },
    addons: { type: [addonSchema], default: [] },

    // Space buyout
    spaceOnly: { type: Boolean, default: false },
    spacePricings: { type: Map, of: spacePricingSchema, default: () => new Map() },
  },
  { timestamps: true }
);

venuePricingSchema.index({ venueId: 1 });

module.exports = mongoose.models.VenuePricing || mongoose.model('VenuePricing', venuePricingSchema);
module.exports.DURATION_KEYS = DURATION_KEYS;
