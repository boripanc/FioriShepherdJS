import { workflow, node, trigger, expr, ifElse } from '@n8n/workflow-sdk';

// Fiori Guide | Save tours (API)
// POST /webhook/fiori-guide/save    body { key, tour, user } -> { ok, id, version, updatedAt }
// POST /webhook/fiori-guide/delete  body { key, id, user }   -> { ok, id }
// "key" must match publish_key in the FioriGuideConfig data table.

const saveTour = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Save tour',
    parameters: { httpMethod: 'POST', path: 'fiori-guide/save', responseMode: 'responseNode', options: { allowedOrigins: '*' } }
  }
});

const readKeySave = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read publish key',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: 'AbrYP9ZsG7nZwST6', cachedResultName: 'FioriGuideConfig' }, returnAll: false, limit: 1 }
  }
});

const checkSave = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check save request',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "const body = $('Save tour').first().json.body || {};\nconst key = String(($input.first().json || {}).publish_key || '');\nconst fail = (status, message) => [{ json: { valid: false, status, body: { ok: false, message } } }];\nif (!key) return fail(500, 'No publish_key in the FioriGuideConfig data table');\nif (String(body.key || '') !== key) return fail(401, 'Wrong publishing key');\nconst user = String(body.user || '').slice(0, 80);\nconst tour = body.tour;\nif (!tour || typeof tour !== 'object') return fail(400, 'Missing tour');\nconst id = String(tour.id || '');\nif (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return fail(400, 'Tour id must be 1-80 letters, digits, dot, dash or underscore');\nif (!Array.isArray(tour.steps) || !tour.steps.length) return fail(400, 'Tour ' + id + ' has no steps');\nconst clean = Object.assign({}, tour);\ndelete clean.isDraft; delete clean.source; delete clean.url; delete clean.updatedAt; delete clean.updatedBy;\nconst entry = Object.assign({}, clean);\ndelete entry.steps;\nconst t = clean.title;\nconst title = typeof t === 'string' ? t : (t && (t.en || Object.values(t)[0])) || id;\nreturn [{ json: {\n  valid: true,\n  tour_id: id,\n  title: String(title).slice(0, 200),\n  entry: JSON.stringify(entry),\n  definition: JSON.stringify(clean),\n  version: Number(clean.version) || 1,\n  updated_by: user\n} }];" }
  }
});

const saveAllowed = ifElse({
  version: 2.2,
  config: {
    name: 'Save allowed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.valid }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const upsertTour = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Upsert tour',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: 'VwJ8EhNHGphDnLl1', cachedResultName: 'FioriGuideTours' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'tour_id', condition: 'eq', keyValue: expr('{{ $json.tour_id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          tour_id: expr('{{ $json.tour_id }}'),
          title: expr('{{ $json.title }}'),
          entry: expr('{{ $json.entry }}'),
          definition: expr('{{ $json.definition }}'),
          version: expr('{{ $json.version }}'),
          updated_by: expr('{{ $json.updated_by }}')
        },
        matchingColumns: [],
        schema: [
          { id: 'tour_id', displayName: 'tour_id', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'title', displayName: 'title', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'entry', displayName: 'entry', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'definition', displayName: 'definition', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'version', displayName: 'version', required: false, defaultMatch: false, display: true, type: 'number', readOnly: false, removed: false },
          { id: 'updated_by', displayName: 'updated_by', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false }
        ]
      }
    }
  }
});

const respondSaved = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond saved',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ JSON.stringify({ ok: true, id: $('Check save request').first().json.tour_id, version: $('Check save request').first().json.version, updatedAt: $json.updatedAt || $now.toISO() }) }}"),
      options: { responseCode: expr('{{ $json.status || 200 }}'), responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } }
    }
  }
});

const deleteTour = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Delete tour',
    parameters: { httpMethod: 'POST', path: 'fiori-guide/delete', responseMode: 'responseNode', options: { allowedOrigins: '*' } }
  }
});

const readKeyDelete = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read publish key (delete)',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: 'AbrYP9ZsG7nZwST6', cachedResultName: 'FioriGuideConfig' }, returnAll: false, limit: 1 }
  }
});

const checkDelete = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check delete request',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "const body = $('Delete tour').first().json.body || {};\nconst key = String(($input.first().json || {}).publish_key || '');\nconst fail = (status, message) => [{ json: { valid: false, status, body: { ok: false, message } } }];\nif (!key) return fail(500, 'No publish_key in the FioriGuideConfig data table');\nif (String(body.key || '') !== key) return fail(401, 'Wrong publishing key');\nconst user = String(body.user || '').slice(0, 80);\nconst id = String(body.id || '');\nif (!id) return fail(400, 'Missing id');\nreturn [{ json: { valid: true, tour_id: id, updated_by: user } }];" }
  }
});

const deleteAllowed = ifElse({
  version: 2.2,
  config: {
    name: 'Delete allowed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.valid }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const deleteRows = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Delete tour rows',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'deleteRows',
      dataTableId: { __rl: true, mode: 'list', value: 'VwJ8EhNHGphDnLl1', cachedResultName: 'FioriGuideTours' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'tour_id', condition: 'eq', keyValue: expr('{{ $json.tour_id }}') }] }
    }
  }
});

const respondDeleted = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond deleted',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ JSON.stringify({ ok: true, id: $('Check delete request').first().json.tour_id }) }}"),
      options: { responseCode: expr('{{ $json.status || 200 }}'), responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } }
    }
  }
});

const respondError = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond error',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ JSON.stringify($json.body) }}"),
      options: { responseCode: expr('{{ $json.status || 200 }}'), responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } }
    }
  }
});

export default workflow('fiori-guide-save', 'Fiori Guide | Save tours (API)')
  .add(saveTour)
  .to(readKeySave)
  .to(checkSave)
  .to(saveAllowed
    .onTrue(upsertTour.to(respondSaved))
    .onFalse(respondError))
  .add(deleteTour)
  .to(readKeyDelete)
  .to(checkDelete)
  .to(deleteAllowed
    .onTrue(deleteRows.to(respondDeleted))
    .onFalse(respondError));
