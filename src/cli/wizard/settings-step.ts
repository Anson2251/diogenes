/**
 * Settings configuration step
 */

import { select, confirm, input } from "@inquirer/prompts";
import * as fs from "fs";
import * as yaml from "yaml";

import type { ModelsConfig } from "../../types";
import { printHeader, printSuccess, printInfo, printWarning, withCancel, isCancelled } from "./utils";
import { t } from "./i18n";
import type { StepResult } from "./types";

export interface ConfigYaml {
    security?: {
        snapshot?: {
            enabled?: boolean;
            includeDiogenesState?: boolean;
            autoBeforePrompt?: boolean;
        };
        workspaceRoot?: string;
        shell?: {
            enabled?: boolean;
            timeout?: number;
        };
    };
    llm?: {
        model?: string;
        temperature?: number;
    };
}

export async function runSettingsStep(
    config: ModelsConfig,
    configPath: string,
): Promise<StepResult> {
    printHeader(t("settings.title"));

    const action = await withCancel(async (ctx) =>
        select({
            message: t("settings.selectCategory"),
            choices: [
                { name: t("settings.category.snapshot"), value: "snapshot" },
                { name: t("settings.category.workspace"), value: "workspace" },
                { name: t("settings.category.shell"), value: "shell" },
                { name: t("settings.category.view"), value: "view" },
                { name: t("common.back"), value: "back" },
            ],
        }, ctx),
    );
    if (isCancelled(action)) return { next: "menu", changed: false };

    switch (action) {
        case "snapshot": {
            const result = await configureSnapshot(configPath);
            return result;
        }
        case "workspace": {
            const result = await configureWorkspace(configPath);
            return result;
        }
        case "shell": {
            const result = await configureShell(configPath);
            return result;
        }
        case "view": {
            const result = await viewCurrentConfig(configPath);
            return result;
        }
        case "back":
            return { next: "menu", changed: false };
    }

    return { next: "menu", changed: false };
}

async function configureSnapshot(configPath: string): Promise<StepResult> {
    printHeader(t("snapshot.title"));

    const config = loadConfig(configPath);

    const enabled = await withCancel(async (ctx) =>
        confirm({
            message: t("snapshot.enabled"),
            default: config.security?.snapshot?.enabled ?? true,
        }, ctx),
    );
    if (isCancelled(enabled)) return { next: "menu", changed: false };

    const includeDiogenesState = await withCancel(async (ctx) =>
        confirm({
            message: t("snapshot.includeDiogenesState"),
            default: config.security?.snapshot?.includeDiogenesState ?? false,
        }, ctx),
    );
    if (isCancelled(includeDiogenesState)) return { next: "menu", changed: false };

    const autoBeforePrompt = await withCancel(async (ctx) =>
        confirm({
            message: t("snapshot.autoBeforePrompt"),
            default: config.security?.snapshot?.autoBeforePrompt ?? true,
        }, ctx),
    );
    if (isCancelled(autoBeforePrompt)) return { next: "menu", changed: false };

    config.security = config.security || {};
    config.security.snapshot = {
        enabled,
        includeDiogenesState,
        autoBeforePrompt,
    };

    saveConfig(config, configPath);
    printSuccess(t("snapshot.saved"));

    return { next: "menu", changed: true };
}

async function configureWorkspace(configPath: string): Promise<StepResult> {
    printHeader(t("workspace.title"));

    const config = loadConfig(configPath);

    const currentRoot = config.security?.workspaceRoot || process.cwd();

    const workspaceRoot = await withCancel(async (ctx) =>
        input({
            message: t("workspace.root"),
            default: currentRoot,
        }, ctx),
    );
    if (isCancelled(workspaceRoot)) return { next: "menu", changed: false };

    if (workspaceRoot && workspaceRoot !== currentRoot) {
        config.security = config.security || {};
        config.security.workspaceRoot = workspaceRoot;
        saveConfig(config, configPath);
        printSuccess(t("workspace.saved", { path: workspaceRoot }));
        return { next: "menu", changed: true };
    }

    printInfo(t("workspace.noChange"));
    return { next: "menu", changed: false };
}

async function configureShell(configPath: string): Promise<StepResult> {
    printHeader(t("shell.title"));

    const config = loadConfig(configPath);

    const enabled = await withCancel(async (ctx) =>
        confirm({
            message: t("shell.enabled"),
            default: config.security?.shell?.enabled ?? true,
        }, ctx),
    );
    if (isCancelled(enabled)) return { next: "menu", changed: false };

    const timeoutInput = await withCancel(async (ctx) =>
        input({
            message: t("shell.timeout"),
            default: String(config.security?.shell?.timeout ?? 60),
        }, ctx),
    );
    if (isCancelled(timeoutInput)) return { next: "menu", changed: false };

    const timeout = Number.parseInt(timeoutInput, 10) || 60;

    config.security = config.security || {};
    config.security.shell = {
        enabled,
        timeout,
    };

    saveConfig(config, configPath);
    printSuccess(t("shell.saved"));

    return { next: "menu", changed: true };
}

async function viewCurrentConfig(configPath: string): Promise<StepResult> {
    printHeader(t("configView.title"));

    if (!fs.existsSync(configPath)) {
        printWarning(t("configView.notFound"));
        return { next: "menu", changed: false };
    }

    const content = fs.readFileSync(configPath, "utf8");
    console.log("\n" + content);

    await withCancel(async (ctx) =>
        confirm({
            message: t("configView.pressContinue"),
            default: true,
        }, ctx),
    );

    return { next: "menu", changed: false };
}

function loadConfig(configPath: string): ConfigYaml {
    if (!fs.existsSync(configPath)) {
        return {};
    }
    const content = fs.readFileSync(configPath, "utf8");
    try {
        const parsed: unknown = yaml.parse(content);
        if (typeof parsed === "object" && parsed !== null) {
            return parsed as ConfigYaml;
        }
        return {};
    } catch {
        return {};
    }
}

function saveConfig(config: ConfigYaml, configPath: string): void {
    const banner = [
        "# Diogenes configuration",
        "# Generated automatically.",
        "# Use 'diogenes model use <provider/model>' to set the active model.",
        "# Use 'diogenes model default <provider/model>' to set the fallback default model.",
        "",
    ].join("\n");

    fs.writeFileSync(configPath, `${banner}${yaml.stringify(config)}`, "utf8");
}
