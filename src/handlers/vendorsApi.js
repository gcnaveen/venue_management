'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const Vendor = require('../models/Vendor');

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
    vendorId: p.vendorId ?? p.vendorid,
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

function sanitizeBankDetails(raw) {
  if (!raw || typeof raw !== 'object') return {
    bankName: '',
    beneficiaryName: '',
    bankPincode: '',
    accountNumber: '',
    ifscCode: '',
    branch: '',
  };
  return {
    bankName: raw.bankName != null ? String(raw.bankName).trim() : '',
    beneficiaryName: raw.beneficiaryName != null ? String(raw.beneficiaryName).trim() : '',
    bankPincode: raw.bankPincode != null ? String(raw.bankPincode).trim() : '',
    accountNumber: raw.accountNumber != null ? String(raw.accountNumber).trim() : '',
    ifscCode: raw.ifscCode != null ? String(raw.ifscCode).trim().toUpperCase() : '',
    branch: raw.branch != null ? String(raw.branch).trim() : '',
  };
}

async function assertVenueAccess(event, venueId) {
  const decoded = auth.requireAuth(event);
  if (decoded.role === auth.ROLES.ADMIN) return decoded;
  if (decoded.role === auth.ROLES.INCHARGE || decoded.role === auth.ROLES.OWNER) {
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

// ─── CRUD ───────────────────────────────────────────────────────────────────

async function postVendor(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);

  const name = body.name != null ? String(body.name).trim() : '';
  if (!name) return res.error('name is required', 400);

  const doc = await Vendor.create({
    venueId: vid,
    name,
    category: body.category != null ? String(body.category).trim() : (body.vendorType != null ? String(body.vendorType).trim() : ''),
    vendorType: body.vendorType != null ? String(body.vendorType).trim() : (body.category != null ? String(body.category).trim() : ''),
    paymentCategory: body.paymentCategory != null ? String(body.paymentCategory).trim().toLowerCase() : '',
    companyName: body.companyName != null ? String(body.companyName).trim() : '',
    legalCategory: body.legalCategory != null ? String(body.legalCategory).trim().toLowerCase() : '',
    address: body.address != null ? String(body.address).trim() : '',
    gst: body.gst != null ? String(body.gst).trim().toUpperCase() : '',
    pan: body.pan != null ? String(body.pan).trim().toUpperCase() : '',
    aadhar: body.aadhar != null ? String(body.aadhar).trim() : '',
    msmedNo: body.msmedNo != null ? String(body.msmedNo).trim() : '',
    contact: body.contact != null ? String(body.contact).trim() : '',
    contactName: body.contactName != null ? String(body.contactName).trim() : (body.contact != null ? String(body.contact).trim() : ''),
    phone: body.phone != null ? String(body.phone).trim() : '',
    alternatePhone: body.alternatePhone != null ? String(body.alternatePhone).trim() : '',
    email: body.email != null ? String(body.email).trim() : '',
    bankDetails: sanitizeBankDetails(body.bankDetails),
    notes: body.notes != null ? String(body.notes).trim() : '',
    isActive: body.isActive !== false,
    createdBy: toObjectId(decoded.sub),
  });

  return res.success(doc, 201);
}

async function getVendors(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const qs = event.queryStringParameters || {};
  const match = { venueId: vid };

  if (qs.isActive === 'true') match.isActive = true;
  if (qs.isActive === 'false') match.isActive = false;

  if (qs.category || qs.vendorType) {
    match.category = String(qs.category || qs.vendorType).trim();
  }

  const list = await Vendor.find(match).sort({ name: 1 }).lean();
  return res.success(list);
}

async function getVendorById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, vendorId } = parsePathParams(event);
  if (!venueId || !vendorId) return res.error('venueId and vendorId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const xid = toObjectId(vendorId);
  if (!vid || !xid) return res.error('Invalid venueId or vendorId', 400);

  const doc = await Vendor.findOne({ _id: xid, venueId: vid }).lean();
  if (!doc) return res.notFound('Vendor not found');
  return res.success(doc);
}

async function patchVendor(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, vendorId } = parsePathParams(event);
  if (!venueId || !vendorId) return res.error('venueId and vendorId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const xid = toObjectId(vendorId);
  if (!vid || !xid) return res.error('Invalid venueId or vendorId', 400);

  const body = parseBody(event);
  const update = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.error('name cannot be empty', 400);
    update.name = name;
  }
  if (body.category !== undefined) {
    update.category = String(body.category).trim();
    update.vendorType = String(body.category).trim();
  }
  if (body.vendorType !== undefined) {
    update.vendorType = String(body.vendorType).trim();
    update.category = String(body.vendorType).trim();
  }
  if (body.paymentCategory !== undefined) update.paymentCategory = String(body.paymentCategory).trim().toLowerCase();
  if (body.companyName !== undefined) update.companyName = String(body.companyName).trim();
  if (body.legalCategory !== undefined) update.legalCategory = String(body.legalCategory).trim().toLowerCase();
  if (body.address !== undefined) update.address = String(body.address).trim();
  if (body.gst !== undefined) update.gst = String(body.gst).trim().toUpperCase();
  if (body.pan !== undefined) update.pan = String(body.pan).trim().toUpperCase();
  if (body.aadhar !== undefined) update.aadhar = String(body.aadhar).trim();
  if (body.msmedNo !== undefined) update.msmedNo = String(body.msmedNo).trim();
  if (body.contact !== undefined) {
    update.contact = String(body.contact).trim();
    update.contactName = String(body.contact).trim();
  }
  if (body.contactName !== undefined) update.contactName = String(body.contactName).trim();
  if (body.phone !== undefined) update.phone = String(body.phone).trim();
  if (body.alternatePhone !== undefined) update.alternatePhone = String(body.alternatePhone).trim();
  if (body.email !== undefined) update.email = String(body.email).trim();
  if (body.bankDetails !== undefined) update.bankDetails = sanitizeBankDetails(body.bankDetails);
  if (body.notes !== undefined) update.notes = String(body.notes).trim();
  if (body.isActive !== undefined) update.isActive = Boolean(body.isActive);

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await Vendor.findOneAndUpdate(
    { _id: xid, venueId: vid },
    { $set: update },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Vendor not found');
  return res.success(doc);
}

async function deleteVendor(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, vendorId } = parsePathParams(event);
  if (!venueId || !vendorId) return res.error('venueId and vendorId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const xid = toObjectId(vendorId);
  if (!vid || !xid) return res.error('Invalid venueId or vendorId', 400);

  const deleted = await Vendor.findOneAndDelete({ _id: xid, venueId: vid }).lean();
  if (!deleted) return res.notFound('Vendor not found');
  return res.success({ deleted: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const routes = [
  { method: 'GET', path: '/venues/{venueId}/vendors', fn: getVendors },
  { method: 'POST', path: '/venues/{venueId}/vendors', fn: postVendor },
  { method: 'GET', path: '/venues/{venueId}/vendors/{vendorId}', fn: getVendorById },
  { method: 'PATCH', path: '/venues/{venueId}/vendors/{vendorId}', fn: patchVendor },
  { method: 'DELETE', path: '/venues/{venueId}/vendors/{vendorId}', fn: deleteVendor },
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

