import * as path from "path";
import type { DiogenesConfig } from "../types";
import { ACPSession, type ACPNotificationSink } from "./session";

export class SessionManager {
    private readonly sessions = new Map<string, ACPSession>();
    private nextId = 1;

    constructor(
        private readonly config: DiogenesConfig,
        private readonly maxIterations: number | undefined,
        private readonly notify: ACPNotificationSink,
    ) {}

    createSession(cwd: string): ACPSession {
        const sessionId = `session-${this.nextId++}`;
        const session = new ACPSession(
            sessionId,
            path.resolve(cwd),
            this.config,
            this.maxIterations,
            this.notify,
        );
        this.sessions.set(sessionId, session);
        return session;
    }

    getSession(sessionId: string): ACPSession | undefined {
        return this.sessions.get(sessionId);
    }

    cancelSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        session.cancel();
        return true;
    }

    async disposeSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }

        await session.dispose();
        this.sessions.delete(sessionId);
        return true;
    }

    async disposeAllSessions(): Promise<void> {
        const sessionIds = Array.from(this.sessions.keys());

        for (const sessionId of sessionIds) {
            await this.disposeSession(sessionId);
        }
    }

    listSessions(): ACPSession[] {
        return Array.from(this.sessions.values());
    }
}
