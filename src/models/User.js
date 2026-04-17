'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'incharge', 'owner'];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: ROLES },
    isBlocked: { type: Boolean, default: false },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', default: null },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ venueId: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
