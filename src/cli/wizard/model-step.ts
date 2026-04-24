/**
 * Model configuration step - standalone model management
 */

import { select, confirm } from "@inquirer/prompts";

import type { ModelsConfig } from "../../types";
import { printHeader, formatModelRef, withCancel, isCancelled, CANCELLED } from "./utils";
import { t } from "./i18n";
import type { StepResult } from "./types";

export async function runModelStep(config: ModelsConfig): Promise<StepResult> {
    printHeader(t("model.title"));

    const providers = Object.keys(config.providers);
    if (providers.length === 0) {
        printWarning(t("model.noProviders"));
        return { next: "menu", changed: false };
    }

    const providerChoices = providers.map((name) => ({
        name: `${name} (${Object.keys(config.providers[name].models).length} ${t("unit.models")})`,
        value: name,
    }));

    const providerName = await withCancel(async (ctx) =>
        select({
            message: t("model.selectProvider"),
            choices: providerChoices,
        }, ctx),
    );
    if (isCancelled(providerName)) return { next: "menu", changed: false };

    const provider = config.providers[providerName];

    const action = await withCancel(async (ctx) =>
        select({
            message: t("model.manageForProvider", { provider: providerName }),
            choices: [
                { name: t("model.action.add"), value: "add" },
                { name: t("model.action.edit"), value: "edit" },
                { name: t("model.action.delete"), value: "delete" },
                { name: t("model.action.back"), value: "back" },
            ],
        }, ctx),
    );
    if (isCancelled(action)) return { next: "menu", changed: false };

    switch (action) {
        case "add": {
            const { addModelInteractive } = await import("./provider-step");
            const modelResult = await addModelInteractive(providerName);
            if (modelResult === CANCELLED) return { next: "menu", changed: false };
            provider.models[modelResult.name] = modelResult.definition;

            const setAsDefault = await withCancel(async (ctx) =>
                confirm({
                    message: t("model.setAsDefault"),
                    default: false,
                }, ctx),
            );
            if (isCancelled(setAsDefault)) return { next: "menu", changed: true };

            if (setAsDefault) {
                config.default = formatModelRef(providerName, modelResult.name);
                printSuccess(t("model.defaultSet"));
            }

            printSuccess(t("model.added", { name: modelResult.name }));
            return { next: "menu", changed: true };
        }
        case "edit": {
            const modelNames = Object.keys(provider.models);
            if (modelNames.length === 0) {
                printWarning(t("model.noModels"));
                return { next: "menu", changed: false };
            }

            const modelName = await withCancel(async (ctx) =>
                select({
                    message: t("model.selectModel"),
                    choices: modelNames.map((name) => {
                        const model = provider.models[name];
                        return {
                            name: `${model.name || name} (${name})`,
                            value: name,
                        };
                    }, ctx),
                }, ctx),
            );
            if (isCancelled(modelName)) return { next: "menu", changed: false };

            const { editModelInteractive } = await import("./provider-step");
            const updated = await editModelInteractive(provider.models[modelName]);
            provider.models[modelName] = updated;
            printSuccess(t("model.edited", { name: modelName }));
            return { next: "menu", changed: true };
        }
        case "delete": {
            const modelNames = Object.keys(provider.models);
            if (modelNames.length === 0) {
                printWarning(t("model.noModels"));
                return { next: "menu", changed: false };
            }
            if (modelNames.length === 1) {
                printWarning(t("model.cannotDeleteLast"));
                return { next: "menu", changed: false };
            }

            const modelName = await withCancel(async (ctx) =>
                select({
                    message: t("model.selectModel"),
                    choices: modelNames.map((name) => ({
                        name: `${provider.models[name].name || name} (${name})`,
                        value: name,
                    })),
                }, ctx),
            );
            if (isCancelled(modelName)) return { next: "menu", changed: false };

            const confirmDelete = await withCancel(async (ctx) =>
                confirm({
                    message: t("model.deleteConfirm", { name: modelName }),
                    default: false,
                }, ctx),
            );
            if (isCancelled(confirmDelete)) return { next: "menu", changed: false };

            if (confirmDelete) {
                const fullRef = formatModelRef(providerName, modelName);
                if (config.default === fullRef) {
                    delete config.default;
                    printWarning(t("model.defaultCleared"));
                }

                delete provider.models[modelName];
                printSuccess(t("model.deleted", { name: modelName }));
                return { next: "menu", changed: true };
            }

            return { next: "menu", changed: false };
        }
        case "back":
            return { next: "menu", changed: false };
    }

    return { next: "menu", changed: false };
}

function printSuccess(message: string): void {
    const colors = {
        green: "\x1b[32m",
        reset: "\x1b[0m",
    };
    console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function printWarning(message: string): void {
    const colors = {
        yellow: "\x1b[33m",
        reset: "\x1b[0m",
    };
    console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}
