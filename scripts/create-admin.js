#!/usr/bin/env node
'use strict';

/**
 * One-time script to create the first admin user.
 * Usage: MONGODB_URI=... node scripts/create-admin.js
 * Or with .env: node -r dotenv/config scripts/create-admin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URI_STANDARD;

async function main() {
  if (!MONGODB_URI) {
    console.error('Set MONGODB_URI or MONGODB_URI_STANDARD');
    process.exit(1);
  }
  const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@venue.local';
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || 'Admin@123';

  await mongoose.connect(MONGODB_URI);
  const User = require('../src/models/User');
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log('Admin already exists for', email);
    await mongoose.disconnect();
    process.exit(0);
    return;
  }
  await User.create({
    email: email.toLowerCase(),
    password,
    name: 'Admin',
    role: 'admin',
  });
  console.log('Admin created:', email);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
