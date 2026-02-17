import { Command } from 'commander';
import { loadContext, getSigner, getProvider, getIndexer } from './context.js';
import { signRequest } from '../core/auth/signer.js';
import { X402Client } from '../core/payments/client.js';
import { BudgetManager } from '../core/payments/budget.js';
import { PaymentTracker } from '../core/payments/tracker.js';
import { computeReputationScore } from '../core/registry/metadata.js';
import { FriendsDB } from '../social/friends.js';
import { HookEngine } from '../hooks/engine.js';
import { SettingsManager } from '../settings/manager.js';
import path from 'path';
import { ANET_HOME } from '../config.js';

export function registerCallCommand(program: Command) {
  program
    .command('call <agent-id> <service>')
    .description('Call a service (auto-resolve from 8004, auto-sign with 8128, auto-pay with X402, auto-reputation)')
    .option('--payload <json>', 'JSON payload')
    .action(async (agentIdStr: string, service: string, opts: any) => {
      const ctx = loadContext(true);
      const wallet = ctx.wallet!;
      const agentId = parseInt(agentIdStr);

      // Auto-resolve agent endpoint from 8004 registry
      const indexer = getIndexer();
      let agent = indexer.getAgent(agentId);

      if (!agent) {
        // Auto-sync if agent not found locally
        console.log(`Agent ${agentId} not in local index, syncing...`);
        try {
          const { syncFromChain } = await import('../core/discovery/sync.js');
          const provider = getProvider();
          await syncFromChain(provider, indexer);
          agent = indexer.getAgent(agentId);
        } catch (e: any) {
          console.error(`Sync failed: ${e.message}`);
        }
      }

      indexer.close();

      if (!agent || !agent.http_endpoint) {
        console.error(`Agent ${agentId} not found or has no HTTP endpoint.`);
        return;
      }

      const url = `${agent.http_endpoint}/api/${service}`;
      const payload = opts.payload ? JSON.parse(opts.payload) : {};

      console.log(`Calling [${agentId}] ${agent.name || 'Unknown'}`);
      console.log(`  Service:  ${service}`);
      console.log(`  URL:      ${url}`);

      // Fire pre-call hook
      const settings = new SettingsManager();
      const hooks = new HookEngine(settings);
      const preResult = await hooks.fire('pre-call', {
        agentId, service, url, payload,
      });
      if (!preResult.allow) {
        console.error(`  Blocked by hook: ${preResult.reason}`);
        return;
      }

      // Sign request with ERC-8128
      const signer = getSigner(wallet.privateKey);
      const signed = await signRequest('POST', url, JSON.stringify(payload), signer);
      console.log(`  Auth:     ERC-8128 (${wallet.address})`);

      // X402 auto-payment
      const budget = new BudgetManager({
        maxPerTransaction: ctx.settings.get('payments.max-per-tx') || 1.00,
        maxPerSession: ctx.settings.get('payments.max-per-session') || 10.00,
      });
      const tracker = new PaymentTracker(path.join(ANET_HOME, 'payments.jsonl'));
      const x402 = new X402Client(signer, { budgetManager: budget, tracker });

      // Track metrics for auto-reputation
      const startTime = Date.now();
      let success = false;
      let responseStatus = 0;

      try {
        const response = await x402.fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Signature': signed.signatureHeader,
          },
          body: JSON.stringify(payload),
        });

        responseStatus = response.status;
        const data = await response.json();
        success = response.status >= 200 && response.status < 300;

        console.log(`\n  Status: ${response.status}`);
        console.log(JSON.stringify(data, null, 2));
      } catch (e: any) {
        console.error(`\n  Call failed: ${e.message}`);
      }

      const responseTime = Date.now() - startTime;

      // Auto-reputation: compute score from actual interaction metrics
      const metrics = computeReputationScore({
        reachable: responseStatus > 0,
        successRate: success ? 100 : 0,
        responseTime,
      });

      console.log(`\n  Metrics: ${responseTime}ms, ${success ? 'success' : 'failed'}, score: ${metrics}`);

      // Fire post-call hook with metrics
      await hooks.fire('post-call', {
        agentId, service, responseTime, success, responseStatus,
        reputationScore: metrics,
      });

      // Fire post-interaction hook
      await hooks.fire('post-interaction', {
        type: 'service-call',
        agentId,
        service,
        outcome: success ? 'success' : 'failure',
        responseTime,
        reputationScore: metrics,
      });

      // Auto-upgrade trust for existing friends based on interaction
      try {
        const friends = new FriendsDB();
        const friend = friends.getFriend(agentId);
        if (friend) {
          friends.recordInteraction(agentId);
          // Upgrade trust on repeated successful paid interactions
          if (success && friend.trust_level === 'friend' && friend.reputation >= 80) {
            friends.updateTrust(agentId, 'trusted');
            console.log(`  Trust upgraded: ${friend.name} -> trusted`);
          }
        }
        friends.close();
      } catch { /* no friends db yet */ }
    });
}
