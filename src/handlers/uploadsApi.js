'use strict';

const auth = require('../lib/auth');
const res = require('../lib/response');
const s3 = require('../lib/s3');

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

/**
 * POST /api/uploads/presign
 *
 * Body:
 *   fileName    string  required  Original filename (sanitized server-side)
 *   contentType string  required  MIME type, e.g. "image/jpeg"
 *   entityType  string  optional  e.g. "venue", "space" (used as sub-folder label only)
 *   entityId    string  optional  MongoDB _id of the entity (used in S3 key path)
 *   expiresIn   number  optional  Seconds for presigned URL validity (default 900 = 15 min)
 *
 * Response:
 *   uploadUrl   string  Presigned PUT URL — use this to PUT the file directly from the client
 *   key         string  S3 object key — save this against your entity in DB
 *   publicUrl   string  Public HTTPS URL to read the file after upload
 *   expiresIn   number  Seconds the presigned URL is valid for
 */
async function postPresign(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);

  const body = parseBody(event);
  const fileName = body.fileName != null ? String(body.fileName).trim() : '';
  const contentType = body.contentType != null ? String(body.contentType).trim() : '';
  const entityId = body.entityId != null ? String(body.entityId).trim() : 'misc';
  const expiresIn = Number.isFinite(Number(body.expiresIn)) && Number(body.expiresIn) > 0
    ? Math.min(Number(body.expiresIn), 3600)
    : 900;

  if (!fileName) return res.error('fileName is required', 400);
  if (!contentType) return res.error('contentType is required', 400);
  if (!contentType.startsWith('image/')) return res.error('Only image/* content types are allowed', 400);

  const key = s3.buildUploadKey('images', entityId, fileName);
  const uploadUrl = await s3.getPresignedPutUrl(key, contentType, expiresIn);
  const publicUrl = s3.getPublicUrl(key);

  return res.success({ uploadUrl, key, publicUrl, expiresIn });
}

/**
 * DELETE /api/uploads
 *
 * Body:
 *   key  string  required  S3 object key returned from POST /api/uploads/presign
 *
 * Deletes the object. Only keys under the uploads/ prefix are allowed (security guard).
 */
async function deleteUpload(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);

  const body = parseBody(event);
  const key = body.key != null ? String(body.key).trim() : '';
  if (!key) return res.error('key is required', 400);

  try {
    s3.assertUploadKey(key);
  } catch (e) {
    return res.error(e.message, 400);
  }

  await s3.deleteObject(key);
  return res.success({ deleted: true, key });
}

const routes = [
  { method: 'POST', path: '/uploads/presign', fn: postPresign },
  { method: 'DELETE', path: '/uploads', fn: deleteUpload },
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
    const method = getMethod(evt);
    const path = getPath(evt);
    const fn = matchRoute(method, path);
    if (!fn) return res.error('Not found', 404);
    return fn(evt);
  });
  return wrapped(event, context);
}

module.exports = { handler };
