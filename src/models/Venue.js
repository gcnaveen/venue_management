'use strict';

const mongoose = require('mongoose');

const venueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    address: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
    },
    contactEmail: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

venueSchema.index({ name: 1 });
venueSchema.index({ isActive: 1 });

module.exports = mongoose.models.Venue || mongoose.model('Venue', venueSchema);
