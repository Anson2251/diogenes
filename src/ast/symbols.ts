import type { Node } from "web-tree-sitter";

import type { AstLanguageId } from "./languages";

export type AstSymbolKind =
    | "function"
    | "class"
    | "interface"
    | "type"
    | "enum"
    | "variable"
    | "export";

export interface AstPosition {
    line: number;
    column: number;
}

export interface AstLineRange {
    start: number;
    end: number;
}

export interface AstNodeSummary {
    type: string;
    range: AstLineRange;
    textPreview?: string;
}

export interface AstSymbol {
    name: string;
    kind: AstSymbolKind;
    language: AstLanguageId;
    path: string;
    range: AstLineRange;
    exported?: boolean;
    detail?: string;
}

export function summarizeNode(node: Node): AstNodeSummary {
    return {
        type: node.type,
        range: nodeRange(node),
        textPreview: previewText(node.text),
    };
}

export function extractSymbols(language: AstLanguageId, filePath: string, root: Node): AstSymbol[] {
    const symbols: AstSymbol[] = [];

    for (const child of root.namedChildren) {
        if (!child) {
            continue;
        }
        symbols.push(...extractSymbolsFromNode(language, filePath, child, false));
    }

    return symbols;
}

function extractSymbolsFromNode(
    language: AstLanguageId,
    filePath: string,
    node: Node,
    exported: boolean,
): AstSymbol[] {
    if (language === "python") {
        return extractPythonSymbols(filePath, node);
    }

    const actualNode = unwrapExportNode(node);
    const isExported = exported || actualNode !== node || node.type === "export_statement";
    const defaultExportName = isExported && looksLikeDefaultExport(node) ? "default" : undefined;

    if (actualNode.type === "expression_statement") {
        const internalModule = actualNode.namedChildren.find((child) => child?.type === "internal_module");
        if (internalModule) {
            return extractSymbolsFromNode(language, filePath, internalModule, isExported);
        }
    }

    if (actualNode.type === "function_declaration") {
        return createNamedSymbol(
            language,
            filePath,
            actualNode,
            "name",
            "function",
            isExported,
            defaultExportName,
        );
    }

    if (actualNode.type === "function_expression") {
        return createNamedSymbol(
            language,
            filePath,
            actualNode,
            "name",
            "function",
            isExported,
            defaultExportName,
        );
    }

    if (actualNode.type === "class_declaration") {
        return createNamedSymbol(
            language,
            filePath,
            actualNode,
            "name",
            "class",
            isExported,
            defaultExportName,
        );
    }

    if (actualNode.type === "class_expression") {
        return createNamedSymbol(
            language,
            filePath,
            actualNode,
            "name",
            "class",
            isExported,
            defaultExportName,
        );
    }

    if (actualNode.type === "abstract_class_declaration") {
        return createNamedSymbol(
            language,
            filePath,
            actualNode,
            "name",
            "class",
            isExported,
            defaultExportName,
        );
    }

    if (actualNode.type === "interface_declaration") {
        return createNamedSymbol(language, filePath, actualNode, "name", "interface", isExported);
    }

    if (actualNode.type === "type_alias_declaration") {
        return createNamedSymbol(language, filePath, actualNode, "name", "type", isExported);
    }

    if (actualNode.type === "enum_declaration") {
        return createNamedSymbol(language, filePath, actualNode, "name", "enum", isExported);
    }

    if (actualNode.type === "lexical_declaration" || actualNode.type === "variable_declaration") {
        return createVariableSymbols(language, filePath, actualNode, isExported);
    }

    if (actualNode.type === "ambient_declaration") {
        return extractAmbientDeclaration(language, filePath, actualNode, isExported);
    }

    if (actualNode.type === "internal_module") {
        return createNamedSymbol(
            language,
            filePath,
            actualNode,
            "name",
            "export",
            isExported,
        );
    }

    return [];
}

