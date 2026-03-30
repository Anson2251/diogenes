import * as fs from "fs";
import * as yaml from "yaml";
import { z } from "zod";

import type { ModelsConfig, ResolvedModel } from "../types";

import {
    getProviderApiKey,
    getProviderApiKeyEnvVarName,
    MissingApiKeyError,
} from "./api-key-manager";

const ProviderStyleSchema = z.enum(["openai", "anthropic"]);

export const ModelDefinitionSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    contextWindow: z.number().optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
});

export const ProviderDefinitionSchema = z.object({
    style: ProviderStyleSchema,
    baseURL: z.string().optional(),
    supportsToolRole: z.boolean().optional(),
    models: z.record(z.string(), ModelDefinitionSchema),
});

export const ModelsConfigSchema = z.object({
    providers: z.record(z.string(), ProviderDefinitionSchema),
    default: z.string().optional(),
});

// Re-export for backward compatibility
export { getProviderApiKeyEnvVarName } from "./api-key-manager";

export function parseModelsConfig(content: string): ModelsConfig {
    const parsed: unknown = yaml.parse(content);
    return ModelsConfigSchema.parse(parsed);
}

export function loadModelsConfig(path: string): ModelsConfig | null {
    if (!fs.existsSync(path)) {
        return null;
    }
    const content = fs.readFileSync(path, "utf-8");
    return parseModelsConfig(content);
}

export function listAvailableModels(config: ModelsConfig): string[] {
    const models: string[] = [];
    for (const [providerName, provider] of Object.entries(config.providers)) {
        for (const modelName of Object.keys(provider.models)) {
            models.push(`${providerName}/${modelName}`);
        }
    }
    return models;
}

export function resolveModel(config: ModelsConfig, modelRef: string): ResolvedModel {
    const parts = modelRef.split("/");
    if (parts.length !== 2) {
        throw new Error(`Invalid model reference: ${modelRef}. Expected format: provider/model`);
    }

    const [providerName, modelName] = parts;
    const provider = config.providers[providerName];
    if (!provider) {
        throw new Error(`Unknown provider: ${providerName}`);
    }

    const model = provider.models[modelName];
    if (!model) {
        throw new Error(`Unknown model: ${modelName} for provider ${providerName}`);
    }

    const apiKey = getProviderApiKey(providerName);
    if (!apiKey) {
        throw new MissingApiKeyError(providerName);
    }

    return {
        provider: providerName,
        providerStyle: provider.style,
        supportsToolRole: provider.supportsToolRole ?? false,
        model: modelName,
        fullName: `${providerName}/${modelName}`,
        apiKey,
        baseURL: provider.baseURL,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens ?? model.contextWindow,
        temperature: model.temperature,
    };
}

export function resolveDefaultModel(config: ModelsConfig): ResolvedModel | null {
    if (!config.default) {
        return null;
    }
    return resolveModel(config, config.default);
}

export function formatModelsList(config: ModelsConfig): string {
    const lines: string[] = [];
    const defaultModel = config.default;

    for (const [providerName, provider] of Object.entries(config.providers)) {
        lines.push(`\n[${providerName}]`);
        lines.push(`  style: ${provider.style}`);
        lines.push(`  supportsToolRole: ${provider.supportsToolRole ?? false}`);
        lines.push(`  env: ${getProviderApiKeyEnvVarName(providerName)}`);
        if (provider.baseURL) {
            lines.push(`  baseURL: ${provider.baseURL}`);
        }
        lines.push("");

        for (const [modelName, model] of Object.entries(provider.models)) {
            const fullName = `${providerName}/${modelName}`;
            const isDefault = fullName === defaultModel;
            const marker = isDefault ? " *" : "  ";
            const desc = model.description ? ` - ${model.description}` : "";
            lines.push(`${marker}${modelName}${desc}`);
        }
    }

    if (defaultModel) {
        lines.push(`\nDefault: ${defaultModel}`);
    }

    return lines.join("\n");
}
