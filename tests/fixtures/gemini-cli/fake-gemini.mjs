// Offline ACP peer for the Antigravity 1.5.0 adapter. Never authenticates or calls a model.
import { createInterface } from 'node:readline';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const mode = process.env.LH_FAKE_GEMINI_MODE;
let mcp;
let gracefulPrompt;
if (mode === 'graceful-wait') process.on('SIGTERM', () => {
 if (gracefulPrompt !== undefined) emit({ jsonrpc: '2.0', id: gracefulPrompt, result: { stopReason: 'cancelled' } });
 setTimeout(() => process.exit(0), 20);
});
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const update = (content) => emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fixture-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: content } } } });
createInterface({ input: process.stdin }).on('line', async (line) => {
 const request = JSON.parse(line);
 if (process.env.LH_FAKE_CAPTURE) await appendFile(process.env.LH_FAKE_CAPTURE, JSON.stringify(request) + '\n');
 if (!('id' in request)) return;
 const respond = (result) => emit({ jsonrpc: '2.0', id: request.id, result });
 const error = (message) => emit({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message } });
 try {
 if (request.method === 'initialize') return respond({ protocolVersion: 1, authMethods: [{ id: 'oauth-personal', name: 'Login with Google' }], agentCapabilities: { promptCapabilities: { image: true }, mcpCapabilities: { http: true } }, agentInfo: { name: 'Antigravity ACP Server', version: '1.5.0' } });
 if (request.method === 'authenticate') {
  if (mode === 'login-wait') return;
  if (mode === 'auth-error') return error('Google authentication required');
  const dir = process.env.LH_ANTIGRAVITY_PROFILE; await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'native-opaque-cache.fixture'), 'OFFLINE-FIXTURE-NOT-A-CREDENTIAL', { mode: 0o600 });
  return respond({});
 }
 if (request.method === 'session/new') {
  assert.equal(request.params._meta?.disableBuiltInTools, true);
  assert.equal(typeof request.params._meta?.antigravity?.systemPrompt?.append, 'string');
  assert.equal(request.params._meta?.antigravity?.eagerMcpServers, true);
  const server = request.params.mcpServers[0];
  assert.equal(server?.type, 'http'); assert.equal(server?.name, 'learnharness');
  assert.equal(server?._meta?.antigravity?.forceAllToolsEager, true);
  if (server) { mcp = new Client({ name: 'offline-gemini', version: '1.5.0' }); await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: Object.fromEntries(server.headers.map((h) => [h.name, h.value])) } })); await mcp.listTools(); }
  return respond({ sessionId: 'fixture-session', models: { currentModelId: 'pro', availableModels: ['auto', 'pro', 'flash', 'flash-lite'].map((id) => ({ modelId: id, name: id })) } });
 }
 if (request.method === 'session/set_model') return respond({});
 if (request.method === 'session/prompt') {
  if (mode === 'wait') return;
  if (mode === 'graceful-wait') { gracefulPrompt = request.id; return; }
  if (mode === 'rotate-token') await writeFile(join(process.env.LH_ANTIGRAVITY_PROFILE, 'native-opaque-cache.fixture'), 'OFFLINE-ROTATED-DURING-PROMPT', { mode: 0o600 });
  if (mode === 'quota') return error('429 quota exhausted');
  if (mode === 'auth-error') return error('Google authentication required');
  if (mode === 'malformed') return process.stdout.write('malformed-not-json\n');
  if (mode === 'forged') emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fixture-session', update: { sessionUpdate: 'tool_call', toolCallId: 'forged', title: 'knowledge', kind: 'other', status: 'pending', rawInput: { topic: 'forged' } } } });
  if (mode === 'parallel') { const values = await Promise.all([mcp.callTool({ name: 'knowledge', arguments: { topic: 'same' } }), mcp.callTool({ name: 'knowledge', arguments: { topic: 'same' } })]); update(JSON.stringify(values)); }
  else if (mode === 'tool') { const value = await mcp.callTool({ name: 'knowledge', arguments: { topic: 'derivatives' } }); update(JSON.stringify(value.content)); }
  else { update('Answer '); update('with context'); }
  return respond({ stopReason: 'end_turn', usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 } });
 }
 return error('Unsupported fixture method ' + request.method);
 } catch (failure) { error(String(failure)); }
});
