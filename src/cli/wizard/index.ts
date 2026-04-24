/**
 * Configuration wizard for Diogenes CLI
 *
 * Provides interactive configuration for:
 * - Providers and models
 * - Default model selection
 * - Basic settings (snapshots, workspace, shell)
 */

import { select, confirm } from "@inquirer/prompts";
import * as fs from "fs";

import type { ModelsConfig } from "../../types";
import { resolveDiogenesAppPaths } from "../../utils/app-paths";
import { parseModelsConfig } from "../../utils/models-config";
import { getManagedModelsConfigPathSync, getManagedDefaultConfigPathSync } from "../../utils/config-bootstrap";

import { runProviderStep } from "./provider-step";
import { runModelStep } from "./model-step";
import { runQuickDefaultStep } from "./quick-default";
import { runSettingsStep } from "./settings-step";
import { printSuccess, printInfo, saveModelsConfig, countModels, withCancel, isCancelled } from "./utils";
import { t } from "./i18n";
import type { WizardStep, WizardOptions, WizardContext } from "./types";

const colors = {
    bright: "\x1b[1m",
    cyan: "\x1b[36m",
    reset: "\x1b[0m",
    dim: "\x1b[2m",
};

/**
 * Run the configuration wizard
 */
export async function runWizard(options: WizardOptions = {}): Promise<void> {
    const modelsConfigPath = getManagedModelsConfigPathSync();
    const configPath = getManagedDefaultConfigPathSync();

    const appPaths = resolveDiogenesAppPaths();
    if (!fs.existsSync(appPaths.configDir)) {
        fs.mkdirSync(appPaths.configDir, { recursive: true });
    }

    let modelsConfig: ModelsConfig;
    if (fs.existsSync(modelsConfigPath)) {
        const content = fs.readFileSync(modelsConfigPath, "utf8");
        modelsConfig = parseModelsConfig(content);
    } else {
        modelsConfig = { providers: {} };
    }

    const context: WizardContext = {
        modelsConfig,
        modelsConfigPath,
        configPath,
        changed: false,
    };

    function isValidStep(step: string): step is WizardStep {
        return ["menu", "provider", "model", "default", "settings", "done"].includes(step);
    }
    const requestedStep = options.step || "menu";
    let currentStep: WizardStep = isValidStep(requestedStep) ? requestedStep : "menu";

    if (requestedStep && requestedStep !== "menu") {
        const result = await runStep(currentStep, context);
        if (result.changed) {
            context.changed = true;
        }
        currentStep = result.next;
    }

    while (currentStep !== "done") {
        const result = await runStep(currentStep, context);
        if (result.changed) {
            context.changed = true;
        }
        currentStep = result.next;
    }

    if (context.changed) {
        saveModelsConfig(context.modelsConfig, context.modelsConfigPath);
        printSuccess(t("wizard.saved", { path: context.modelsConfigPath }));
    } else {
        printInfo(t("wizard.noChanges"));
    }
}

async function runStep(step: WizardStep, context: WizardContext): Promise<{ next: WizardStep; changed: boolean }> {
    switch (step) {
        case "menu": {
            const result = await runMainMenu(context);
            return result;
        }
        case "provider": {
            const result = await runProviderStep(context.modelsConfig);
            return result;
        }
        case "model": {
            const result = await runModelStep(context.modelsConfig);
            return result;
        }
        case "default": {
            const result = await runQuickDefaultStep(context.modelsConfig);
            return result;
        }
        case "settings": {
            const result = await runSettingsStep(context.modelsConfig, context.configPath);
            return result;
        }
        case "done":
            return { next: "done", changed: false };
        default:
            return { next: "done", changed: false };
    }
}

async function runMainMenu(context: WizardContext): Promise<{ next: WizardStep; changed: boolean }> {
    console.clear();
    console.log(`${colors.bright}${colors.cyan}║\n║  ${t("wizard.title")}\n║\n${colors.reset}`);

    const providerCount = Object.keys(context.modelsConfig.providers).length;
    const modelCount = countModels(context.modelsConfig);
    const defaultModel = context.modelsConfig.default || t("wizard.notSet");

    console.log(`${colors.dim}${t("wizard.currentConfig")}:${colors.reset}`);
    console.log(`  ${t("wizard.providers")}: ${providerCount}`);
    console.log(`  ${t("wizard.models")}: ${modelCount}`);
    console.log(`  ${t("wizard.defaultModel")}: ${defaultModel}`);
    console.log();

    const { getProviderApiKey, getProviderApiKeyEnvVarName } = await import("../../utils/api-key-manager");
    let hasMissingKey = false;
    for (const providerName of Object.keys(context.modelsConfig.providers)) {
        if (!getProviderApiKey(providerName)) {
            const envVarName = getProviderApiKeyEnvVarName(providerName);
            console.log(`${colors.dim}⚠ ${providerName}: ${envVarName} ${t("status.notSet")}${colors.reset}`);
            hasMissingKey = true;
        }
    }
    if (hasMissingKey) {
        console.log();
    }

    console.log(`${colors.dim}${t("wizard.pressEscToExit")}${colors.reset}`);
    console.log();

    const action = await withCancel(async (ctx) =>
        select<WizardStep>({
            message: t("wizard.selectAction"),
            choices: [
                { name: t("wizard.option.provider"), value: "provider" },
                { name: t("wizard.option.model"), value: "model" },
                { name: t("wizard.option.default"), value: "default" },
                { name: t("wizard.option.settings"), value: "settings" },
                { name: t("wizard.option.done"), value: "done" },
            ],
        }, ctx),
    );

    // Handle ESC key press
    if (isCancelled(action)) {
        return { next: "done", changed: context.changed };
    }

    if (action === "done") {
        const confirmExit = await withCancel(async (ctx) =>
            confirm({
                message: t("wizard.saveConfirm"),
                default: true,
            }, ctx),
        );
        if (isCancelled(confirmExit) || confirmExit) {
            return { next: "done", changed: context.changed };
        }
        return { next: "menu", changed: false };
    }

    return { next: action, changed: false };
}

export { runProviderStep, runModelStep, runQuickDefaultStep, runSettingsStep };
export type { WizardOptions, WizardStep };
