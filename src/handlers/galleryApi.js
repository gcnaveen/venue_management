'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const Album = require('../models/Album');
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

function parsePathParams(event) {
  const p = event.pathParameters || {};
  return {
    venueId: p.venueId ?? p.venueid,
    albumId: p.albumId ?? p.albumid,
    photoId: p.photoId ?? p.photoid,
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
  if (decoded.role === auth.ROLES.ADMIN) return;
  if (decoded.role === auth.ROLES.INCHARGE || decoded.role === auth.ROLES.OWNER) {
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

// ─── Album CRUD ──────────────────────────────────────────────────────────────

async function postAlbum(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);
  const name = body.name != null ? String(body.name).trim() : '';
  if (!name) return res.error('name is required', 400);

  const doc = await Album.create({
    venueId: vid,
    name,
    description: body.description != null ? String(body.description).trim() : '',
    coverImage: body.coverImage != null ? String(body.coverImage).trim() : '',
    isActive: body.isActive !== false,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  });
  return res.success(doc, 201);
}

async function getAlbums(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const list = await Album.aggregate([
    { $match: { venueId: vid } },
    { $addFields: { photoCount: { $size: { $ifNull: ['$photos', []] } } } },
    { $sort: { createdAt: -1 } },
  ]);
  return res.success(list);
}

async function getAlbumById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, albumId } = parsePathParams(event);
  if (!venueId || !albumId) return res.error('venueId and albumId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const aid = toObjectId(albumId);
  if (!vid || !aid) return res.error('Invalid venueId or albumId', 400);

  const doc = await Album.findOne({ _id: aid, venueId: vid }).lean();
  if (!doc) return res.notFound('Album not found');
  return res.success(doc);
}

async function patchAlbum(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, albumId } = parsePathParams(event);
  if (!venueId || !albumId) return res.error('venueId and albumId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const aid = toObjectId(albumId);
  if (!vid || !aid) return res.error('Invalid venueId or albumId', 400);

  const body = parseBody(event);
  const allowed = ['name', 'description', 'coverImage', 'isActive', 'metadata'];
  const update = {};
  for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];
  if (update.name != null) update.name = String(update.name).trim();
  if (update.description != null) update.description = String(update.description).trim();
  if (update.coverImage != null) update.coverImage = String(update.coverImage).trim();

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await Album.findOneAndUpdate(
    { _id: aid, venueId: vid },
    { $set: update },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Album not found');
  return res.success(doc);
}

async function deleteAlbum(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, albumId } = parsePathParams(event);
  if (!venueId || !albumId) return res.error('venueId and albumId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const aid = toObjectId(albumId);
  if (!vid || !aid) return res.error('Invalid venueId or albumId', 400);

  const deleted = await Album.findOneAndDelete({ _id: aid, venueId: vid }).lean();
  if (!deleted) return res.notFound('Album not found');
  return res.success({ deleted: true });
}

// ─── Photo operations (sub-document) ────────────────────────────────────────

function sanitizePhoto(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = raw.url != null ? String(raw.url).trim() : '';
  if (!url) return null;
  return {
    url,
    key: raw.key != null ? String(raw.key).trim() : '',
    caption: raw.caption != null ? String(raw.caption).trim() : '',
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
  };
}

async function addPhotos(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, albumId } = parsePathParams(event);
  if (!venueId || !albumId) return res.error('venueId and albumId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const aid = toObjectId(albumId);
  if (!vid || !aid) return res.error('Invalid venueId or albumId', 400);

  const body = parseBody(event);
  const rawPhotos = Array.isArray(body.photos) ? body.photos : (body.url ? [body] : []);
  const photos = rawPhotos.map(sanitizePhoto).filter(Boolean);
  if (photos.length === 0) return res.error('At least one photo with url is required', 400);

  const doc = await Album.findOneAndUpdate(
    { _id: aid, venueId: vid },
    { $push: { photos: { $each: photos } } },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Album not found');
  return res.success(doc);
}

async function deletePhoto(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, albumId, photoId } = parsePathParams(event);
  if (!venueId || !albumId || !photoId) return res.error('venueId, albumId and photoId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const aid = toObjectId(albumId);
  const pid = toObjectId(photoId);
  if (!vid || !aid || !pid) return res.error('Invalid ID(s)', 400);

  const doc = await Album.findOneAndUpdate(
    { _id: aid, venueId: vid },
    { $pull: { photos: { _id: pid } } },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Album not found');
  return res.success(doc);
}

async function patchPhoto(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, albumId, photoId } = parsePathParams(event);
  if (!venueId || !albumId || !photoId) return res.error('venueId, albumId and photoId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const aid = toObjectId(albumId);
  const pid = toObjectId(photoId);
  if (!vid || !aid || !pid) return res.error('Invalid ID(s)', 400);

  const body = parseBody(event);
  const setFields = {};
  if (body.url != null) setFields['photos.$.url'] = String(body.url).trim();
  if (body.key != null) setFields['photos.$.key'] = String(body.key).trim();
  if (body.caption != null) setFields['photos.$.caption'] = String(body.caption).trim();
  if (body.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
    setFields['photos.$.sortOrder'] = Number(body.sortOrder);
  }

  if (Object.keys(setFields).length === 0) return res.error('At least one field required', 400);

  const doc = await Album.findOneAndUpdate(
    { _id: aid, venueId: vid, 'photos._id': pid },
    { $set: setFields },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Album or photo not found');
  return res.success(doc);
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const routes = [
  { method: 'POST', path: '/venues/{venueId}/gallery', fn: postAlbum },
  { method: 'GET', path: '/venues/{venueId}/gallery', fn: getAlbums },
  { method: 'GET', path: '/venues/{venueId}/gallery/{albumId}', fn: getAlbumById },
  { method: 'PATCH', path: '/venues/{venueId}/gallery/{albumId}', fn: patchAlbum },
  { method: 'DELETE', path: '/venues/{venueId}/gallery/{albumId}', fn: deleteAlbum },
  { method: 'POST', path: '/venues/{venueId}/gallery/{albumId}/photos', fn: addPhotos },
  { method: 'PATCH', path: '/venues/{venueId}/gallery/{albumId}/photos/{photoId}', fn: patchPhoto },
  { method: 'DELETE', path: '/venues/{venueId}/gallery/{albumId}/photos/{photoId}', fn: deletePhoto },
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
