'use strict';

const mongoose = require('mongoose');

const EVENT_TYPES = [
  'wedding',
  'reception',
  'engagement',
  'birthday',
  'corporate',
  'conference',
  'exhibition',
  'beegaraoota',
  'other',
];

const LEAD_STATUSES = ['new', 'contacted', 'followup', 'visited', 'negotiation', 'won', 'lost'];
const EVENT_STATUSES = ['not_started', 'in_progress', 'confirmed', 'completed', 'cancelled'];

const leadSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referenceCode: { type: String, required: true, trim: true },

    eventType: { type: String, required: true, enum: EVENT_TYPES, trim: true },
    eventTypeOther: { type: String, default: '', trim: true },

    specialDay: {
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      durationHours: { type: Number, required: true },
    },

    expectedGuests: { type: Number, default: null },

    eventStatus: { type: String, enum: EVENT_STATUSES, default: 'not_started' },
    meetings: {
      type: [
        new mongoose.Schema(
          {
            meetingAt: { type: Date, required: true },
            notes: { type: String, default: '', trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    contact: {
      namePrefix: { type: String, default: '', trim: true },
      name: { type: String, required: true, trim: true },
      clientName: { type: String, default: '', trim: true },
      brideName: { type: String, default: '', trim: true },
      groomName: { type: String, default: '', trim: true },
      email: { type: String, default: '', trim: true },
      stateCityAddress: { type: String, default: '', trim: true },
      pan: { type: String, default: '', trim: true },
      gst: { type: String, default: '', trim: true },
      companyName: { type: String, default: '', trim: true },
      referredBy: { type: String, default: '', trim: true },
      referredByPhone: { type: String, default: '', trim: true },
      phone: { type: String, required: true, trim: true },
      altPhone: { type: String, default: '', trim: true },
    },

    status: { type: String, enum: LEAD_STATUSES, default: 'new' },
    notes: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

leadSchema.index({ venueId: 1, status: 1 });
leadSchema.index({ venueId: 1, createdAt: -1 });
leadSchema.index({ venueId: 1, 'specialDay.startAt': 1 });
leadSchema.index({ venueId: 1, referenceCode: 1 }, { unique: true });

module.exports = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.LEAD_STATUSES = LEAD_STATUSES;
module.exports.EVENT_STATUSES = EVENT_STATUSES;
