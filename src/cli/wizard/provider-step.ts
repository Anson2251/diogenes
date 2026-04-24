/**
 * Provider configuration step
 */

import { input, select, confirm, number } from "@inquirer/prompts";

import type { ModelsConfig, ProviderDefinition, ModelDefinition } from "../../types";
import { getProviderApiKeyEnvVarName, getProviderApiKey } from "../../utils/api-key-manager";
import { printHeader, printSuccess, printWarning, printInfo, formatProviderStatus, withCancel, isCancelled, CANCELLED } from "./utils";
import { t } from "./i18n";
import type { StepResult } from "./types";

export async function runProviderStep(config: ModelsConfig): Promise<StepResult> {
    printHeader(t("provider.title"));

    const action = await withCancel(async (ctx) =>
        select({
            message: t("provider.selectAction"),
            choices: [
                { name: t("provider.action.add"), value: "add" },
                { name: t("provider.action.edit"), value: "edit" },
                { name: t("provider.action.delete"), value: "delete" },
                { name: t("provider.action.back"), value: "back" },
            ],
        }, ctx),
    );

    // Handle ESC key press - return to menu
    if (isCancelled(action)) {
        return { next: "menu", changed: false };
    }

    switch (action) {
        case "add": {
            const result = await addProvider(config);
            return result;
        }
        case "edit": {
            const result = await editProvider(config);
            return result;
        }
        case "delete": {
            const result = await deleteProvider(config);
            return result;
        }
        case "back":
            return { next: "menu", changed: false };
    }

    return { next: "menu", changed: false };
}

async function addProvider(config: ModelsConfig): Promise<StepResult> {
    const name = await withCancel(async (ctx) =>
        input({
            message: t("provider.name"),
            validate: (value) => {
                if (!value || value.trim().length === 0) {
                    return t("provider.name.error.empty");
                }
                if (config.providers[value]) {
                    return t("provider.name.error.exists", { name: value });
                }
                if (!/^[a-z0-9-]+$/.test(value)) {
                    return t("provider.name.error.invalid");
                }
                return true;
            },
        }, ctx),
    );
    if (isCancelled(name)) return { next: "menu", changed: false };

    const style = await withCancel(async (ctx) =>
        select<"openai" | "anthropic">({
            message: t("provider.style"),
            choices: [
                { name: t("provider.style.openai"), value: "openai" },
                { name: t("provider.style.anthropic"), value: "anthropic" },
            ],
        }, ctx),
    );
    if (isCancelled(style)) return { next: "menu", changed: false };

    const baseURL = await withCancel(async (ctx) =>
        input({
            message: t("provider.baseURL"),
            default: getDefaultBaseURL(style),
        }, ctx),
    );
    if (isCancelled(baseURL)) return { next: "menu", changed: false };

    const supportsToolRole = await withCancel(async (ctx) =>
        confirm({
            message: t("provider.supportsToolRole"),
            default: false,
        }, ctx),
    );
    if (isCancelled(supportsToolRole)) return { next: "menu", changed: false };

    const supportsNativeToolCalls = await withCancel(async (ctx) =>
        confirm({
            message: t("provider.supportsNativeToolCalls"),
            default: true,
        }, ctx),
    );
    if (isCancelled(supportsNativeToolCalls)) return { next: "menu", changed: false };

    printInfo(t("provider.addModelHint"));
    const modelResult = await addModelInteractive(name);
    if (modelResult === CANCELLED) return { next: "menu", changed: false };

    const provider: ProviderDefinition = {
        style,
        baseURL: baseURL || undefined,
        supportsToolRole,
        supportsNativeToolCalls,
        models: {
            [modelResult.name]: modelResult.definition,
        },
    };

    config.providers[name] = provider;

    printSuccess(t("provider.added", { name }));

    const envVarName = getProviderApiKeyEnvVarName(name);
    const hasApiKey = getProviderApiKey(name);
    if (!hasApiKey) {
        printWarning(t("provider.apiKeyMissing", { envVar: envVarName }));
        printInfo(t("provider.apiKeyHint", { envVar: envVarName }));
    }

    const setAsDefault = await withCancel(async (ctx) =>
        confirm({
            message: t("provider.setAsDefault", { provider: name, model: modelResult.name }),
            default: true,
        }, ctx),
    );
    if (isCancelled(setAsDefault)) return { next: "menu", changed: true };

    if (setAsDefault) {
        config.default = `${name}/${modelResult.name}`;
        printSuccess(t("provider.defaultSet", { model: `${name}/${modelResult.name}` }));
    }

    return { next: "menu", changed: true };
}

