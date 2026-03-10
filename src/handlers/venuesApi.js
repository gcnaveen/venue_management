'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const Venue = require('../models/Venue');
const mongoose = require('mongoose');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

async function aggregateVenues(match) {
  return Venue.aggregate([
    { $match: match || {} },
    { $sort: { name: 1 } },
    {
      $lookup: {
        from: 'venueprofiles',
        localField: '_id',
        foreignField: 'venueId',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'contactpersons',
        localField: 'profile.contactPersons',
        foreignField: '_id',
        as: '_cpResolved',
      },
    },
    {
      $lookup: {
        from: 'contactpeople',
        localField: 'profile.contactPersons',
        foreignField: '_id',
        as: '_cpLegacy',
      },
    },
    {
      $addFields: {
        _cpMerged: {
          $reduce: {
            input: { $concatArrays: ['$_cpResolved', '$_cpLegacy'] },
            initialValue: [],
            in: {
              $cond: [
                {
                  $in: [
                    '$$this._id',
                    { $map: { input: '$$value', as: 'v', in: '$$v._id' } },
                  ],
                },
                '$$value',
                { $concatArrays: ['$$value', ['$$this']] },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        profile: {
          $cond: [
            { $ifNull: ['$profile', false] },
            { $mergeObjects: ['$profile', { contactPersons: '$_cpMerged' }] },
            null,
          ],
        },
      },
    },
    { $project: { _cpResolved: 0, _cpLegacy: 0, _cpMerged: 0 } },
  ]);
}

async function postVenue(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  if (!body?.name) return res.error('name is required', 400);
  const doc = await Venue.create({
    name: body.name || '',
    isActive: body.isActive !== false,
    metadata: body.metadata || {},
  });
  return res.success(doc, 201);
}

async function getVenues(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const query = {};
  const incharge = await auth.verifyToken(auth.getAuthHeaders(event).authorization);
  if (incharge && incharge.role === auth.ROLES.INCHARGE) {
    const User = require('../models/User');
    const u = await User.findById(incharge.sub).select('venueId').lean();
    if (u?.venueId) query._id = u.venueId;
  }
  const match = query._id ? { _id: new mongoose.Types.ObjectId(String(query._id)) } : {};
  const list = await aggregateVenues(match);
  return res.success(list);
}

async function getVenueById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  const list = await aggregateVenues({ _id: new mongoose.Types.ObjectId(String(venueId)) });
  const doc = list[0];
  if (!doc) return res.notFound('Venue not found');
  return res.success(doc);
}

async function patchVenue(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const allowed = ['name', 'isActive', 'metadata'];
  const update = {};
  for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];
  const doc = await Venue.findByIdAndUpdate(venueId, { $set: update }, { new: true }).lean();
  if (!doc) return res.notFound('Venue not found');
  return res.success(doc);
}

async function deleteVenue(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  const doc = await Venue.findByIdAndDelete(venueId);
  if (!doc) return res.notFound('Venue not found');
  return res.success({ deleted: true });
}

const routes = [
  { method: 'POST', path: '/venues', fn: postVenue },
  { method: 'GET', path: '/venues', fn: getVenues },
  { method: 'GET', path: '/venues/{venueId}', fn: getVenueById },
  { method: 'PATCH', path: '/venues/{venueId}', fn: patchVenue },
  { method: 'DELETE', path: '/venues/{venueId}', fn: deleteVenue },
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
