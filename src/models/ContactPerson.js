'use strict';

const mongoose = require('mongoose');

const contactPersonSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    name: { type: String, required: true, trim: true },
    designation: { type: String, default: '', trim: true },
    contactNumber: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  // Explicit collection so $lookup in aggregations matches (Mongoose would default to "contactpeople").
  { timestamps: true, collection: 'contactpersons' }
);

contactPersonSchema.index({ venueId: 1, contactNumber: 1 });

module.exports =
  mongoose.models.ContactPerson || mongoose.model('ContactPerson', contactPersonSchema);

