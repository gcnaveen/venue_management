'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const PaymentReminder = require('../models/PaymentReminder');
const Payment = require('../models/Payment');
const Lead = require('../models/Lead');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

function parseBody(event) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  return body && typeof body === 'object' ? body : {};
}

function parsePathParams(event) {
  const p = event.pathParameters || {};
  return {
    venueId: p.venueId ?? p.venueid,
    leadId: p.leadId ?? p.leadid,
    reminderId: p.reminderId ?? p.reminderid,
    paymentId: p.paymentId ?? p.paymentid,
  };
}

function toObjectId(id) {
  if (id == null || id === '') return null;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (_) {
    return null;
  }
}

async function assertVenueAccess(event, venueId) {
  const decoded = auth.requireAuth(event);
  if (decoded.role === auth.ROLES.ADMIN) return decoded;
  if (decoded.role === auth.ROLES.INCHARGE) {
    const User = require('../models/User');
    const u = await User.findById(decoded.sub).select('venueId').lean();
    if (u?.venueId?.toString() !== String(venueId)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return decoded;
  }
  const err = new Error('Forbidden');
  err.statusCode = 403;
  throw err;
}

function sanitizeExpectedDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  // Normalize to midnight for date-only input (e.g. "2026-01-09")
  return d;
}

function sanitizeReceivedAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function sanitizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sanitizeMethod(value) {
  const m = value != null ? String(value).trim().toLowerCase() : '';
  if (!Payment.PAYMENT_METHODS.includes(m)) return null;
  return m;
}

// ─── Payment Reminders ───────────────────────────────────────────────────────

async function postPaymentReminder(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const body = parseBody(event);
  const amount = sanitizeAmount(body.expectedAmount);
  const expectedDate = sanitizeExpectedDate(body.expectedDate);
  if (amount == null) return res.error('expectedAmount must be a non-negative number', 400);
  if (!expectedDate) return res.error('expectedDate must be a valid date (YYYY-MM-DD or ISO)', 400);

  const lead = await Lead.findOne({ _id: lid, venueId: vid }).lean();
  if (!lead) return res.notFound('Lead not found for this venue');

  const doc = await PaymentReminder.create({
    venueId: vid,
    leadId: lid,
    expectedAmount: amount,
    expectedDate,
    status: 'pending',
  });

  return res.success(doc, 201);
}

async function getPaymentReminders(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const list = await PaymentReminder.find({ venueId: vid, leadId: lid })
    .sort({ expectedDate: 1, createdAt: 1 })
    .lean();

  return res.success(list);
}

async function getPaymentReminderById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, reminderId } = parsePathParams(event);
  if (!venueId || !leadId || !reminderId) return res.error('venueId, leadId and reminderId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const rid = toObjectId(reminderId);
  if (!vid || !lid || !rid) return res.error('Invalid id(s)', 400);

  const doc = await PaymentReminder.findOne({ _id: rid, venueId: vid, leadId: lid }).lean();
  if (!doc) return res.notFound('Payment reminder not found');
  return res.success(doc);
}

