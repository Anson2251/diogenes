/**
 * API Key Management
 *
 * Manages API keys for different providers with support for:
 * - Environment variables (highest priority)
 * - .env file
 * - Provider-specific configuration
 *
 * API keys are loaded lazily when a provider is selected.
 */

/**
 * Get the environment variable name for a provider's API key
 */
export function getProviderApiKeyEnvVarName(providerName: string): string {
    const normalizedProviderName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return `${normalizedProviderName}_API_KEY`;
}

/**
 * API key cache to avoid repeated environment lookups
 */
const apiKeyCache = new Map<string, string | undefined>();

/**
 * Clear the API key cache (useful for testing)
 */
export function clearApiKeyCache(): void {
    apiKeyCache.clear();
}

/**
 * Get API key for a specific provider
 * Tries multiple sources in order:
 * 1. Cache
 * 2. Environment variable
 * 3. Process env (for already loaded .env)
 *
 * @param providerName - The provider name (e.g., 'openai', 'anthropic', 'deepseek')
 * @returns The API key or undefined if not found
 */
export function getProviderApiKey(providerName: string): string | undefined {
    // Check cache first
    if (apiKeyCache.has(providerName)) {
        return apiKeyCache.get(providerName);
    }

    const envVarName = getProviderApiKeyEnvVarName(providerName);
    const apiKey = process.env[envVarName];

    // Cache the result (even if undefined)
    apiKeyCache.set(providerName, apiKey);

    return apiKey;
}

/**
 * Check if an API key is available for a provider
 */
export function hasProviderApiKey(providerName: string): boolean {
    return getProviderApiKey(providerName) !== undefined;
}

/**
 * Get a list of available providers (those with API keys configured)
 */
export function getAvailableProviders(allProviders: string[]): string[] {
    return allProviders.filter(hasProviderApiKey);
}

/**
 * Error thrown when API key is missing
 */
export class MissingApiKeyError extends Error {
    constructor(providerName: string) {
        const envVarName = getProviderApiKeyEnvVarName(providerName);
        super(
            `No API key found for provider "${providerName}". ` +
                `Set the ${envVarName} environment variable or add it to your .env file.`,
        );
        this.name = "MissingApiKeyError";
    }
}

/**
 * Get API key or throw an error if not found
 */
export function requireProviderApiKey(providerName: string): string {
    const apiKey = getProviderApiKey(providerName);
    if (!apiKey) {
        throw new MissingApiKeyError(providerName);
    }
    return apiKey;
}

/**
 * Format API key for display (masks most of it)
 */
export function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
        return "***";
    }
    return apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
}

/**
 * Get API key status for debugging
 */
export function getApiKeyStatus(providerName: string): {
    envVarName: string;
    isConfigured: boolean;
    maskedValue?: string;
} {
    const envVarName = getProviderApiKeyEnvVarName(providerName);
    const apiKey = getProviderApiKey(providerName);

    return {
        envVarName,
        isConfigured: apiKey !== undefined,
        maskedValue: apiKey ? maskApiKey(apiKey) : undefined,
    };
}
