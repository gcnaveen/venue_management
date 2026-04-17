'use strict';

const mongoose = require('mongoose');

const BOOKING_TYPES = ['venue_buyout', 'space_buyout'];
const QUOTE_STATUSES = ['draft', 'shared', 'accepted', 'confirmed', 'rejected'];

const inclusionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1 },
    maxQuantity: { type: Number, default: null },
  },
  { _id: false }
);

const addonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
  },
  { _id: false }
);

const totalsSchema = new mongoose.Schema(
  {
    venueBase: { type: Number, default: 0 },
    venueNet: { type: Number, default: 0 },
    venueGst: { type: Number, default: 0 },
    venueTotal: { type: Number, default: 0 },
    selectedAddonTotal: { type: Number, default: 0 },
    maintenanceCharge: { type: Number, default: 0 },
    addonTotal: { type: Number, default: 0 },
    addonGst: { type: Number, default: 0 },
    addonsTotalWithGst: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

const pricingSchema = new mongoose.Schema(
  {
    basePrice: { type: Number, required: true },
    inclusions: { type: [inclusionSchema], default: [] },
    addons: { type: [addonSchema], default: [] },
    maintenanceCharge: { type: Number, default: 0 },
    gstRate: { type: Number, default: 0.18 },
    discount: { type: Number, default: 0 },
    totals: { type: totalsSchema, default: () => ({}) },
  },
  { _id: false }
);

const eventWindowSchema = new mongoose.Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationHours: { type: Number, required: true },
  },
  { _id: false }
);

const quoteSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    bookingType: { type: String, required: true, enum: BOOKING_TYPES },
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },

    eventWindow: { type: eventWindowSchema, required: true },
    pricing: { type: pricingSchema, required: true },

    draft: { type: Boolean, default: true },
    confirmed: { type: Boolean, default: false },
    status: { type: String, enum: QUOTE_STATUSES, default: 'draft' },
  },
  { timestamps: true }
);

quoteSchema.index({ venueId: 1, leadId: 1 });
quoteSchema.index({ venueId: 1, status: 1 });
quoteSchema.index({ leadId: 1, createdAt: -1 });
quoteSchema.index({ venueId: 1, createdAt: -1 });

module.exports = mongoose.models.Quote || mongoose.model('Quote', quoteSchema);
module.exports.BOOKING_TYPES = BOOKING_TYPES;
module.exports.QUOTE_STATUSES = QUOTE_STATUSES;
