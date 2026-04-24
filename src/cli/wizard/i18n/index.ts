/**
 * Internationalization (i18n) module for the configuration wizard
 */

import type { translations as enTranslationsType } from "./en";
import { translations as zhTranslations } from "./zh";
import { translations as enTranslationsValue } from "./en";

export type Locale = "zh" | "en";
export type TranslationKey = keyof typeof enTranslationsType;

type TranslationRecord = Record<TranslationKey, string>;

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const zh = zhTranslations as TranslationRecord;
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const en = enTranslationsValue as TranslationRecord;

const translations: Record<Locale, TranslationRecord> = {
    zh,
    en,
};

let currentLocale: Locale = detectLocale();

/**
 * Detect locale from environment
 */
function detectLocale(): Locale {
    // Check env var first
    const envLocale = process.env.DIOGENES_LOCALE;
    if (envLocale === "zh" || envLocale === "en") {
        return envLocale;
    }

    // Check system locale
    const systemLocale = process.env.LC_ALL || process.env.LANG || "en";
    if (systemLocale.toLowerCase().startsWith("zh")) {
        return "zh";
    }

    return "en";
}

/**
 * Set the current locale
 */
export function setLocale(locale: Locale): void {
    currentLocale = locale;
}

/**
 * Get the current locale
 */
export function getLocale(): Locale {
    return currentLocale;
}

/**
 * Translate a key with optional interpolation
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    const localeTranslations = translations[currentLocale];
    const fallbackTranslations = translations.en;
    let text: string = localeTranslations[key] ?? fallbackTranslations[key] ?? key;

    if (vars) {
        for (const [varName, value] of Object.entries(vars)) {
            text = text.replace(new RegExp(`{{${varName}}}`, "g"), String(value));
        }
    }

    return text;
}

/**
 * Check if a translation key exists
 */
export function hasTranslation(key: string): boolean {
    return key in translations.en;
}
