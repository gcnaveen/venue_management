'use strict';

const path = require('path');
const fs = require('fs');

// Inline HTML – same structure as swagger.html; placeholder replaced with spec URL
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Venue Management API - Swagger documentation">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Venue Management API - Swagger UI</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload=function(){
      const ui = SwaggerUIBundle({
        url: "__SWAGGER_SPEC_URL__",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

function getBaseUrl(evt) {
  if (!evt || !evt.headers) return 'https://localhost';
  const host = evt.headers.Host || evt.headers.host || 'localhost:3000';
  const proto = evt.headers['X-Forwarded-Proto'] || evt.headers['x-forwarded-proto'] || (String(host).indexOf('localhost') >= 0 ? 'http' : 'https');
  return proto + '://' + host;
}

function htmlResponse(evt) {
  const base = getBaseUrl(evt);
  const specUrl = base + '/api/docs/swagger.yaml';
  const body = HTML_TEMPLATE.replace('__SWAGGER_SPEC_URL__', specUrl);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Served-By': 'swaggerApi',
      'Access-Control-Allow-Origin': '*',
    },
    body: body,
  };
}

function getSpecPath() {
  const rootYaml = path.join(__dirname, '../../swagger.yaml');
  const apiDocsYaml = path.join(__dirname, '../../api-docs/openapi.yaml');
  if (fs.existsSync(rootYaml)) return rootYaml;
  return apiDocsYaml;
}

function yamlResponse() {
  try {
    const p = getSpecPath();
    const body = fs.readFileSync(p, 'utf8');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/x-yaml; charset=utf-8',
        'X-Served-By': 'swaggerApi',
        'Access-Control-Allow-Origin': '*',
      },
      body: body,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: '{"success":false,"error":{"message":"Spec not found"}}',
    };
  }
}

function jsonResponse() {
  try {
    const yaml = require('js-yaml');
    const p = getSpecPath();
    const spec = yaml.load(fs.readFileSync(p, 'utf8'));
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Served-By': 'swaggerApi',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(spec),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: '{"success":false,"error":{"message":"Spec not found"}}',
    };
  }
}

function handler(event, context) {
  const evt = event || {};
  const method = (evt.requestContext && evt.requestContext.http && evt.requestContext.http.method) ? evt.requestContext.http.method.toUpperCase() : (evt.httpMethod || 'GET').toUpperCase();
  let rawPath = (evt.rawPath || evt.path || '').split('?')[0] || '';
  rawPath = rawPath.replace(/^\/(dev|prod)\//, '/').replace(/^\/(dev|prod)$/, '/');

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Max-Age': '86400' }, body: '' };
  }

  if (method !== 'GET') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '{"success":false}' };
  }

  // Ping: proves this Lambda is invoked (if you get null on docs, try GET /api/docs/ping)
  if (rawPath === '/api/docs/ping') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'X-Served-By': 'swaggerApi', 'Access-Control-Allow-Origin': '*' },
      body: '{"ok":true,"message":"swaggerApi is running"}',
    };
  }
  if (rawPath === '/swagger-ui' || rawPath === '/swagger-ui/' || rawPath === '/docs' || rawPath === '/docs/' || rawPath === '/api/docs' || rawPath === '/api/docs/' || rawPath === '/venue-docs' || rawPath === '/venue-docs/') {
    return htmlResponse(evt);
  }
  if (rawPath === '/api/docs/swagger.yaml') {
    return yamlResponse();
  }
  if (rawPath === '/api/docs/swagger.json') {
    return jsonResponse();
  }

  return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '{"success":false,"error":{"message":"Not found"}}' };
}

module.exports = { handler };
