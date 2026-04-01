import type { Logger as PinoLogger } from "pino";

import * as fs from "fs";
import * as path from "path";
import pino from "pino";
import { createStream } from "rotating-file-stream";

import type { DiogenesAppPaths } from "../utils/app-paths";

import { ensureDiogenesAppDirsSync, resolveDiogenesAppPaths } from "../utils/app-paths";

export type ACPLogger = PinoLogger;

export interface ACPLogPaths {
    logsDir: string;
    currentLogFilePath: string;
}

export function getACPLogPaths(
    appPaths: DiogenesAppPaths = resolveDiogenesAppPaths(),
): ACPLogPaths {
    const logsDir = path.join(appPaths.dataDir, "storage", "logs");
    return {
        logsDir,
        currentLogFilePath: path.join(logsDir, getACPLogFileName()),
    };
}

export function createACPLogger(
    appPaths: DiogenesAppPaths = ensureDiogenesAppDirsSync(),
): ACPLogger {
    const { logsDir } = getACPLogPaths(appPaths);
    fs.mkdirSync(logsDir, { recursive: true });
    const stream = createStream((time) => getACPLogFileName(normalizeRotationTime(time)), {
        path: logsDir,
        interval: "1d",
        intervalBoundary: true,
        compress: "gzip",
    });

    return pino(
        {
            level: "info",
            name: "diogenes-acp",
            timestamp: pino.stdTimeFunctions.isoTime,
        },
        stream,
    );
}

export function getACPLogFileName(date: Date = new Date()): string {
    return `acp-${formatACPLogDate(date)}.log`;
}

function formatACPLogDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizeRotationTime(time: Date | number | null | undefined): Date {
    if (time instanceof Date) {
        return time;
    }

    if (typeof time === "number") {
        return new Date(time);
    }

    return new Date();
}
