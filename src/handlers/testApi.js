'use strict';

const res = require('../lib/response');

async function handler(event, context) {
  const stage = process.env.STAGE || 'dev';
  return res.success({
    message: 'Venue Management API',
    stage,
    timestamp: new Date().toISOString(),
    // All API paths must include /{stage}/ in the URL (e.g. /prod/api/auth/login, /prod/venue-docs)
    basePath: `/${stage}`,
    docsUrl: `/{stage}/venue-docs or /{stage}/swagger-ui or /{stage}/api/docs`.replace(/\{stage\}/g, stage),
  });
}

module.exports = { handler };
