import { randomUUID } from "crypto";
import * as path from "path";
import { z } from "zod";

import type { DiogenesConfig } from "../types";
import type { LoadSessionParams, StoredSessionMetadata } from "./types";

import { getDefaultSessionsStorageRoot, SessionSnapshotManager } from "../snapshot/manager";
import { ACPSession, type ACPNotificationSink } from "./session";
import { SessionStore } from "./session-store";

const SessionListCursorSchema = z.object({
    updatedAt: z.string(),
    sessionId: z.string(),
});

const DEFAULT_SESSION_LIST_PAGE_SIZE = 20;
const MAX_SESSION_LIST_PAGE_SIZE = 100;

interface SessionListCursor {
    updatedAt: string;
    sessionId: string;
}

export class SessionManager {
    private readonly sessions = new Map<string, ACPSession>();
    private readonly sessionStore = new SessionStore();

    constructor(
        private readonly config: DiogenesConfig,
        private readonly maxIterations: number | undefined,
        private readonly notify: ACPNotificationSink,
    ) {}

    async createSession(cwd: string): Promise<ACPSession> {
        const sessionId = randomUUID();
        const resolvedCwd = path.resolve(cwd);
        const session = new ACPSession(
            sessionId,
            resolvedCwd,
            this.config,
            this.maxIterations,
            this.notify,
            this.sessionStore,
        );

        const snapshotConfig = this.config.security?.snapshot;

        if (snapshotConfig?.enabled) {
            const snapshotManager = new SessionSnapshotManager({
                sessionId,
                cwd: resolvedCwd,
                config: {
                    ...snapshotConfig,
                    storageRoot: getDefaultSessionsStorageRoot(),
                    resticBinaryArgs: snapshotConfig.resticBinaryArgs || [],
                },
                stateProvider: session,
                stateRestorer: session,
            });

            try {
                await snapshotManager.initialize();
            } catch (error) {
                await snapshotManager.cleanup().catch(() => undefined);
                await this.sessionStore.removeSession(sessionId).catch(() => undefined);
                throw error;
            }

            session.attachSnapshotManager(snapshotManager);
        }

        this.sessions.set(sessionId, session);
        await this.sessionStore.writeMetadata(session.getStoredMetadata());
        await this.sessionStore.writeState(sessionId, session.getPersistedState());
        return session;
    }

    async loadSession(params: LoadSessionParams): Promise<ACPSession> {
        const existing = this.sessions.get(params.sessionId);
        if (existing) {
            if (path.resolve(params.cwd) !== existing.cwd) {
                throw new Error(`Session cwd mismatch for ${params.sessionId}`);
            }
            return existing;
        }

        const metadata = await this.sessionStore.readMetadata(params.sessionId);
        const state = await this.sessionStore.readState(params.sessionId);
        if (!metadata || !state) {
            throw new Error(`Unknown session: ${params.sessionId}`);
        }

        const resolvedCwd = path.resolve(params.cwd);
        if (resolvedCwd !== path.resolve(metadata.cwd)) {
            throw new Error(`Session cwd mismatch for ${params.sessionId}`);
        }

        const session = new ACPSession(
            params.sessionId,
            resolvedCwd,
            this.config,
            this.maxIterations,
            this.notify,
            this.sessionStore,
            {
                createdAt: metadata.createdAt,
                updatedAt: metadata.updatedAt,
                title: metadata.title,
                description: metadata.description,
            },
        );

        const snapshotConfig = this.config.security?.snapshot;
        if (snapshotConfig?.enabled) {
            const snapshotManager = new SessionSnapshotManager({
                sessionId: params.sessionId,
                cwd: resolvedCwd,
                config: {
                    ...snapshotConfig,
                    storageRoot: getDefaultSessionsStorageRoot(),
                    resticBinaryArgs: snapshotConfig.resticBinaryArgs || [],
                },
                stateProvider: session,
                stateRestorer: session,
            });
            session.attachSnapshotManager(snapshotManager);
        }

        await session.restorePersistedState(
            {
                ...state,
                cwd: resolvedCwd,
            },
            {
                persist: false,
                emitPlanUpdate: false,
                preserveTimestamps: true,
            },
        );
        this.sessions.set(params.sessionId, session);
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

    async closeSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }

        const hasMessages = session.getMessageHistory().length > 0;
        if (!hasMessages) {
            await session.dispose();
            this.sessions.delete(sessionId);
            await this.sessionStore.removeSession(sessionId);
            return true;
        }

