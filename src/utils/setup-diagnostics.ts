import * as fs from "fs";

import type { DiogenesConfig } from "../types";

import { getACPLogPaths } from "../acp/logger";
import { getProviderApiKeyEnvVarName } from "./api-key-manager";
import { resolveDiogenesAppPaths } from "./app-paths";
import { ensureDefaultConfigFileSync, ensureDefaultModelsConfigSync } from "./config-bootstrap";
import { loadModelsConfig } from "./model-resolver";

export interface ProviderSetupStatus {
    provider: string;
    envVarName: string;
    configured: boolean;
}

export interface SnapshotSetupStatus {
    mode: "enabled" | "disabled" | "degraded";
    requested: boolean;
    enabled: boolean;
    resticBinary?: string;
    unavailableReason?: string;
    unavailablePhase?: string;
    unavailableKind?: string;
}

export interface SetupDiagnostics {
    configPath: string;
    modelsPath: string;
    configExists: boolean;
    modelsExists: boolean;
    configDir: string;
    dataDir: string;
    acpLogsDir: string;
    acpCurrentLogFile: string;
    providers: ProviderSetupStatus[];
    snapshot: SnapshotSetupStatus;
}

export function collectSetupDiagnostics(config: DiogenesConfig): SetupDiagnostics {
    const appPaths = resolveDiogenesAppPaths();
    const configPath = ensureDefaultConfigFileSync();
    const modelsPath = ensureDefaultModelsConfigSync();
    const modelsConfig = loadModelsConfig(modelsPath);
    const logPaths = getACPLogPaths(appPaths);
    const providerNames = Object.keys(modelsConfig?.providers || {});
    const snapshot = config.security?.snapshot;
    const requested = snapshot?.requestedEnabled ?? snapshot?.enabled ?? false;
    const enabled = snapshot?.enabled === true;
    const unavailableReason = snapshot?.unavailableReason;
    const classified = classifyUnavailableReason(unavailableReason);
    const mode = enabled ? "enabled" : requested && unavailableReason ? "degraded" : "disabled";

    return {
        configPath,
        modelsPath,
        configExists: fs.existsSync(configPath),
        modelsExists: fs.existsSync(modelsPath),
        configDir: appPaths.configDir,
        dataDir: appPaths.dataDir,
        acpLogsDir: logPaths.logsDir,
        acpCurrentLogFile: logPaths.currentLogFilePath,
        providers: providerNames.map((provider) => {
            const envVarName = getProviderApiKeyEnvVarName(provider);
            return {
                provider,
                envVarName,
                configured:
                    typeof process.env[envVarName] === "string" && process.env[envVarName] !== "",
            };
        }),
        snapshot: {
            mode,
            requested,
            enabled,
            resticBinary: snapshot?.resticBinary,
            unavailableReason,
            unavailablePhase: classified?.phase,
            unavailableKind: classified?.kind,
        },
    };
}

function classifyUnavailableReason(
    reason: string | undefined,
): { phase?: string; kind?: string } | undefined {
    if (!reason) {
        return undefined;
    }

    const match = /^(?<phase>[a-z_]+):(?<kind>[a-z_]+):\s*/i.exec(reason);
    if (!match?.groups) {
        return undefined;
    }

    return {
        phase: match.groups.phase,
        kind: match.groups.kind,
    };
}
