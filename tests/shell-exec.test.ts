import { describe, it, expect, beforeEach } from "vitest";

import { ShellExecTool } from "../src/tools/shell/shell-exec";

describe("ShellExecTool", () => {
    let tool: ShellExecTool;

    const defaultSecurityConfig = {
        enabled: true,
        timeout: 30,
        blockedCommands: ["rm -rf", "sudo"],
    };

    beforeEach(() => {
        tool = new ShellExecTool(process.cwd(), defaultSecurityConfig);
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("shell");
            expect(def.name).toBe("exec");
            expect(def.description).toContain("Execute a shell command");
            expect(def.description).toContain("most direct way to advance the task");
            expect(def.params.command.type).toBe("string");
            expect(def.params.timeout.optional).toBe(true);
            expect(def.params.cwd.optional).toBe(true);
        });
    });

    describe("execute", () => {
        it("should execute a simple command successfully", async () => {
            const result = await tool.execute({ command: "echo 'hello'" });

            expect(result.success).toBe(true);
            expect(result.data?.stdout).toContain("hello");
            expect(result.data?.exit_code).toBe(0);
        });

        it("should return stderr correctly", async () => {
            const result = await tool.execute({ command: "ls /nonexistent_path_12345 2>&1" });

            expect(result.success).toBe(true);
            expect(result.data?.exit_code).toBeGreaterThan(0);
            expect(result.data?.stderr).toBeDefined();
        });

        it("should handle non-zero exit codes", async () => {
            const result = await tool.execute({ command: "ls /nonexistent_path_12345" });

            expect(result.success).toBe(true);
            expect(typeof result.data?.exit_code).toBe("number");
            expect(result.data?.exit_code).not.toBe(0);
        });

        it("should use custom working directory", async () => {
            const result = await tool.execute({
                command: "pwd",
                cwd: ".",
            });

            expect(result.success).toBe(true);
            expect(result.data?.stdout).toContain(process.cwd());
        });

        it("should use custom timeout", async () => {
            const result = await tool.execute({
                command: "echo 'test'",
                timeout: 10,
            });

            expect(result.success).toBe(true);
        });

        it("should reject blocked commands", async () => {
            const result = await tool.execute({ command: "rm -rf /" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("COMMAND_BLOCKED");
            expect(result.error?.message).toContain("rm -rf");
        });

        it("should reject commands with blocked patterns", async () => {
            const result = await tool.execute({ command: "echo sudo make me a sandwich" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("COMMAND_BLOCKED");
        });

        it("should reject when shell is disabled", async () => {
            const disabledTool = new ShellExecTool("/test", {
                enabled: false,
                timeout: 30,
                blockedCommands: [],
            });

            const result = await disabledTool.execute({ command: "echo hello" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("SHELL_DISABLED");
        });

        it("should reject working directory outside workspace", async () => {
            const result = await tool.execute({
                command: "echo hello",
                cwd: "/outside/workspace",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("PATH_OUTSIDE_WORKSPACE");
        });

        it("should validate missing command parameter", async () => {
            const result = await tool.execute({});

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should handle command with timeout", async () => {
            const result = await tool.execute({
                command: "pwd",
                timeout: 10,
            });

            expect(result.success).toBe(true);
            expect(result.data?.exit_code).toBe(0);
        });

        it("should handle command with large output", async () => {
            const result = await tool.execute({
                command: "seq 1 100 | wc -l",
            });

            expect(result.success).toBe(true);
            expect(result.data?.stdout).toContain("100");
        });

        it("should validate non-string command parameter", async () => {
            const result = await tool.execute({ command: 123 });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should validate non-number timeout parameter", async () => {
            const result = await tool.execute({
                command: "echo hello",
                timeout: "not a number",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should validate optional cwd parameter", async () => {
            const result = await tool.execute({
                command: "echo hello",
                cwd: ".",
            });

            expect(result.success).toBe(true);
        });
    });
});
