import express from 'express';
import { config } from '../../config.js';
import { authMiddleware } from '../auth/middleware.js';
import { createPaymentMiddleware } from '../payments/server.js';
import { AgentIndexer } from '../discovery/indexer.js';
import { searchAgents, getTopAgents } from '../discovery/search.js';

export interface ServerOptions {
  walletAddress: string;
  indexer: AgentIndexer;
  agentId?: string;
  serviceHandlers?: Record<string, (req: express.Request, res: express.Response) => Promise<void>>;
}

export function createApp(options: ServerOptions): express.Express {
  const app = express();
  app.use(express.json());

  // X402 Payment middleware for monetized routes
  app.use(createPaymentMiddleware(
    options.walletAddress,
    {
      'POST /api/code-review': { price: '$0.50', network: `base-${config.network}` },
      'POST /api/research': { price: '$0.25', network: `base-${config.network}` },
      'POST /api/task-analysis': { price: '$0.10', network: `base-${config.network}` },
    }
  ));

  // ERC-8128 Auth middleware for protected routes
  app.use(authMiddleware({
    protectedRoutes: ['POST /api/code-review', 'POST /api/research', 'POST /api/task-analysis'],
  }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      agent: config.agentName,
      network: config.network,
      timestamp: new Date().toISOString(),
    });
  });

  // Agent info
  app.get('/api/info', (_req, res) => {
    res.json({
      name: config.agentName,
      address: options.walletAddress,
      network: config.network,
      chainId: config.chainId,
      services: ['code-review', 'research', 'task-analysis'],
      pricing: {
        'POST /api/code-review': '$0.50 USDC',
        'POST /api/research': '$0.25 USDC',
        'POST /api/task-analysis': '$0.10 USDC',
      },
      authentication: 'ERC-8128 (Ethereum-signed HTTP requests)',
      payment: 'X402 (HTTP 402 payment flow, USDC on Base)',
      messaging: {
        protocol: 'XMTP',
        address: options.walletAddress,
      },
      registry: {
        standard: 'ERC-8004',
        contract: config.identityRegistryAddress,
        agentId: options.agentId,
      },
      agentCount: options.indexer.getAgentCount(),
    });
  });

  // Service endpoints
  app.post('/api/code-review', async (req, res) => {
    const handler = options.serviceHandlers?.['code-review'];
    if (handler) return handler(req, res);

    res.json({
      status: 'success',
      review: 'Code review service placeholder - implement your review logic',
      signer: req.signerAddress,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/research', async (req, res) => {
    const handler = options.serviceHandlers?.['research'];
    if (handler) return handler(req, res);

    res.json({
      status: 'success',
      results: 'Research service placeholder - implement your research logic',
      signer: req.signerAddress,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/task-analysis', async (req, res) => {
    const handler = options.serviceHandlers?.['task-analysis'];
    if (handler) return handler(req, res);

    res.json({
      status: 'success',
      analysis: 'Task analysis placeholder - implement your analysis logic',
      signer: req.signerAddress,
      timestamp: new Date().toISOString(),
    });
  });

  // Discovery endpoints
  app.get('/api/agents', (req, res) => {
    const { capability, minRep, limit } = req.query;
    const agents = searchAgents(options.indexer, {
      capability: capability as string,
      minReputation: minRep ? Number(minRep) : undefined,
      limit: limit ? Number(limit) : 20,
    });

    res.json({
      count: agents.length,
      agents: agents.map(a => ({
        id: a.agent_id,
        name: a.name,
        description: a.description,
        capabilities: a.capabilities,
        reputation: a.reputation,
        endpoints: { xmtp: a.xmtp_address, http: a.http_endpoint },
      })),
    });
  });

  app.get('/api/agents/top', (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const agents = getTopAgents(options.indexer, limit);
    res.json({ agents });
  });

  app.get('/api/agents/:id', (req, res) => {
    const agent = options.indexer.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  });

  return app;
}
