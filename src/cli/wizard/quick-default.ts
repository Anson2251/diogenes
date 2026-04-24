/**
 * Quick default model switch - most commonly used
 */

import { select } from "@inquirer/prompts";

import type { ModelsConfig } from "../../types";
import { printHeader, printSuccess, printWarning, listAllModelChoices, withCancel, isCancelled } from "./utils";
import { t } from "./i18n";
import type { StepResult } from "./types";

export async function runQuickDefaultStep(config: ModelsConfig): Promise<StepResult> {
    printHeader(t("quickDefault.title"));

    const allModels = listAllModelChoices(config);

    if (allModels.length === 0) {
        printWarning(t("quickDefault.noModels"));
        return { next: "menu", changed: false };
    }

    const choices = [
        ...allModels,
        { name: t("quickDefault.addNew"), value: "__add_new__" },
    ];

    const selected = await withCancel(async (ctx) =>
        select({
            message: t("quickDefault.select"),
            choices,
        }, ctx),
    );
    if (isCancelled(selected)) return { next: "menu", changed: false };

    if (selected === "__add_new__") {
        return { next: "provider", changed: false };
    }

    const previousDefault = config.default;

    if (previousDefault === selected) {
        printInfo(t("quickDefault.alreadyDefault", { model: selected }));
        return { next: "menu", changed: false };
    }

    config.default = selected;
    printSuccess(t("quickDefault.switched", { model: selected }));

    if (previousDefault) {
        printInfo(t("quickDefault.previous", { model: previousDefault }));
    }

    const providerName = selected.split("/")[0];
    const { getProviderApiKey, getProviderApiKeyEnvVarName } = await import("../../utils/api-key-manager");
    const hasApiKey = getProviderApiKey(providerName);
    if (!hasApiKey) {
        const envVarName = getProviderApiKeyEnvVarName(providerName);
        printWarning(t("provider.apiKeyMissing", { envVar: envVarName }));
        printInfo(t("provider.apiKeyHint", { envVar: envVarName }));
    }

    return { next: "menu", changed: true };
}

function printInfo(message: string): void {
    const colors = {
        blue: "\x1b[34m",
        reset: "\x1b[0m",
    };
    console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}
