/**
 * Wizard utility functions
 */

import * as fs from "fs";
import * as yaml from "yaml";
import type { ModelsConfig, ProviderDefinition } from "../../types";
import { getProviderApiKeyEnvVarName, getProviderApiKey } from "../../utils/api-key-manager";
import { t } from "./i18n";

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
};

export function printSuccess(message: string): void {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
}

export function printWarning(message: string): void {
    console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

export function printInfo(message: string): void {
    console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}

export function printError(message: string): void {
    console.log(`${colors.red}✗${colors.reset} ${message}`);
}

export function printHeader(title: string): void {
    console.log(`\n${colors.bright}${colors.cyan}${title}${colors.reset}`);
    console.log("".padEnd(title.length, "─"));
}

export function formatProviderStatus(providerName: string, provider: ProviderDefinition): string {
    const envVarName = getProviderApiKeyEnvVarName(providerName);
    const hasApiKey = getProviderApiKey(providerName) !== undefined;
    const apiKeyStatus = hasApiKey
        ? `${colors.green}${t("status.set")}${colors.reset}`
        : `${colors.yellow}${t("status.notSet")}${colors.reset}`;

    const modelCount = Object.keys(provider.models).length;
    return `${providerName} (${provider.style}, ${modelCount} ${t("unit.models")}, ${envVarName}: ${apiKeyStatus})`;
}

export function formatModelRef(providerName: string, modelName: string): string {
    return `${providerName}/${modelName}`;
}

export function parseModelRef(modelRef: string): { provider: string; model: string } | null {
    const slashIndex = modelRef.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
        return null;
    }
    return {
        provider: modelRef.slice(0, slashIndex),
        model: modelRef.slice(slashIndex + 1),
    };
}

export function saveModelsConfig(config: ModelsConfig, configPath: string): void {
    const banner = [
        "# Diogenes models configuration",
        "# Define providers and their models here.",
        "# API keys are loaded from <PROVIDER>_API_KEY environment variables.",
        "",
    ].join("\n");

    fs.writeFileSync(configPath, `${banner}${yaml.stringify(config)}`, "utf8");
}

export function countModels(config: ModelsConfig): number {
    let count = 0;
    for (const provider of Object.values(config.providers)) {
        count += Object.keys(provider.models).length;
    }
    return count;
}

export function getCurrentDefaultModel(config: ModelsConfig): string | null {
    return config.default ?? null;
}

export function listAllModelChoices(config: ModelsConfig): Array<{ name: string; value: string }> {
    const choices: Array<{ name: string; value: string }> = [];

    for (const [providerName, provider] of Object.entries(config.providers)) {
        for (const [modelName, model] of Object.entries(provider.models)) {
            const fullRef = formatModelRef(providerName, modelName);
            const isDefault = fullRef === config.default;
            const displayName = model.name || modelName;
            const marker = isDefault ? "★ " : "";
            choices.push({
                name: `${marker}${displayName} (${fullRef})`,
                value: fullRef,
            });
        }
    }

    return choices;
}

/**
 * Symbol to indicate user cancelled the prompt (ESC key)
 */
export const CANCELLED = Symbol("CANCELLED");

/**
 * Context options for inquirer prompts with abort signal support
 */
export interface CancelableContext {
    signal?: AbortSignal;
}

/**
 * Wraps a prompt function to support ESC key cancellation.
 * Uses AbortController to cancel the prompt when user presses ESC.
 */
export async function withCancel<T>(
    promptFn: (context: CancelableContext) => Promise<T>,
): Promise<T | typeof CANCELLED> {
    const controller = new AbortController();
    const { signal } = controller;

    // Listen for ESC key
    const keyListener = (data: Buffer): void => {
        const key = data.toString();
        // ESC key is \x1b
        if (key === "\x1b") {
            controller.abort();
        }
    };

    // Set up raw mode to capture individual keypresses
    const setupRawMode = (): void => {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on("data", keyListener);
        }
    };

    const cleanupRawMode = (): void => {
        if (process.stdin.isTTY) {
            process.stdin.off("data", keyListener);
            process.stdin.setRawMode(false);
            process.stdin.pause();
        }
    };

    setupRawMode();

    return promptFn({ signal })
        .then((result) => {
            cleanupRawMode();
            return result;
        })
        .catch((error: unknown) => {
            cleanupRawMode();
            // Handle both AbortError and AbortPromptError from @inquirer/prompts
            if (error instanceof Error) {
                if (error.name === "AbortError" || error.name === "AbortPromptError") {
                    return CANCELLED;
                }
            }
            throw error;
        });
}

/**
 * Check if result indicates user cancelled
 */
export function isCancelled<T>(result: T | typeof CANCELLED): result is typeof CANCELLED {
    return result === CANCELLED;
}