async function editProvider(config: ModelsConfig): Promise<StepResult> {
    const providers = Object.keys(config.providers);
    if (providers.length === 0) {
        printWarning(t("provider.noProviders"));
        return { next: "menu", changed: false };
    }

    const choices = providers.map((name) => ({
        name: formatProviderStatus(name, config.providers[name]),
        value: name,
    }));

    const providerName = await withCancel(async (ctx) =>
        select({
            message: t("provider.selectProvider"),
            choices,
        }, ctx),
    );
    if (isCancelled(providerName)) return { next: "menu", changed: false };

    const provider = config.providers[providerName];

    const action = await withCancel(async (ctx) =>
        select({
            message: t("provider.editTitle", { name: providerName }),
            choices: [
                { name: t("provider.editOption.url"), value: "url" },
                { name: t("provider.editOption.settings"), value: "settings" },
                { name: t("provider.editOption.models"), value: "models" },
                { name: t("common.back"), value: "back" },
            ],
        }, ctx),
    );
    if (isCancelled(action)) return { next: "menu", changed: false };

    switch (action) {
        case "url": {
            const newURL = await withCancel(async (ctx) =>
                input({
                    message: t("provider.newBaseURL"),
                    default: provider.baseURL || getDefaultBaseURL(provider.style),
                }, ctx),
            );
            if (isCancelled(newURL)) return { next: "menu", changed: false };
            provider.baseURL = newURL || undefined;
            printSuccess(t("provider.baseURLUpdated"));
            return { next: "menu", changed: true };
        }
        case "settings": {
            const supportsToolRole = await withCancel(async (ctx) =>
                confirm({
                    message: t("provider.supportsToolRole"),
                    default: provider.supportsToolRole ?? false,
                }, ctx),
            );
            if (isCancelled(supportsToolRole)) return { next: "menu", changed: false };
            provider.supportsToolRole = supportsToolRole;

            const supportsNativeToolCalls = await withCancel(async (ctx) =>
                confirm({
                    message: t("provider.supportsNativeToolCalls"),
                    default: provider.supportsNativeToolCalls ?? true,
                }, ctx),
            );
            if (isCancelled(supportsNativeToolCalls)) return { next: "menu", changed: true };
            provider.supportsNativeToolCalls = supportsNativeToolCalls;

            printSuccess(t("provider.settingsUpdated"));
            return { next: "menu", changed: true };
        }
        case "models": {
            const result = await manageProviderModels(config, providerName);
            return result;
        }
    }

    return { next: "menu", changed: false };
}

async function deleteProvider(config: ModelsConfig): Promise<StepResult> {
    const providers = Object.keys(config.providers);
    if (providers.length === 0) {
        printWarning(t("provider.noProviders"));
        return { next: "menu", changed: false };
    }

    const providerName = await withCancel(async (ctx) =>
        select({
            message: t("provider.selectProvider"),
            choices: providers.map((name) => ({
                name: formatProviderStatus(name, config.providers[name]),
                value: name,
            })),
        }, ctx),
    );
    if (isCancelled(providerName)) return { next: "menu", changed: false };

    const confirmDelete = await withCancel(async (ctx) =>
        confirm({
            message: t("provider.deleteConfirm", { name: providerName }),
            default: false,
        }, ctx),
    );
    if (isCancelled(confirmDelete)) return { next: "menu", changed: false };

    if (confirmDelete) {
        const providerPrefix = `${providerName}/`;
        if (config.default?.startsWith(providerPrefix)) {
            delete config.default;
            printWarning(t("provider.defaultCleared", { provider: providerName }));
        }

        delete config.providers[providerName];
        printSuccess(t("provider.deleted", { name: providerName }));
        return { next: "menu", changed: true };
    }

    return { next: "menu", changed: false };
}

