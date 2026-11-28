import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

// Fiori Guide | Load tours (API)
// GET /webhook/fiori-guide/tours        -> { tours: [catalog entries without steps] }
// GET /webhook/fiori-guide/tour?id=<id> -> { tour: full tour with steps }   (404 if unknown)

const TOURS_TABLE = { __rl: true, mode: 'list', value: 'VwJ8EhNHGphDnLl1', cachedResultName: 'FioriGuideTours' };
const CORS = { allowedOrigins: '*' };
const NO_CACHE = { entries: [{ name: 'Cache-Control', value: 'no-store' }] };

const listTours = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'List tours',
    parameters: { httpMethod: 'GET', path: 'fiori-guide/tours', responseMode: 'responseNode', options: CORS }
  }
});

const readAllTours = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read all tours',
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: TOURS_TABLE, returnAll: true }
  }
});

const buildCatalog = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build catalog',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const tours = $input.all().map(i => i.json).filter(r => r.tour_id).map(r => {
  let entry = {};
  try { entry = JSON.parse(r.entry || '{}'); } catch (e) { entry = {}; }
  return Object.assign({}, entry, {
    id: r.tour_id,
    version: r.version || entry.version || 1,
    updatedAt: r.updatedAt,
    updatedBy: r.updated_by || ''
  });
});
return [{ json: { status: 200, body: { tours } } }];`
    }
  }
});

const getTour = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Get tour',
    parameters: { httpMethod: 'GET', path: 'fiori-guide/tour', responseMode: 'responseNode', options: CORS }
  }
});

const readOneTour = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read tour',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: TOURS_TABLE,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'tour_id', condition: 'eq', keyValue: expr('{{ $json.query.id || "" }}') }] },
      returnAll: false,
      limit: 1
    }
  }
});

const buildTour = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build tour',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const id = String(($('Get tour').first().json.query || {}).id || '');
const row = $input.all().map(i => i.json).find(r => r.tour_id && r.tour_id === id);
if (!row) {
  return [{ json: { status: 404, body: { ok: false, message: 'Tour ' + id + ' not found' } } }];
}
let tour;
try { tour = JSON.parse(row.definition); } catch (e) {
  return [{ json: { status: 500, body: { ok: false, message: 'Stored tour ' + id + ' is not valid JSON' } } }];
}
tour.id = row.tour_id;
tour.version = row.version || tour.version || 1;
return [{ json: { status: 200, body: { tour } } }];`
    }
  }
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify($json.body) }}'),
      options: { responseCode: expr('{{ $json.status }}'), responseHeaders: NO_CACHE }
    }
  }
});

export default workflow('fiori-guide-load', 'Fiori Guide | Load tours (API)')
  .add(listTours)
  .to(readAllTours)
  .to(buildCatalog)
  .to(respond)
  .add(getTour)
  .to(readOneTour)
  .to(buildTour)
  .to(respond);
