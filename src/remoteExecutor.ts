import { Flaggable, MacroMarkerFlags } from './macros/macroMarkerFlags';
import CONSTANTS from './utils/constants';
import { ConsoleLogger, Logger, NotifiedLogger } from './utils/logger';

declare class FoundrySocket {
    emit: (scope: string, data: UpdateMarkerMessage | MarkerUpdatedMessage) => Promise<unknown>;
    on: (scope: string, callback: (data: UpdateMarkerMessage | MarkerUpdatedMessage) => void) => void;
}

declare type Resolution = (value?: unknown) => void;

interface Message {
    type: 'markerUpdated' | 'updateMarker',
    id: string,
    error?: string
}

export declare type MarkerTypes = 'Token' | 'User' | 'Macro';

interface Entity {
    type: MarkerTypes,
    id: string
}

interface UpdateMarkerMessage extends Message {
    macroId: string,
    isActive: boolean,
    entity: Entity,
    forGM: string
}

interface MarkerUpdatedMessage extends Message {
    macroId: string,
    entity: Entity
}

const scope = `module.${CONSTANTS.module.name}`;

export class RemoteExecutor {
    private static _instance;

    static init(logger: Logger): void {
        (<FoundrySocket><unknown>game.socket).on(scope, message => {
            const executor = RemoteExecutor.create(logger);
            executor.onMessage(message);
        });
    }

    private pendingMessages: { [id: string]: { reject: Resolution, resolve: Resolution } } = { }

    private constructor(private logger: Logger, private socket: FoundrySocket, private currentUser: User, private users: User[]) { }

    // TODO: rip out direct references to `game`?
    static create(logger: Logger): RemoteExecutor {
        if (!RemoteExecutor._instance)
            RemoteExecutor._instance = new RemoteExecutor(logger, <FoundrySocket><unknown>game.socket, game.user, game.users.contents);

        return RemoteExecutor._instance;
    }

    onMessage(message: Message): void {
        this.logger.debug('New/pending messages', message, Object.keys(this.pendingMessages));

        if (message.type === 'markerUpdated' && message.id in this.pendingMessages)  {
            this.resolveUpdateMarkerRequest(message);
        } else if (message.type === 'updateMarker') {
            this.processUpdateMarkerRequest(message);
        }
    }

    updateMarker(macroId: string, isActive: boolean, flag: Flaggable ): Promise<unknown> {
        const messageId = this.generateId();
        const executingGM = this.chooseExecutingGM();
        if (!executingGM) {
            this.logger.error('No GM online to update the marker.');
            return Promise.reject();
        }

        return new Promise((resolve, reject) => {
            const message: UpdateMarkerMessage = {
                type: 'updateMarker',
                macroId: macroId,
                isActive: isActive,
                entity: {
                    type: flag.markerType,
                    id: flag.id
                },
                id: messageId,
                forGM: executingGM
            };

            const timeOut = setTimeout(() => {
                this.logger.error('Remote Execution | No response received after time-out.', messageId);
                delete this.pendingMessages[messageId];
                reject();
            }, 30_000);

            function clearRes(res: Resolution) {
                return (value) => {
                    clearTimeout(timeOut);
                    res(value);
                };
            }

            this.pendingMessages[messageId] = {
                resolve: clearRes(resolve),
                reject: clearRes(reject)
            };

            this.socket.emit(scope, message);
        });
    }

    private resolveUpdateMarkerRequest(message: Message) {
        if (message.error)
            this.pendingMessages[message.id].reject(message.error);
        else
            this.pendingMessages[message.id].resolve();

        delete this.pendingMessages[message.id];
    }

    private processUpdateMarkerRequest(message: Message) {
        const msg: UpdateMarkerMessage = <UpdateMarkerMessage>message;
        if (!this.isExecutingGM(msg))
            return;

        const macro = game.macros.get(msg.macroId);
        if (!macro) {
            this.logger.error('Executing as GM | Macro not found', msg.macroId);
            this.confirmUpdate(msg, 'Macro not found');
            return;
        }

        const entity = { id: msg.entity.id, markerType: msg.entity.type };
        const logger = new NotifiedLogger(new ConsoleLogger());
        const marker = new MacroMarkerFlags(logger, macro);
        marker.addMarker(entity, msg.isActive).then(() => this.confirmUpdate(msg));
    }

    private confirmUpdate(message: UpdateMarkerMessage, error?: string) {
        this.socket.emit(scope, { ...message, error, type: 'markerUpdated' });
    }

    private isExecutingGM(msg: UpdateMarkerMessage): boolean {
        return game.user.id === msg.forGM;
    }

    private chooseExecutingGM(): string | undefined {
        const gmIds = game.users.filter(u => u.isGM && u.active).map(u => u.id);
        const randIndex = Math.floor(Math.random() * gmIds.length);
        return gmIds[randIndex];
    }

    private generateId(len = 8) {
        function dec2hex (dec) {
            return dec < 10
                ? '0' + String(dec)
                : dec.toString(16);
        }

        const arr = new Uint8Array((len || 40) / 2);
        window.crypto.getRandomValues(arr);
        return Array.from(arr, dec2hex).join('');
    }
}