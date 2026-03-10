'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const Venue = require('../models/Venue');
const Space = require('../models/Space');
const mongoose = require('mongoose');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

/** Ensure user can access this venue (Admin: any; Incharge: only their venueId). */
async function assertVenueAccess(event, venueId) {
  const user = await auth.verifyToken(auth.getAuthHeaders(event).authorization);
  if (!user) return;
  if (user.role === auth.ROLES.ADMIN) return;
  if (user.role === auth.ROLES.INCHARGE) {
    const User = require('../models/User');
    const u = await User.findById(user.sub).select('venueId').lean();
    if (u?.venueId?.toString() !== venueId) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }
}

/** Add space to a venue. */
async function postSpace(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  const venue = await Venue.findById(venueId).lean();
  if (!venue) return res.notFound('Venue not found');
  await assertVenueAccess(event, venueId);

  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const doc = await Space.create({
    venueId,
    name: body.name || '',
    description: body.description,
    capacity: body.capacity,
    dimensions: body.dimensions,
    isActive: body.isActive !== false,
    metadata: body.metadata || {},
  });
  return res.success(doc, 201);
}

/** List spaces for a venue. */
async function getSpaces(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  const venue = await Venue.findById(venueId).lean();
  if (!venue) return res.notFound('Venue not found');
  await assertVenueAccess(event, venueId);

  const vid = new mongoose.Types.ObjectId(String(venueId));
  const list = await Space.aggregate([
    { $match: { venueId: vid } },
    { $sort: { name: 1 } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
  ]);
  return res.success(list);
}

/** Get one space by ID. */
async function getSpaceById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  const spaceId = event.pathParameters?.spaceId;
  if (!venueId || !spaceId) return res.error('venueId and spaceId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = new mongoose.Types.ObjectId(String(venueId));
  const sid = new mongoose.Types.ObjectId(String(spaceId));
  const list = await Space.aggregate([
    { $match: { _id: sid, venueId: vid } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
  ]);
  const doc = list[0] || null;
  if (!doc) return res.notFound('Space not found');
  return res.success(doc);
}

/** Update a space. */
async function patchSpace(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  const spaceId = event.pathParameters?.spaceId;
  if (!venueId || !spaceId) return res.error('venueId and spaceId required', 400);
  await assertVenueAccess(event, venueId);

  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const allowed = ['name', 'description', 'capacity', 'dimensions', 'isActive', 'metadata'];
  const update = {};
  for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];

  const doc = await Space.findOneAndUpdate(
    { _id: spaceId, venueId },
    { $set: update },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Space not found');
  return res.success(doc);
}

/** Delete a space. */
async function deleteSpace(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  const spaceId = event.pathParameters?.spaceId;
  if (!venueId || !spaceId) return res.error('venueId and spaceId required', 400);
  await assertVenueAccess(event, venueId);

  const doc = await Space.findOneAndDelete({ _id: spaceId, venueId });
  if (!doc) return res.notFound('Space not found');
  return res.success({ deleted: true });
}

const routes = [
  { method: 'POST', path: '/venues/{venueId}/spaces', fn: postSpace },
  { method: 'GET', path: '/venues/{venueId}/spaces', fn: getSpaces },
  { method: 'GET', path: '/venues/{venueId}/spaces/{spaceId}', fn: getSpaceById },
  { method: 'PATCH', path: '/venues/{venueId}/spaces/{spaceId}', fn: patchSpace },
  { method: 'DELETE', path: '/venues/{venueId}/spaces/{spaceId}', fn: deleteSpace },
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