async function manageProviderModels(config: ModelsConfig, providerName: string): Promise<StepResult> {
    const provider = config.providers[providerName];

    const action = await withCancel(async (ctx) =>
        select({
            message: t("model.manageTitle", { provider: providerName }),
            choices: [
                { name: t("model.action.add"), value: "add" },
                { name: t("model.action.edit"), value: "edit" },
                { name: t("model.action.delete"), value: "delete" },
                { name: t("common.back"), value: "back" },
            ],
        }, ctx),
    );
    if (isCancelled(action)) return { next: "menu", changed: false };

    switch (action) {
        case "add": {
            const modelResult = await addModelInteractive(providerName);
            if (modelResult === CANCELLED) return { next: "menu", changed: false };
            provider.models[modelResult.name] = modelResult.definition;

            const setAsDefault = await withCancel(async (ctx) =>
                confirm({
                    message: t("provider.setAsDefault", { provider: providerName, model: modelResult.name }),
                    default: false,
                }, ctx),
            );
            if (isCancelled(setAsDefault)) return { next: "menu", changed: true };

            if (setAsDefault) {
                config.default = `${providerName}/${modelResult.name}`;
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
                const fullRef = `${providerName}/${modelName}`;
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
    }

    return { next: "menu", changed: false };
}

export async function addModelInteractive(_providerName: string): Promise<{ name: string; definition: ModelDefinition } | typeof CANCELLED> {
    const name = await withCancel(async (ctx) =>
        input({
            message: t("model.id"),
            validate: (value) => {
                if (!value || value.trim().length === 0) {
                    return t("model.id.error.empty");
                }
                return true;
            },
        }, ctx),
    );
    if (isCancelled(name)) return CANCELLED;

    const displayName = await withCancel(async (ctx) =>
        input({
            message: t("model.displayName"),
        }, ctx),
    );
    if (isCancelled(displayName)) return CANCELLED;

    const description = await withCancel(async (ctx) =>
        input({
            message: t("model.description"),
        }, ctx),
    );
    if (isCancelled(description)) return CANCELLED;

    const contextWindow = await withCancel(async (ctx) =>
        number({
            message: t("model.contextWindow"),
            default: 128000,
        }, ctx),
    );
    if (isCancelled(contextWindow)) return CANCELLED;

    const maxTokens = await withCancel(async (ctx) =>
        number({
            message: t("model.maxTokens"),
        }, ctx),
    );
    if (isCancelled(maxTokens)) return CANCELLED;

    const temperature = await withCancel(async (ctx) =>
        number({
            message: t("model.temperature"),
            default: 1,
        }, ctx),
    );
    if (isCancelled(temperature)) return CANCELLED;

    const supportsInterleavedThinking = await withCancel(async (ctx) =>
        confirm({
            message: t("model.supportsInterleavedThinking"),
            default: false,
        }, ctx),
    );
    if (isCancelled(supportsInterleavedThinking)) return CANCELLED;

    const supportsNativeToolCalls = await withCancel(async (ctx) =>
        confirm({
            message: t("model.supportsNativeToolCalls"),
            default: true,
        }, ctx),
    );
    if (isCancelled(supportsNativeToolCalls)) return CANCELLED;

    return {
        name,
        definition: {
            name: displayName || name,
            description: description || undefined,
            contextWindow: contextWindow || undefined,
            maxTokens: maxTokens || undefined,
            temperature: temperature ?? 1,
            supportsInterleavedThinking,
            supportsNativeToolCalls,
        },
    };
}

export async function editModelInteractive(model: ModelDefinition): Promise<ModelDefinition> {
    const displayName = await input({
        message: t("model.displayName"),
        default: model.name || "",
    });

    const description = await input({
        message: t("model.description"),
        default: model.description || "",
    });

    const contextWindow = await number({
        message: t("model.contextWindow"),
        default: model.contextWindow || 128000,
    });

    const maxTokens = await number({
        message: t("model.maxTokens"),
        default: model.maxTokens || model.contextWindow || 128000,
    });

    const temperature = await number({
        message: t("model.temperature"),
        default: model.temperature ?? 1,
    });

    const supportsInterleavedThinking = await confirm({
        message: t("model.supportsInterleavedThinking"),
        default: model.supportsInterleavedThinking ?? false,
    });

    const supportsNativeToolCalls = await confirm({
        message: t("model.supportsNativeToolCalls"),
        default: model.supportsNativeToolCalls ?? true,
    });

    return {
        name: displayName || model.name,
        description: description || undefined,
        contextWindow: contextWindow || undefined,
        maxTokens: maxTokens || undefined,
        temperature: temperature ?? 1,
        supportsInterleavedThinking,
        supportsNativeToolCalls,
    };
}

function getDefaultBaseURL(style: string): string {
    switch (style) {
        case "openai":
            return "https://api.openai.com/v1";
        case "anthropic":
            return "https://api.anthropic.com/v1";
        default:
            return "";
    }
}
