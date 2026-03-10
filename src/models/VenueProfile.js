'use strict';

const mongoose = require('mongoose');

const venueProfileSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, unique: true },
    // Venue profile
    logo: { type: String, default: '' },
    venueName: { type: String, default: '', trim: true },
    tagline: { type: String, default: '', trim: true },
    description: { type: String, default: '' },
    address: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
      country: { type: String, default: '' },
    },
    googleMapUrl: { type: String, default: '' },
    // Contacts & social
    email: { type: String, default: '', trim: true },
    instagram: { type: String, default: '' },
    facebook: { type: String, default: '' },
    website: { type: String, default: '' },
    contactPersons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ContactPerson' }],
    // Legal
    legal: {
      businessName: { type: String, default: '', trim: true },
      gst: { type: String, default: '', trim: true },
    },
  },
  { timestamps: true }
);

venueProfileSchema.index({ venueId: 1 });

module.exports = mongoose.models.VenueProfile || mongoose.model('VenueProfile', venueProfileSchema);
