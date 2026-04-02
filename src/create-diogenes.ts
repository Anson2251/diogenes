import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { DiogenesConfig } from "./types";

import { AstService } from "./ast/service";
import { DiogenesContextManager } from "./context";
import { DirListTool } from "./tools/dir/dir-list";
import { DirUnloadTool } from "./tools/dir/dir-unload";
import { FileCreateTool } from "./tools/file/file-create";
import { FileEditTool } from "./tools/file/file-edit";
import { FileLoadTool } from "./tools/file/file-load";
import { FileLoadSymbolTool } from "./tools/file/file-load-symbol";
import { FileNodeAtTool } from "./tools/file/file-node-at";
import { FileOverwriteTool } from "./tools/file/file-overwrite";
import { FilePeekTool } from "./tools/file/file-peek";
import { FileRemoveTool } from "./tools/file/file-remove";
import { FileSymbolsTool } from "./tools/file/file-symbols";
import { FileUnloadTool } from "./tools/file/file-unload";
import { ShellExecTool } from "./tools/shell/shell-exec";
import { TaskAskTool } from "./tools/task/task-ask";
import { TaskChooseTool } from "./tools/task/task-choose";
import { TaskEndTool } from "./tools/task/task-end";
import { TaskNotepadTool } from "./tools/task/task-notepad";
import { TodoSetTool } from "./tools/todo/todo-set";
import { TodoUpdateTool } from "./tools/todo/todo-update";
import { TreeSitterAssetManager } from "./utils/tree-sitter-asset-manager";

export function createDiogenes(config?: DiogenesConfig) {
    const contextManager = new DiogenesContextManager(config);
    const workspace = contextManager.getWorkspaceManager();
    const configObj = contextManager.getConfig();
    const astService = new AstService(new TreeSitterAssetManager());

    contextManager.registerTool(new DirListTool(workspace));
    contextManager.registerTool(new DirUnloadTool(workspace));
    contextManager.registerTool(new FileLoadTool(workspace));
    contextManager.registerTool(new FileLoadSymbolTool(workspace, astService));
    contextManager.registerTool(new FileNodeAtTool(workspace, astService));
    contextManager.registerTool(new FileUnloadTool(workspace));
    contextManager.registerTool(new FileEditTool(workspace));
    contextManager.registerTool(new FilePeekTool(workspace));
    contextManager.registerTool(new FileCreateTool(workspace));
    contextManager.registerTool(new FileRemoveTool(workspace));
    contextManager.registerTool(new FileOverwriteTool(workspace));
    contextManager.registerTool(new FileSymbolsTool(workspace, astService));
    contextManager.registerTool(new TodoSetTool(workspace));
    contextManager.registerTool(new TodoUpdateTool(workspace));
    contextManager.registerTool(new TaskNotepadTool(workspace));
    if (configObj.security.interaction?.enabled ?? true) {
        contextManager.registerTool(
            new TaskAskTool(config?.interactionHandlers?.ask ?? createTerminalAskHandler()),
        );
        contextManager.registerTool(
            new TaskChooseTool(
                config?.interactionHandlers?.choose ?? createTerminalChooseHandler(),
            ),
        );
    }
    contextManager.registerTool(new TaskEndTool());
    contextManager.registerTool(
        new ShellExecTool(
            configObj.security.workspaceRoot || process.cwd(),
            configObj.security.shell || {
                enabled: true,
                timeout: 30,
                blockedCommands: ["rm -rf", "sudo", ":(){:|:&};:"],
            },
        ),
    );

    return contextManager;
}

function createTerminalAskHandler() {
    return async (question: string): Promise<string> => {
        if (!input.isTTY || !output.isTTY) {
            throw new Error("Interactive terminal is not available");
        }

        const rl = createInterface({ input, output });
        try {
            return await rl.question(`\n[task.ask] ${question}\n> `);
        } finally {
            rl.close();
        }
    };
}

function createTerminalChooseHandler() {
    return async (question: string, options: string[]): Promise<string> => {
        if (!input.isTTY || !output.isTTY) {
            throw new Error("Interactive terminal is not available");
        }

        const rl = createInterface({ input, output });
        try {
            const promptLines = [
                `\n[task.choose] ${question}`,
                ...options.map((option, index) => `  ${index + 1}. ${option}`),
                "> ",
            ];

            const answer = await rl.question(promptLines.join("\n"));
            const trimmed = answer.trim();
            const index = Number.parseInt(trimmed, 10);

            if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
                return options[index - 1];
            }

            const directMatch = options.find((option) => option === trimmed);
            if (directMatch) {
                return directMatch;
            }

            throw new Error("Selection must be an option number or exact option text");
        } finally {
            rl.close();
        }
    };
}
