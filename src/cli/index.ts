#!/usr/bin/env node

// Suppress noisy libxmtp warnings (sqlcipherCodecAttach, etc.)
const _origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk: any, ...args: any[]): boolean {
  if (typeof chunk === 'string' && chunk.includes('sqlcipherCodecAttach')) return true;
  if (Buffer.isBuffer(chunk) && chunk.toString().includes('sqlcipherCodecAttach')) return true;
  return (_origStderrWrite as any)(chunk, ...args);
};

import { Command } from 'commander';
import { registerInitCommand } from './init.js';
import { registerIdentityCommand } from './identity.js';
import { registerRegisterCommand } from './register.js';
import { registerSearchCommand } from './search.js';
import { registerFriendsCommand } from './friends.js';
import { registerRoomCommand } from './room.js';
import { registerMessageCommand } from './message.js';
import { registerServeCommand } from './serve.js';
import { registerCallCommand } from './call.js';
import { registerReputationCommand } from './reputation.js';
import { registerPaymentsCommand } from './payments.js';
import { registerConfigCommand } from './config-cmd.js';
import { registerHooksCommand } from './hooks-cmd.js';
import { registerStatusCommand } from './status.js';

const program = new Command();

program
  .name('anet')
  .description('Agentic Network — on-chain economy stack for autonomous agents')
  .version('0.1.0');

// Register all command groups
registerInitCommand(program);
registerIdentityCommand(program);
registerRegisterCommand(program);
registerSearchCommand(program);
registerFriendsCommand(program);
registerRoomCommand(program);
registerMessageCommand(program);
registerServeCommand(program);
registerCallCommand(program);
registerReputationCommand(program);
registerPaymentsCommand(program);
registerConfigCommand(program);
registerHooksCommand(program);
registerStatusCommand(program);

program.parse();
