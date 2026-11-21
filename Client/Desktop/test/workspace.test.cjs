// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const { pathToFileURL } = require('node:url');
const { createSystemSettings } = require('../src/system-settings.cjs');
const {
  validateDescriptor,
  requestCore,
} = require('../host/bridge.cjs');

test('presentation shows newest three concrete operations and ten individual history briefs', async () => {
  const { WorkspacePresentation } = await import(
    pathToFileURL(path.resolve(__dirname, '../ui/model.mjs'))
  );
  const view = new WorkspacePresentation();
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: 'cmd' + i,
    tool: 'exec_command',
    sequence: i + 1,
    revision: i + 1,
    state: i === 19 ? 'running' : 'completed',
    command: 'echo ' + i,
    preview: { session_id: i + 1, output: String(i) },
  }));
  view.ingest(
    {
      roles: [
        { role: 'execution', state: 'running', activity: { items: rows } },
      ],
    },
    0,
  );
  assert.equal(view.scene.kind, 'multi');
  assert.equal(view.current().length, 3);
  assert.equal(view.history().length, 10);
  assert.equal(view.history()[0].id, 'cmd10');
  view.ingest(
    {
      roles: [
        {
          role: 'execution',
          state: 'running',
          activity: { items: [rows[19]] },
        },
      ],
    },
    5000,
  );
  assert.equal(view.current().length, 3, 'poll duplicated commands');
  view.ingest(
    {
      roles: [
        { role: 'execution', state: 'completed', activity: { items: [] } },
      ],
    },
    6000,
  );
  view.tick(8001);
  assert.equal(view.scene, null, 'settled scene did not collapse');
  const mixed = new WorkspacePresentation();
  mixed.ingest(
    {
      roles: [
        {
          role: 'execution',
          state: 'running',
          activity: {
            items: rows.map((r, i) => ({
              ...r,
              tool: i % 2 ? 'apply_patch' : 'exec_command',
            })),
          },
        },
      ],
    },
    0,
  );
  assert.equal(mixed.scene.kind, 'multi');
  assert.equal(mixed.current().length, 3);
  assert.equal(mixed.current().at(-1).id, 'cmd19');
});

test('workspace bridge rejects remote or credential-bearing URLs', () => {
  const token = 'a'.repeat(64);
  assert.doesNotThrow(() =>
    validateDescriptor({ url: 'http://127.0.0.1:4567/v1/rpc', token }),
  );
  for (const url of [
    'https://example.com/v1/rpc',
    'http://localhost:4567/v1/rpc',
    'http://evil@127.0.0.1:4567/v1/rpc',
    'http://127.0.0.1:4567/v1/rpc?token=bad',
  ])
    assert.throws(() => validateDescriptor({ url, token }));
});

test('onboarding discovers, verifies real tool roundtrip, and saves through shared config', async (t) => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'aieyra-workspace-config-'),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      res.end(
        JSON.stringify({
          data: [{ id: 'fixture', name: 'Fixture', context_length: 128000 }],
        }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    calls++;
    const result = body.input?.find(
      (item) => item.type === 'function_call_output',
    );
    const output = result
      ? [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: result.output }],
          },
        ]
      : [
          {
            type: 'function_call',
            id: 'fc1',
            call_id: 'c1',
            name: 'aieyra_probe',
            arguments: JSON.stringify({
              token: body.tools[0].parameters.properties.token.enum[0],
            }),
          },
        ];
    res.end(JSON.stringify({ id: 'r' + calls, status: 'completed', output }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port,
    system = createSystemSettings(file),
    input = { base_url: base, api_key: 'fake-workspace-key', model: 'fixture' };
  const catalog = await system.call('onboarding_catalog', input, 'session-a');
  assert.equal(catalog.models[0].context_window, 128000);
  assert.ok(!JSON.stringify(catalog).includes(input.api_key));
  const result = await system.call('onboarding_connect', input, 'session-a');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(calls, 2);
  assert.equal(result.context_source, 'provider_catalog');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.active_profile, saved.matrix_profile);
  assert.equal(saved.provider_connections[0].api_key, input.api_key);
  assert.ok(!JSON.stringify(result).includes(input.api_key));
  const profile = saved.api_profiles.find((p) => p.id === saved.matrix_profile);
  assert.equal(profile.context_window, 128000);
  assert.equal(profile.context_window_source, 'provider_catalog');
});

test('malformed tool responses never save an unverified connection', async (t) => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'aieyra-workspace-reject-'),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.method === 'GET'
          ? { data: [{ id: 'broken' }] }
          : { id: 'bad', status: 'completed', output: [], choices: [] },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await createSystemSettings(file).call(
    'onboarding_connect',
    {
      base_url: 'http://127.0.0.1:' + server.address().port,
      api_key: 'fake-key',
      model: 'broken',
    },
    'session-a',
  );
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(file), false);
});
