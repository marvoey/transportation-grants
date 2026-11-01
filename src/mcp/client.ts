import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getConfig } from '../config/config.js';
import { createServer } from '../server.js';

/**
 * In-process MCP client connected to the real MCP server (src/server.ts)
 * over a linked in-memory transport, so the web chat exercises the actual
 * MCP request/response framing instead of calling tool-executor.ts directly.
 */
let clientPromise: Promise<Client> | undefined;

function connectClient(): Promise<Client> {
  const config = getConfig();
  const server = createServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({
    name: `${config.server.name}-web-client`,
    version: config.server.version,
  });

  return Promise.all([server.connect(serverTransport), client.connect(clientTransport)]).then(
    () => client
  );
}

function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connectClient();
  }
  return clientPromise;
}

export async function callMcpTool(name: string, args: unknown): Promise<unknown> {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args as Record<string, unknown> });

  const textBlock = (result.content as Array<{ type: string; text?: string }>).find(
    (block) => block.type === 'text'
  );
  const parsed = textBlock?.text ? JSON.parse(textBlock.text) : undefined;

  if (result.isError) {
    throw new Error(parsed?.message ?? `MCP tool ${name} failed`);
  }

  return parsed;
}
