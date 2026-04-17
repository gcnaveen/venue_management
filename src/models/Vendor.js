'use strict';

const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    venueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venue',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    vendorType: {
      type: String,
      trim: true,
      default: '',
    },
    paymentCategory: {
      type: String,
      trim: true,
      default: '',
    },
    companyName: {
      type: String,
      trim: true,
      default: '',
    },
    legalCategory: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    gst: {
      type: String,
      trim: true,
      default: '',
    },
    pan: {
      type: String,
      trim: true,
      default: '',
    },
    aadhar: {
      type: String,
      trim: true,
      default: '',
    },
    msmedNo: {
      type: String,
      trim: true,
      default: '',
    },
    contact: {
      type: String,
      trim: true,
      default: '',
    },
    contactName: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    alternatePhone: {
      type: String,
      trim: true,
      default: '',
    },
    bankDetails: {
      bankName: { type: String, trim: true, default: '' },
      beneficiaryName: { type: String, trim: true, default: '' },
      bankPincode: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      ifscCode: { type: String, trim: true, default: '' },
      branch: { type: String, trim: true, default: '' },
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

vendorSchema.index({ venueId: 1, name: 1 });

module.exports = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);

