'use strict';

const mongoose = require('mongoose');

const spaceSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    capacity: { type: Number, default: null },
    dimensions: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

spaceSchema.index({ venueId: 1 });
spaceSchema.index({ venueId: 1, name: 1 });
spaceSchema.index({ isActive: 1 });

module.exports = mongoose.models.Space || mongoose.model('Space', spaceSchema);
