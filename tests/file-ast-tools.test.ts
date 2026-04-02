import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AstService } from "../src/ast/service";
import { WorkspaceManager } from "../src/context/workspace";
import { FileLoadSymbolTool } from "../src/tools/file/file-load-symbol";
import { FileNodeAtTool } from "../src/tools/file/file-node-at";
import { FileSymbolsTool } from "../src/tools/file/file-symbols";
import { resolveDiogenesAppPaths } from "../src/utils/app-paths";
import { TreeSitterAssetManager } from "../src/utils/tree-sitter-asset-manager";

describe("AST-backed file tools", () => {
    let workspaceRoot: string;
    let workspace: WorkspaceManager;
    let astService: AstService;
    let symbolsTool: FileSymbolsTool;
    let loadSymbolTool: FileLoadSymbolTool;
    let nodeAtTool: FileNodeAtTool;
    let tempDataRoot: string;

    beforeEach(async () => {
        workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "ast-workspace-"));
        tempDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "ast-data-"));

        const source = [
            "export function greet(name: string) {",
            "  return `hello ${name}`;",
            "}",
            "",
            "const arrow = (value: number) => value + 1;",
            "",
            "export class Greeter {",
            "  sayHi() {",
            "    return greet('world');",
            "  }",
            "}",
            "",
            "export default function () {",
            "  return arrow(1);",
            "}",
        ].join("\n");
        await fsp.writeFile(path.join(workspaceRoot, "sample.ts"), source, "utf8");

        const appPaths = resolveDiogenesAppPaths({
            platform: "linux",
            homeDir: tempDataRoot,
            env: {
                XDG_CONFIG_HOME: path.join(tempDataRoot, "config"),
                XDG_DATA_HOME: path.join(tempDataRoot, "data"),
            },
        });

        const wasmDir = path.join(
            path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")),
            "wasm",
        );

        const fetchMock: typeof fetch = async (url) => {
            const fileName = path.basename(new URL(String(url)).pathname);
            const data = await fsp.readFile(path.join(wasmDir, fileName));
            return new Response(data, { status: 200 });
        };

        workspace = new WorkspaceManager(workspaceRoot);
        astService = new AstService(new TreeSitterAssetManager({ appPaths, fetchImpl: fetchMock }));
        symbolsTool = new FileSymbolsTool(workspace, astService);
        loadSymbolTool = new FileLoadSymbolTool(workspace, astService);
        nodeAtTool = new FileNodeAtTool(workspace, astService);
    });

    afterEach(async () => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
        fs.rmSync(tempDataRoot, { recursive: true, force: true });
    });

    it("lists top-level symbols for a supported file", async () => {
        const result = await symbolsTool.execute({ path: "sample.ts" });

        expect(result.success).toBe(true);
        expect(result.data?.language).toBe("typescript");
        expect(result.data?.symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "greet", kind: "function", start: 1, end: 3 }),
                expect.objectContaining({ name: "arrow", kind: "variable", start: 5, end: 5 }),
                expect.objectContaining({ name: "Greeter", kind: "class", start: 7, end: 11 }),
                expect.objectContaining({ name: "default", kind: "function", start: 13, end: 15 }),
            ]),
        );
    });

    it("loads a symbol range into workspace", async () => {
        const result = await loadSymbolTool.execute({ path: "sample.ts", name: "Greeter" });

        expect(result.success).toBe(true);
        expect(result.data?.loaded_range).toEqual([7, 11]);

        const entry = workspace.getFileEntry("sample.ts");
        expect(entry?.ranges).toEqual([{ start: 7, end: 11 }]);
    });

    it("returns syntax node information for a position", async () => {
        const result = await nodeAtTool.execute({ path: "sample.ts", line: 8, column: 4 });

        expect(result.success).toBe(true);
        expect(result.data?.node).toEqual(
            expect.objectContaining({ type: "method_definition", start: 8, end: 10 }),
        );
        expect(result.data?.parents).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "class_body" })]),
        );
    });

    it("fails cleanly for unsupported file types", async () => {
        await fsp.writeFile(path.join(workspaceRoot, "notes.txt"), "plain text", "utf8");

        const result = await symbolsTool.execute({ path: "notes.txt" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("AST_UNSUPPORTED_LANGUAGE");
    });

    it("covers more TypeScript declaration forms", async () => {
        const tsSource = [
            "namespace N { export const y = 1 }",
            "abstract class Baz {}",
            "declare function q(): void",
        ].join("\n");
        await fsp.writeFile(path.join(workspaceRoot, "more.ts"), tsSource, "utf8");

        const result = await symbolsTool.execute({ path: "more.ts" });

        expect(result.success).toBe(true);
        expect(result.data?.symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "N", kind: "export" }),
                expect.objectContaining({ name: "Baz", kind: "class" }),
                expect.objectContaining({ name: "q", kind: "function" }),
            ]),
        );
    });

    it("lists top-level Python symbols", async () => {
        const pySource = [
            "class Foo:",
            "    def bar(self):",
            "        return 1",
            "",
            "def top(x):",
            "    return x",
            "",
            "value = 1",
        ].join("\n");
        await fsp.writeFile(path.join(workspaceRoot, "sample.py"), pySource, "utf8");

        const result = await symbolsTool.execute({ path: "sample.py" });

        expect(result.success).toBe(true);
        expect(result.data?.language).toBe("python");
        expect(result.data?.symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "Foo", kind: "class", start: 1 }),
                expect.objectContaining({ name: "top", kind: "function", start: 5 }),
                expect.objectContaining({ name: "value", kind: "variable", start: 8 }),
            ]),
        );
    });

    it("lists decorated and async Python declarations", async () => {
        const pySource = [
            "@decorator",
            "def foo(x):",
            "    return x",
            "",
            "@d1",
            "@d2",
            "class Bar:",
            "    pass",
            "",
            "async def coro():",
            "    return 1",
        ].join("\n");
        await fsp.writeFile(path.join(workspaceRoot, "decorated.py"), pySource, "utf8");

        const result = await symbolsTool.execute({ path: "decorated.py" });

        expect(result.success).toBe(true);
        expect(result.data?.symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "foo", kind: "function", start: 2 }),
                expect.objectContaining({ name: "Bar", kind: "class", start: 7 }),
                expect.objectContaining({ name: "coro", kind: "function", start: 10 }),
            ]),
        );
    });
});
