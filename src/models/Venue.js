'use strict';

const mongoose = require('mongoose');

const venueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

venueSchema.index({ name: 1 });
venueSchema.index({ isActive: 1 });

module.exports = mongoose.models.Venue || mongoose.model('Venue', venueSchema);
