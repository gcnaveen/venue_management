'use strict';

const mongoose = require('mongoose');

const RELIGIONS = ['hindu', 'muslim', 'christian'];
const DAY_TYPES = ['most_auspicious', 'auspicious', 'less_auspicious'];

const calendarDaySchema = new mongoose.Schema(
  {
    religion: { type: String, required: true, enum: RELIGIONS, trim: true },
    type: { type: String, required: true, enum: DAY_TYPES, trim: true },
    date: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

calendarDaySchema.index({ religion: 1, date: 1 }, { unique: true });
calendarDaySchema.index({ religion: 1, type: 1 });
calendarDaySchema.index({ date: 1 });

module.exports = mongoose.models.CalendarDay || mongoose.model('CalendarDay', calendarDaySchema);
module.exports.RELIGIONS = RELIGIONS;
module.exports.DAY_TYPES = DAY_TYPES;
