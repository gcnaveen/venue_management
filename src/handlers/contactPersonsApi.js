'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const ContactPerson = require('../models/ContactPerson');
const VenueProfile = require('../models/VenueProfile');
const mongoose = require('mongoose');

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

async function assertVenueAccess(event, venueId) {
  const decoded = auth.requireAuth(event);
  if (decoded.role === auth.ROLES.ADMIN) return;
  if (decoded.role === auth.ROLES.INCHARGE) {
    const User = require('../models/User');
    const u = await User.findById(decoded.sub).select('venueId').lean();
    if (u?.venueId?.toString() !== String(venueId)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const err = new Error('Forbidden');
  err.statusCode = 403;
  throw err;
}

async function ensureProfileHasContacts(venueId, contactPersonIds) {
  if (!Array.isArray(contactPersonIds) || contactPersonIds.length === 0) return;
  await VenueProfile.findOneAndUpdate(
    { venueId },
    { $addToSet: { contactPersons: { $each: contactPersonIds } } },
    { upsert: true, new: true }
  );
}

async function postContactPerson(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const body = parseBody(event);
  const name = body.name != null ? String(body.name).trim() : '';
  const designation = body.designation != null ? String(body.designation).trim() : '';
  const contactNumber = body.contactNumber != null ? String(body.contactNumber).trim() : '';
  const isActive = body.isActive !== false;
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  if (!name || !contactNumber) return res.error('name and contactNumber are required', 400);

  const doc = await ContactPerson.create({ venueId, name, designation, contactNumber, isActive, metadata });
  await ensureProfileHasContacts(venueId, [doc._id]);
  return res.success(doc, 201);
}

async function getContactPersons(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = new mongoose.Types.ObjectId(String(venueId));
  const list = await ContactPerson.aggregate([
    { $match: { venueId: vid } },
    { $sort: { createdAt: -1 } },
  ]);
  return res.success(list);
}

async function getContactPersonById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  const contactPersonId = event.pathParameters?.contactPersonId;
  if (!venueId || !contactPersonId) return res.error('venueId and contactPersonId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = new mongoose.Types.ObjectId(String(venueId));
  const cid = new mongoose.Types.ObjectId(String(contactPersonId));
  const doc = await ContactPerson.findOne({ _id: cid, venueId: vid }).lean();
  if (!doc) return res.notFound('Contact person not found');
  return res.success(doc);
}

async function patchContactPerson(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  const contactPersonId = event.pathParameters?.contactPersonId;
  if (!venueId || !contactPersonId) return res.error('venueId and contactPersonId required', 400);
  await assertVenueAccess(event, venueId);

  const body = parseBody(event);
  const allowed = ['name', 'designation', 'contactNumber', 'isActive', 'metadata'];
  const update = {};
  for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];
  if (update.name != null) update.name = String(update.name).trim();
  if (update.designation != null) update.designation = String(update.designation).trim();
  if (update.contactNumber != null) update.contactNumber = String(update.contactNumber).trim();

  const doc = await ContactPerson.findOneAndUpdate(
    { _id: contactPersonId, venueId },
    { $set: update },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Contact person not found');
  await ensureProfileHasContacts(venueId, [doc._id]);
  return res.success(doc);
}

async function deleteContactPerson(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  const contactPersonId = event.pathParameters?.contactPersonId;
  if (!venueId || !contactPersonId) return res.error('venueId and contactPersonId required', 400);
  await assertVenueAccess(event, venueId);

  const deleted = await ContactPerson.findOneAndDelete({ _id: contactPersonId, venueId }).lean();
  if (!deleted) return res.notFound('Contact person not found');
  await VenueProfile.findOneAndUpdate(
    { venueId },
    { $pull: { contactPersons: deleted._id } },
    { new: true }
  );
  return res.success({ deleted: true });
}

const routes = [
  { method: 'POST', path: '/venues/{venueId}/contact-persons', fn: postContactPerson },
  { method: 'GET', path: '/venues/{venueId}/contact-persons', fn: getContactPersons },
  { method: 'GET', path: '/venues/{venueId}/contact-persons/{contactPersonId}', fn: getContactPersonById },
  { method: 'PATCH', path: '/venues/{venueId}/contact-persons/{contactPersonId}', fn: patchContactPerson },
  { method: 'DELETE', path: '/venues/{venueId}/contact-persons/{contactPersonId}', fn: deleteContactPerson },
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

