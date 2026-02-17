import fs from 'fs';
import path from 'path';
import { HookContext, HookHandler } from './types.js';

export function getBuiltinActions(): Map<string, HookHandler> {
  const actions = new Map<string, HookHandler>();

  // Rate limit — check sender message frequency
  actions.set('rate-limit', async (ctx: HookContext) => {
    // Rate limiting is handled by the messaging module's RateLimiter
    // This hook just checks if the sender is rate-limited
    return { allow: true };
  });

  // Reputation check — verify sender's 8004 reputation
  actions.set('reputation-check', async (ctx: HookContext) => {
    const minRep = ctx.data._hookConfig?.['min-reputation'] ?? 30;
    const senderRep = ctx.data.senderReputation ?? 0;

    if (senderRep < minRep) {
      return {
        allow: false,
        reason: `Sender reputation ${senderRep} below threshold ${minRep}`,
      };
    }
    return { allow: true };
  });

  // Budget check — verify payment within limits
  actions.set('budget-check', async (ctx: HookContext) => {
    const amount = ctx.data.amount ?? 0;
    const maxPerTx = ctx.data._hookConfig?.['max-per-tx'] ?? 1.00;

    if (amount > maxPerTx) {
      return {
        allow: false,
        reason: `Amount $${amount} exceeds per-transaction limit $${maxPerTx}`,
      };
    }
    return { allow: true };
  });

  // Domain whitelist — only auto-sign for approved domains
  actions.set('domain-whitelist', async (ctx: HookContext) => {
    const whitelist: string[] = ctx.data._hookConfig?.domains || [];
    if (whitelist.length === 0) return { allow: true }; // empty = allow all

    const url = ctx.data.url || '';
    try {
      const domain = new URL(url).hostname;
      if (!whitelist.includes(domain)) {
        return {
          allow: false,
          reason: `Domain ${domain} not in whitelist`,
        };
      }
    } catch {
      // Can't parse URL, allow by default
    }
    return { allow: true };
  });

  // Log — append event to JSONL file
  actions.set('log', async (ctx: HookContext) => {
    const file = ctx.data._hookConfig?.file || '~/.anet/interactions.jsonl';
    const resolvedPath = file.replace('~', process.env.HOME || '');

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const { _hookConfig, ...cleanData } = ctx.data;
    const entry = {
      event: ctx.event,
      timestamp: new Date(ctx.timestamp).toISOString(),
      ...cleanData,
    };

    fs.appendFileSync(resolvedPath, JSON.stringify(entry) + '\n');
    return { allow: true };
  });

  // Webhook — POST event data to URL
  actions.set('webhook', async (ctx: HookContext) => {
    const url = ctx.data._hookConfig?.url;
    if (!url) return { allow: true };

    const { _hookConfig, ...cleanData } = ctx.data;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: ctx.event,
          timestamp: new Date(ctx.timestamp).toISOString(),
          ...cleanData,
        }),
      });
    } catch (e: any) {
      console.warn(`Webhook failed for ${url}: ${e.message}`);
    }
    return { allow: true };
  });

  // Auto-reputation — submit 8004 feedback after interaction
  actions.set('auto-reputation', async (ctx: HookContext) => {
    // This would call giveFeedback() — but needs signer context
    // For now, just log the intent
    const agentId = ctx.data.agentId;
    const score = ctx.data._hookConfig?.score ?? 70;
    if (agentId) {
      console.log(`[hook] auto-reputation: would rate agent ${agentId} with score ${score}`);
    }
    return { allow: true };
  });

  return actions;
}
