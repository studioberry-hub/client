declare module 'discord-rpc' {
  import { EventEmitter } from 'events';

  export interface RPCOptions {
    transport: 'ipc' | 'websocket';
  }

  export interface Presence {
    details?: string;
    state?: string;
    startTimestamp?: number | Date;
    endTimestamp?: number | Date;
    largeImageKey?: string;
    largeImageText?: string;
    smallImageKey?: string;
    smallImageText?: string;
    instance?: boolean;
    partyId?: string;
    partySize?: number;
    partyMax?: number;
    matchSecret?: string;
    joinSecret?: string;
    spectateSecret?: string;
    buttons?: { label: string; url: string }[];
  }

  export class Client extends EventEmitter {
    constructor(options: RPCOptions);
    user?: any;
    login(options: { clientId: string }): Promise<void>;
    setActivity(presence: Presence): Promise<void>;
    clearActivity(): Promise<void>;
    destroy(): Promise<void>;
    on(event: 'ready', handler: () => void): this;
    on(event: 'disconnected', handler: () => void): this;
  }

  export function register(id: string): void;
}