        await session.persistClosedState();
        await session.dispose();
        this.sessions.delete(sessionId);
        return true;
    }

    async deleteSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.dispose();
            this.sessions.delete(sessionId);
        } else {
            const storedSession = await this.sessionStore.readMetadata(sessionId);
            if (!storedSession) {
                return false;
            }
        }

        await this.sessionStore.removeSession(sessionId);
        return true;
    }

    async disposeAllSessions(): Promise<void> {
        const sessionIds = Array.from(this.sessions.keys());

        for (const sessionId of sessionIds) {
            await this.closeSession(sessionId);
        }
    }

    listSessions(): ACPSession[] {
        return Array.from(this.sessions.values());
    }

    async listSessionMetadata(
        options: {
            cwd?: string;
            includeSnapshots?: boolean;
            cursor?: string;
            pageSize?: number;
        } = {},
    ): Promise<{
        sessions: Array<
            StoredSessionMetadata & {
                snapshotCount: number;
                snapshots?: Awaited<ReturnType<ACPSession["listSnapshots"]>>;
            }
        >;
        nextCursor: string | null;
        pageSize: number;
    }> {
        const liveSessions = this.listSessions();
        const storedSessions = await this.sessionStore.listMetadata();
        const merged = new Map<string, StoredSessionMetadata>();

        for (const session of storedSessions) {
            merged.set(session.sessionId, session);
        }

        for (const session of liveSessions) {
            merged.set(session.sessionId, session.getStoredMetadata());
        }

        const filteredSessions = Array.from(merged.values())
            .filter((session) => (options.cwd ? session.cwd === options.cwd : true))
            .sort((left, right) => compareSessionOrdering(left, right));

        const cursor = decodeSessionListCursor(options.cursor);
        const pageSize = normalizePageSize(options.pageSize);
        const pagedSessions = cursor
            ? filteredSessions.filter((session) => compareSessionOrdering(session, cursor) > 0)
            : filteredSessions;
        const page = pagedSessions.slice(0, pageSize);

        const sessions = await Promise.all(
            page.map(async (session) => {
                const snapshots = await this.sessionStore.listSnapshots(session.sessionId);
                return {
                    ...session,
                    snapshotCount: snapshots.length,
                    ...(options.includeSnapshots ? { snapshots } : {}),
                };
            }),
        );

        const lastSession = page.at(-1);
        return {
            sessions,
            nextCursor:
                pagedSessions.length > pageSize && lastSession
                    ? encodeSessionListCursor({
                          updatedAt: lastSession.updatedAt,
                          sessionId: lastSession.sessionId,
                      })
                    : null,
            pageSize,
        };
    }

    async getSessionMetadata(
        sessionId: string,
        options: { includeSnapshots?: boolean } = {},
    ): Promise<
        | (StoredSessionMetadata & { snapshots?: Awaited<ReturnType<ACPSession["listSnapshots"]>> })
        | null
    > {
        const liveSession = this.sessions.get(sessionId);
        const metadata =
            liveSession?.getStoredMetadata() ?? (await this.sessionStore.readMetadata(sessionId));

        if (!metadata) {
            return null;
        }

        return {
            ...metadata,
            ...(options.includeSnapshots
                ? { snapshots: await this.sessionStore.listSnapshots(sessionId) }
                : {}),
        };
    }

    async listSnapshots(
        sessionId: string,
    ): Promise<Awaited<ReturnType<ACPSession["listSnapshots"]>> | null> {
        const metadata = await this.sessionStore.readMetadata(sessionId);
        if (!metadata && !this.sessions.has(sessionId)) {
            return null;
        }

        return this.sessionStore.listSnapshots(sessionId);
    }

    async pruneSessions(
        options: { dryRun?: boolean } = {},
    ): Promise<import("./session-store").SessionPruneResult> {
        return this.sessionStore.pruneSessions(options);
    }
}

function normalizePageSize(pageSize: number | undefined): number {
    if (typeof pageSize !== "number" || Number.isNaN(pageSize)) {
        return DEFAULT_SESSION_LIST_PAGE_SIZE;
    }

    return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_SESSION_LIST_PAGE_SIZE);
}

function encodeSessionListCursor(cursor: SessionListCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSessionListCursor(cursor: string | undefined): SessionListCursor | null {
    if (!cursor) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        const result = SessionListCursorSchema.safeParse(parsed);
        if (result.success) {
            return result.data;
        }
        return null;
    } catch {
        return null;
    }
}

function compareSessionOrdering(
    left: Pick<StoredSessionMetadata, "updatedAt" | "sessionId">,
    right: Pick<StoredSessionMetadata, "updatedAt" | "sessionId">,
): number {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdatedAt !== 0) {
        return byUpdatedAt;
    }

    return left.sessionId.localeCompare(right.sessionId);
}
