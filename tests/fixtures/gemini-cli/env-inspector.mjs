// Native CLI discovery only: report selected synthetic env markers, never real credentials.
import { writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
await writeFile(process.env.LH_ENV_CAPTURE, JSON.stringify({ poison: process.env.LH_ENV_POISON, endpoint: process.env.CODE_ASSIST_ENDPOINT, version: process.env.CODE_ASSIST_API_VERSION }));
const server = new Server({ name: 'learnharness-env-inspector', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
await server.connect(new StdioServerTransport());