function extractPythonSymbols(filePath: string, node: Node): AstSymbol[] {
    if (node.type === "decorated_definition") {
        const decorated = node.namedChildren.find(
            (child) => child?.type === "function_definition" || child?.type === "class_definition",
        );
        return decorated ? extractPythonSymbols(filePath, decorated) : [];
    }

    if (node.type === "class_definition") {
        return createNamedSymbol("python", filePath, node, "name", "class", false);
    }

    if (node.type === "function_definition") {
        return createNamedSymbol("python", filePath, node, "name", "function", false);
    }

    if (node.type === "expression_statement") {
        const assignment = node.namedChildren.find((child) => child?.type === "assignment");
        if (!assignment) {
            return [];
        }

        const left = assignment.childForFieldName("left") ?? assignment.namedChildren[0] ?? null;
        if (!left || left.type !== "identifier") {
            return [];
        }

        return [
            {
                name: left.text,
                kind: "variable",
                language: "python",
                path: filePath,
                range: nodeRange(assignment),
                exported: false,
                detail: "assignment",
            },
        ];
    }

    return [];
}

function extractAmbientDeclaration(
    language: AstLanguageId,
    filePath: string,
    node: Node,
    exported: boolean,
): AstSymbol[] {
    for (const child of node.namedChildren) {
        if (!child) {
            continue;
        }
        if (child.type === "function_signature") {
            return createNamedSymbol(language, filePath, child, "name", "function", exported);
        }
        if (child.type === "class_declaration" || child.type === "abstract_class_declaration") {
            return createNamedSymbol(language, filePath, child, "name", "class", exported);
        }
        if (child.type === "interface_declaration") {
            return createNamedSymbol(language, filePath, child, "name", "interface", exported);
        }
    }

    return [];
}

function unwrapExportNode(node: Node): Node {
    if (node.type !== "export_statement") {
        return node;
    }

    for (const child of node.namedChildren) {
        if (!child) {
            continue;
        }
        if (
            child.type === "function_declaration" ||
            child.type === "function_expression" ||
            child.type === "class_declaration" ||
            child.type === "class_expression" ||
            child.type === "interface_declaration" ||
            child.type === "type_alias_declaration" ||
            child.type === "enum_declaration" ||
            child.type === "lexical_declaration" ||
            child.type === "variable_declaration" ||
            child.type === "abstract_class_declaration" ||
            child.type === "ambient_declaration"
        ) {
            return child;
        }
    }

    return node;
}

function createNamedSymbol(
    language: AstLanguageId,
    filePath: string,
    node: Node,
    fieldName: string,
    kind: AstSymbolKind,
    exported: boolean,
    fallbackName?: string,
): AstSymbol[] {
    const nameNode = node.childForFieldName(fieldName);
    if (!nameNode && !fallbackName) {
        return [];
    }

    return [
        {
            name: nameNode?.text ?? fallbackName!,
            kind,
            language,
            path: filePath,
            range: nodeRange(node),
            exported,
            detail: buildDetail(node, kind, exported),
        },
    ];
}

function createVariableSymbols(
    language: AstLanguageId,
    filePath: string,
    node: Node,
    exported: boolean,
): AstSymbol[] {
    const symbols: AstSymbol[] = [];

    for (const child of node.namedChildren) {
        if (!child || child.type !== "variable_declarator") {
            continue;
        }

        const nameNode = child.childForFieldName("name");
        if (!nameNode) {
            continue;
        }

        symbols.push({
            name: nameNode.text,
            kind: "variable",
            language,
            path: filePath,
            range: nodeRange(child),
            exported,
            detail: buildVariableDetail(child, exported),
        });
    }

    return symbols;
}

function buildDetail(node: Node, kind: AstSymbolKind, exported: boolean): string {
    const parts: string[] = [];
    if (exported) {
        parts.push("export");
    }
    if (kind === "function" && node.text.startsWith("async ")) {
        parts.push("async");
    }
    parts.push(kind);
    return parts.join(" ");
}

function buildVariableDetail(node: Node, exported: boolean): string {
    const valueNode = node.childForFieldName("value");
    const parts: string[] = [];
    if (exported) {
        parts.push("export");
    }
    if (valueNode?.type === "arrow_function") {
        parts.push("arrow function");
    } else if (valueNode?.type === "function") {
        parts.push("function expression");
    } else {
        parts.push("variable");
    }
    return parts.join(" ");
}

function looksLikeDefaultExport(node: Node): boolean {
    return node.text.startsWith("export default ");
}

export function nodeRange(node: Node): AstLineRange {
    return {
        start: node.startPosition.row + 1,
        end: node.endPosition.row + 1,
    };
}

function previewText(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= 120) {
        return normalized;
    }
    return `${normalized.slice(0, 117)}...`;
}
