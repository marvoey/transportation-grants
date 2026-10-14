import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig, logger } from './config/config.js';
import { formatErrorResponse } from './utils/error-handler.js';
import { TOOL_SCHEMAS } from './mcp/tool-schemas.js';
import { executeTool } from './mcp/tool-executor.js';

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const config = getConfig();
  const server = new Server(
    {
      name: config.server.name,
      version: config.server.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_SCHEMAS };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      logger.info(`Tool called: ${name}`, args);

      const result = await executeTool(name, args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Error executing tool ${name}:`, error);
      const errorResponse = formatErrorResponse(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorResponse, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run the server
 */
export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  logger.info('Starting DOT Grants MCP server...');

  await server.connect(transport);

  logger.info('DOT Grants MCP server running on stdio');
}
