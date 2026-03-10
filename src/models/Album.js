'use strict';

const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    key: { type: String, default: '', trim: true },
    caption: { type: String, default: '', trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true, timestamps: true }
);

const albumSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    coverImage: { type: String, default: '' },
    photos: { type: [photoSchema], default: [] },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

albumSchema.index({ venueId: 1, name: 1 });
albumSchema.index({ venueId: 1, isActive: 1 });

module.exports = mongoose.models.Album || mongoose.model('Album', albumSchema);
