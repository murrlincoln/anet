import { RateLimiter } from './ratelimit.js';
import type { AgentMessage, MessageContext, ServiceRequest, ServiceInquiry, FriendRequest, FriendAccept } from './types.js';

export type ServiceHandler = (sender: string, payload: any) => Promise<any>;
export type FriendRequestHandler = (sender: string, request: FriendRequest) => Promise<void>;
export type FriendAcceptHandler = (sender: string, accept: FriendAccept) => Promise<void>;

export class MessageHandler {
  private services: Map<string, ServiceHandler> = new Map();
  private rateLimiter: RateLimiter;
  private reputationChecker?: (address: string) => Promise<number>;
  private onFriendRequest?: FriendRequestHandler;
  private onFriendAccept?: FriendAcceptHandler;

  constructor(options: {
    maxMessagesPerMinute?: number;
    reputationChecker?: (address: string) => Promise<number>;
    onFriendRequest?: FriendRequestHandler;
    onFriendAccept?: FriendAcceptHandler;
  } = {}) {
    this.rateLimiter = new RateLimiter(options.maxMessagesPerMinute);
    this.reputationChecker = options.reputationChecker;
    this.onFriendRequest = options.onFriendRequest;
    this.onFriendAccept = options.onFriendAccept;
  }

  registerService(name: string, handler: ServiceHandler): void {
    this.services.set(name, handler);
  }

  getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }

  async handleMessage(sender: string, content: string): Promise<string> {
    // Rate limit check
    if (!this.rateLimiter.checkLimit(sender)) {
      return JSON.stringify({ type: 'error', error: 'Rate limit exceeded' });
    }

    // Try to parse as structured message
    try {
      const message: AgentMessage = JSON.parse(content);
      return await this.handleStructuredMessage(sender, message);
    } catch {
      // Plain text
      return await this.handleTextMessage(sender, content);
    }
  }

  private async handleStructuredMessage(sender: string, message: AgentMessage): Promise<string> {
    // Check reputation for service requests
    if (message.type === 'service-request' && this.reputationChecker) {
      const rep = await this.reputationChecker(sender);
      if (rep < 30) {
        return JSON.stringify({
          type: 'service-response',
          status: 'error',
          result: 'Insufficient reputation',
        });
      }
    }

    switch (message.type) {
      case 'service-request':
        return this.handleServiceRequest(sender, message as ServiceRequest);
      case 'service-inquiry':
        return this.handleServiceInquiry(message as ServiceInquiry);
      case 'friend-request':
        if (this.onFriendRequest) {
          await this.onFriendRequest(sender, message as FriendRequest);
          return JSON.stringify({ type: 'ack', received: 'friend-request' });
        }
        return JSON.stringify({ type: 'ack', received: 'friend-request', note: 'no handler registered' });
      case 'friend-accept':
        if (this.onFriendAccept) {
          await this.onFriendAccept(sender, message as FriendAccept);
          return JSON.stringify({ type: 'ack', received: 'friend-accept' });
        }
        return JSON.stringify({ type: 'ack', received: 'friend-accept', note: 'no handler registered' });
      default:
        return JSON.stringify({ type: 'ack', received: message.type });
    }
  }

  private async handleServiceRequest(sender: string, request: ServiceRequest): Promise<string> {
    const handler = this.services.get(request.service);
    if (!handler) {
      return JSON.stringify({
        type: 'service-response',
        requestId: request.id,
        status: 'error',
        result: `Unknown service: ${request.service}. Available: ${this.getRegisteredServices().join(', ')}`,
      });
    }

    try {
      const result = await handler(sender, request.payload);
      return JSON.stringify({
        type: 'service-response',
        requestId: request.id,
        status: 'success',
        result,
      });
    } catch (error) {
      return JSON.stringify({
        type: 'service-response',
        requestId: request.id,
        status: 'error',
        result: String(error),
      });
    }
  }

  private async handleServiceInquiry(inquiry: ServiceInquiry): Promise<string> {
    const hasService = this.services.has(inquiry.service);
    return JSON.stringify({
      type: 'service-details',
      service: inquiry.service,
      available: hasService,
      allServices: this.getRegisteredServices(),
    });
  }

  private async handleTextMessage(sender: string, content: string): Promise<string> {
    return JSON.stringify({
      type: 'text-response',
      message: `Available services: ${this.getRegisteredServices().join(', ')}. Send a structured JSON message to use them.`,
    });
  }

  destroy(): void {
    this.rateLimiter.destroy();
  }
}