async function patchPaymentReminder(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, reminderId } = parsePathParams(event);
  if (!venueId || !leadId || !reminderId) return res.error('venueId, leadId and reminderId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const rid = toObjectId(reminderId);
  if (!vid || !lid || !rid) return res.error('Invalid id(s)', 400);

  const body = parseBody(event);
  const update = {};

  if (body.expectedAmount !== undefined) {
    const amount = sanitizeAmount(body.expectedAmount);
    if (amount == null) return res.error('expectedAmount must be a non-negative number', 400);
    update.expectedAmount = amount;
  }
  if (body.expectedDate !== undefined) {
    const expectedDate = sanitizeExpectedDate(body.expectedDate);
    if (!expectedDate) return res.error('expectedDate must be a valid date', 400);
    update.expectedDate = expectedDate;
  }

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await PaymentReminder.findOneAndUpdate(
    { _id: rid, venueId: vid, leadId: lid },
    { $set: update },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Payment reminder not found');
  return res.success(doc);
}

async function deletePaymentReminder(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, reminderId } = parsePathParams(event);
  if (!venueId || !leadId || !reminderId) return res.error('venueId, leadId and reminderId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const rid = toObjectId(reminderId);
  if (!vid || !lid || !rid) return res.error('Invalid id(s)', 400);

  const deleted = await PaymentReminder.findOneAndDelete({ _id: rid, venueId: vid, leadId: lid }).lean();
  if (!deleted) return res.notFound('Payment reminder not found');
  return res.success({ deleted: true });
}

// ─── Payments (received payments) ────────────────────────────────────────────

async function postPayment(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const lead = await Lead.findOne({ _id: lid, venueId: vid }).lean();
  if (!lead) return res.notFound('Lead not found for this venue');

  const body = parseBody(event);

  const amount = sanitizeAmount(body.amount);
  const method = sanitizeMethod(body.method);
  const receivedAt = sanitizeReceivedAt(body.receivedAt);
  const receivedByName = body.receivedByName != null ? String(body.receivedByName).trim() : '';
  const givenByName = body.givenByName != null ? String(body.givenByName).trim() : '';
  const notes = body.notes != null ? String(body.notes).trim() : '';

  if (amount == null) return res.error('amount must be a non-negative number', 400);
  if (!method) return res.error(`method must be one of: ${Payment.PAYMENT_METHODS.join(', ')}`, 400);
  if (!receivedAt) return res.error('receivedAt must be a valid ISO date-time', 400);
  if (!receivedByName) return res.error('receivedByName is required', 400);
  if (!givenByName) return res.error('givenByName is required', 400);

  let reminderId = null;
  if (body.reminderId) {
    const rid = toObjectId(body.reminderId);
    if (!rid) return res.error('Invalid reminderId', 400);
    const reminder = await PaymentReminder.findOne({ _id: rid, venueId: vid, leadId: lid }).lean();
    if (!reminder) return res.error('Payment reminder not found for this lead/venue', 400);
    reminderId = rid;
  }

  const doc = await Payment.create({
    venueId: vid,
    leadId: lid,
    amount,
    method,
    receivedAt,
    receivedByName,
    givenByName,
    notes,
    reminderId,
    createdBy: toObjectId(decoded.sub),
  });

  if (reminderId) {
    await PaymentReminder.findOneAndUpdate(
      { _id: reminderId, venueId: vid, leadId: lid },
      { $set: { status: 'received', paymentId: doc._id } }
    );
  }

  return res.success(doc, 201);
}

async function getPayments(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const qs = event.queryStringParameters || {};
  const match = { venueId: vid, leadId: lid, status: { $ne: 'deleted' } };

  if (qs.method) {
    const method = sanitizeMethod(qs.method);
    if (method) match.method = method;
  }

  if (qs.from) {
    const from = new Date(qs.from);
    if (!isNaN(from.getTime())) {
      match.receivedAt = match.receivedAt || {};
      match.receivedAt.$gte = from;
    }
  }
  if (qs.to) {
    const to = new Date(qs.to);
    if (!isNaN(to.getTime())) {
      match.receivedAt = match.receivedAt || {};
      match.receivedAt.$lte = to;
    }
  }

  const list = await Payment.find(match).sort({ receivedAt: -1, createdAt: -1 }).lean();
  return res.success(list);
}

async function patchPayment(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, paymentId } = parsePathParams(event);
  if (!venueId || !leadId || !paymentId) return res.error('venueId, leadId and paymentId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const pid = toObjectId(paymentId);
  if (!vid || !lid || !pid) return res.error('Invalid id(s)', 400);

  const body = parseBody(event);
  const update = {};

  if (body.amount !== undefined) {
    const amount = sanitizeAmount(body.amount);
    if (amount == null) return res.error('amount must be a non-negative number', 400);
    update.amount = amount;
  }
  if (body.method !== undefined) {
    const method = sanitizeMethod(body.method);
    if (!method) return res.error(`method must be one of: ${Payment.PAYMENT_METHODS.join(', ')}`, 400);
    update.method = method;
  }
  if (body.receivedAt !== undefined) {
    const receivedAt = sanitizeReceivedAt(body.receivedAt);
    if (!receivedAt) return res.error('receivedAt must be a valid ISO date-time', 400);
    update.receivedAt = receivedAt;
  }
  if (body.receivedByName !== undefined) {
    const receivedByName = String(body.receivedByName).trim();
    if (!receivedByName) return res.error('receivedByName cannot be empty', 400);
    update.receivedByName = receivedByName;
  }
  if (body.givenByName !== undefined) {
    const givenByName = String(body.givenByName).trim();
    if (!givenByName) return res.error('givenByName cannot be empty', 400);
    update.givenByName = givenByName;
  }
  if (body.notes !== undefined) {
    update.notes = String(body.notes).trim();
  }

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await Payment.findOneAndUpdate(
    { _id: pid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } },
    { $set: update },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Payment not found');
  return res.success(doc);
}

async function deletePayment(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, paymentId } = parsePathParams(event);
  if (!venueId || !leadId || !paymentId) return res.error('venueId, leadId and paymentId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const pid = toObjectId(paymentId);
  if (!vid || !lid || !pid) return res.error('Invalid id(s)', 400);

  const doc = await Payment.findOneAndUpdate(
    { _id: pid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted' } },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Payment not found');

  if (doc.reminderId) {
    await PaymentReminder.findOneAndUpdate(
      { _id: doc.reminderId, venueId: vid, leadId: lid, paymentId: doc._id },
      { $set: { status: 'pending' }, $unset: { paymentId: 1 } }
    );
  }

  return res.success({ deleted: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const routes = [
  // Reminders
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/payment-reminders', fn: getPaymentReminders },
  { method: 'POST', path: '/venues/{venueId}/leads/{leadId}/payment-reminders', fn: postPaymentReminder },
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/payment-reminders/{reminderId}', fn: getPaymentReminderById },
  { method: 'PATCH', path: '/venues/{venueId}/leads/{leadId}/payment-reminders/{reminderId}', fn: patchPaymentReminder },
  { method: 'DELETE', path: '/venues/{venueId}/leads/{leadId}/payment-reminders/{reminderId}', fn: deletePaymentReminder },
  // Payments
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/payments', fn: getPayments },
  { method: 'POST', path: '/venues/{venueId}/leads/{leadId}/payments', fn: postPayment },
  { method: 'PATCH', path: '/venues/{venueId}/leads/{leadId}/payments/{paymentId}', fn: patchPayment },
  { method: 'DELETE', path: '/venues/{venueId}/leads/{leadId}/payments/{paymentId}', fn: deletePayment },
];

function matchRoute(method, path) {
  const normalized = path.replace(/^\/api/, '') || '/';
  for (const r of routes) {
    if (r.method !== method) continue;
    const pattern = r.path.replace(/\{[\w]+\}/g, '[^/]+');
    if (new RegExp('^' + pattern + '$').test(normalized)) return r.fn;
  }
  return null;
}

async function handler(event, context) {
  const wrapped = res.withErrorHandler(async (evt) => {
    await connect();
    const method = getMethod(evt);
    const path = getPath(evt);
    const fn = matchRoute(method, path);
    if (!fn) return res.error('Not found', 404);
    return fn(evt);
  });
  return wrapped(event, context);
}

module.exports = { handler };

