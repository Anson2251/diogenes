# RFC: Simple LLM‑Controlled Agent Framework

## Status

Draft (v4)

## Authors

Anson

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| v1 | - | Initial draft |
| v2 | - | Unified JSON tool protocol, restructured file edit system |
| v3 | - | Add task end tool, ReAct structure |
| v4 | - | Add explanation to message list structure, add notepad tools, and modify namespace format |


---

## Motivation

Current agent frameworks tend to over‑engineer context management through external mechanisms such as RAG, embeddings, forced summarization, or hidden KV‑cache policies. These approaches assume the framework knows better than the LLM what information should remain in context.

This RFC proposes a **minimal agent framework** that instead:

* Treats the LLM as the primary controller of its own context window
* Exposes context manipulation explicitly through tools
* Avoids implicit memory, embeddings, or hidden caches
* Pushes complexity to tools, not orchestration logic

The core belief is:

> *LLMs should explicitly decide what information stays in context. The framework should only provide safe, inspectable mechanisms to do so.*

---

## Design Philosophy

### Core Principles

1. **LLM‑controlled context**
   The LLM decides what to load, unload, and modify in its context window.

2. **No implicit memory**
   All context must be explicitly visible to the LLM.

3. **Tool‑mediated interaction with the environment**
   Any interaction with files, directories, or the system happens via tools.

4. **Simplicity over abstraction**
   The framework avoids planners, sub‑agents, embeddings, or hidden heuristics.

5. **Trust the model, but verify execution**
   Tools validate and report results; the LLM reasons about them.

6. **Protocol uniformity**
   All tools use a single, consistent JSON invocation protocol.

---

## High‑Level Architecture

The LLM context window is composed of the following ordered sections:

1. System prompt and task
2. Tool definitions and protocol specification
3. Context status (token usage, workspace summary)
4. Directory workspace
5. File workspace
6. Todo list
7. Notepad workspace
8. Iterative runs of tool-calling and tool-return

A **Context Manager** (outside the LLM) is responsible only for:

* Injecting these sections into the prompt
* Executing tool calls
* Updating workspace sections based on tool results
* Reporting context pressure metrics

The Context Manager **does not** decide *what* to load or unload.

---

## Context Status Section

Provides awareness signals to help the LLM manage context effectively.

### Format

```
=========CONTEXT STATUS
Token Usage: <current> / <limit> (<percentage>%)
Directory Workspace: <count> directories loaded
File Workspace: <count> files, <total_lines> lines loaded
=========
```

### Example

```
=========CONTEXT STATUS
Token Usage: 45,231 / 128,000 (35.3%)
Directory Workspace: 3 directories loaded
File Workspace: 5 files, 847 lines loaded
=========
```

### Semantics

* Updated after each tool execution
* Provides optional soft warnings at configurable thresholds (e.g., 70%, 90%)
* LLM may use this information to decide when to unload content

---

## Workspace Model

### Directory Workspace

Represents directory listings explicitly loaded by the LLM.

#### Format

```
=========DIRECTORY WORKSPACE
<path>
---------
FILE | <filename>
DIR  | <dirname>
...
---------

<path>
---------
...
---------
=========
```

#### Example

```
=========DIRECTORY WORKSPACE
/project/src
---------
FILE | main.ts
FILE | utils.ts
DIR  | components
DIR  | hooks
---------

/project/src/components
---------
FILE | Button.tsx
FILE | Modal.tsx
FILE | index.ts
---------
=========
```

#### Semantics

* Directory contents persist until explicitly unloaded
* Listing a directory adds it to the directory workspace
* Unloading removes it entirely from context

---

### File Workspace

Represents file contents or partial file contents explicitly loaded by the LLM.

#### Full File Format

```
=========FILE WORKSPACE
<file path>
---------
   1 | <code>
   2 | <code>
...
---------

=========
```

#### Partial File (Line Range) Format

```
=========FILE WORKSPACE
<file path>
---------
  50 | <code>
  51 | <code>

[UNLOADED]

  100 | <code>
  101 | <code>
=========
```

#### Example

```
=========FILE WORKSPACE
/project/src/main.ts
---------
   1 | import { App } from './app';
   2 | import { Config } from './config';
   3 |
   4 | const config: Config = {
   5 |   debug: true,
   
   [UNLOADED]
   
  45 | }
---------

/project/src/utils.ts
---------
  20 | export function formatDate(date: Date): string {
  21 |   return date.toISOString().split('T')[0];
  22 | }
  
  [UNLOADED]
  
  80 | }
---------
=========
```

#### Semantics

* Files may be partially loaded using line number ranges
* Multiple ranges from the same file appear as separate entries
* File contents persist until explicitly unloaded or modified

---

### Todo Workspace

Tracks task state for complex multi-step operations.

The Todo workspace is an externalized scratchpad, not a planner.
The framework MUST NOT infer, reorder, generate, or auto-advance todo items.
Todo state changes are valid only when explicitly initiated by the LLM via tools

#### Format

```
=========TODO
[x] <completed item>
[*] <in-progress item>
[ ] <pending item>
...
=========
```

#### Example

```
=========TODO
[x] Analyze project structure
[x] Identify files with type errors
[*] Fix errors in utils.ts
[ ] Fix errors in main.ts
[ ] Run type checker to verify
=========
```

### Notepad Workspace

A space reserved for LLM to take notes. Can be updated via tools.

---

## Tool System

### Tool Invocation Protocol

All tool calls use a unified JSON protocol. Tools are invoked by emitting a JSON array inside the **last** code block labeled `tool-call`.

#### Single Tool Call

```tool-call
[
  {
    "tool": "file_load",
    "params": {
      "path": "src/main.ts",
      "start": 1,
      "end": 100
    }
  }
]
```

#### Multiple Tool Calls

```tool-call
[
  {
    "tool": "dir_list",
    "params": {
      "path": "src/components"
    }
  },
  {
    "tool": "file_load",
    "params": {
      "path": "src/main.ts"
    }
  }
]
```

### Tool Response Format

Tool results are injected into the conversation as structured responses:

```
=========TOOL RESULT: <tool_name>
<result content>
=========
```

For errors:

```
=========TOOL ERROR: <tool_name>
Error: <error_type>
Message: <error_message>
<additional context>
=========
```

---

### Tool Definition Format

```
<namespace>
  <tool_name>:
    DESCRIPTION: <brief description>
    PARAMS:
      <param>: <data_type> [optional] - <description>
    RETURNS:
      <field>: <description>
```

Supported data types:

* `string`
* `number`
* `bool`
* `array<T>`
* `object`

---

## Standard Tool Set

### Shell Tools

```
shell
  shell_exec:
    DESCRIPTION: Execute a shell command
    PARAMS:
      command: string - Command to execute
      cwd: string [optional] - Working directory, default to workspace root
      timeout: number [optional] - Timeout in seconds (default: 30)
    RETURNS:
      stdout: string
      stderr: string
      exit_code: number
```

---

### Directory Tools

```
dir
  dir.list:
    DESCRIPTION: List directory contents and load into workspace
    PARAMS:
      path: string - Directory path
    RETURNS:
      items: array<{name, type}>

  dir.unload:
    DESCRIPTION: Remove directory from workspace
    PARAMS:
      path: string - Directory path
    RETURNS:
      success: bool
  
  dir.create:
    DESCRIPTION: Create a directory in the file system. Parent directories can be created as needed.
    PARAMS:
      path: string - Directory path
    RETURNS:
      success: bool
  
  dir.delete:
    DESCRIPTION: Delete a directory in the file system
    PARAMS:
      path: string - Directory path
      recursive: bool [optional] - Whether to delete non-empty directories (default: false)
    RETURNS:
      success: bool
```

---

### File Context Tools

```
file
  file.load:
    DESCRIPTION: Load file content into workspace
    PARAMS:
      path: string - File path
      start: number [optional] - Start line (1-indexed)
      end: number [optional] - End line (inclusive)
    RETURNS:
      content: string
      total_lines: number
      loaded_range: [start, end]

  file.unload:
    DESCRIPTION: Remove file from workspace
    PARAMS:
      path: string - File path
    RETURNS:
      success: bool
```

NOTE: The line number range would be re-calculated when the file displaying is modified.

---

### File Edit Tool

```
file
  file.edit:
    DESCRIPTION: Apply structured edits to a file
    PARAMS:
      path: string - File path
      options: object [optional]
        atomic: bool - All-or-nothing application (default: true)
        whitespace: string - "strict" | "loose" (default: auto by file type)
      edits: array<Edit> - List of edit operations
    RETURNS:
      success: bool
      applied: array<EditResult>
      errors: array<EditError>
      file_state: object
```

#### Edit Object Structure

```typescript
interface Edit {
  mode: "replace" | "delete" | "insert_before" | "insert_after"
  anchor: Anchor
  content?: string[]  // Required for replace, insert_before, insert_after
}

interface Anchor {
  start: LineAnchor
  end?: LineAnchor    // Required for replace and delete with range
}

interface LineAnchor {
  line: number        // Target line number (hint, not strict)
  text: string        // Target line content
  before: string[]    // 2 lines of context before
  after: string[]     // 2 lines of context after
}
```

#### Edit Modes

| Mode | Description | Requires `end` | Requires `content` |
|------|-------------|----------------|-------------------|
| `replace` | Replace line(s) with new content | For ranges | Yes |
| `delete` | Remove line(s) | For ranges | No |
| `insert_before` | Insert content before anchor | No | Yes |
| `insert_after` | Insert content after anchor | No | Yes |

#### Example: Replace Function

```tool-call
[
  {
    "tool": "file_edit",
    "params": {
      "path": "stack.py",
      "edits": [
        {
          "mode": "replace",
          "anchor": {
            "start": {
              "line": 12,
              "text": "def push(self, item):",
              "before": ["self.length = 10", ""],
              "after": ["    if self.topIndex == self.length:", "        print(\"Stack is full\")"]
            },
            "end": {
              "line": 18,
              "text": "        self.topIndex += 1",
              "before": ["        self.items[self.topIndex] = item", ""],
              "after": ["", "    def pop(self):"]
            }
          },
          "content": [
            "def push(self, item):",
            "    if self.topIndex >= self.length:",
            "        raise StackOverflowError(\"Stack is full\")",
            "    self.items[self.topIndex] = item",
            "    self.topIndex += 1"
          ]
        }
      ]
    }
  }
]
```

#### Example: Single Line Replace (Simplified)

When `end` is omitted, it defaults to `start`:

```tool-call
[
  {
    "tool": "file.edit",
    "params": {
      "path": "config.py",
      "edits": [
        {
          "mode": "replace",
          "anchor": {
            "start": {
              "line": 10,
              "text": "DEBUG = True",
              "before": ["", "# Runtime settings"],
              "after": ["LOG_LEVEL = \"DEBUG\"", ""]
            }
          },
          "content": ["DEBUG = False"]
        }
      ]
    }
  }
]
```

#### Example: Delete Lines

```tool-call
[
  {
    "tool": "file.edit",
    "params": {
      "path": "utils.py",
      "edits": [
        {
          "mode": "delete",
          "anchor": {
            "start": {
              "line": 45,
              "text": "# DEPRECATED",
              "before": ["", ""],
              "after": ["def old_function():", "    pass"]
            },
            "end": {
              "line": 52,
              "text": "    return None",
              "before": ["    x = compute()", ""],
              "after": ["", "def new_function():"]
            }
          }
        }
      ]
    }
  }
]
```

#### Example: Insert After

```tool-call
[
  {
    "tool": "file.edit",
    "params": {
      "path": "main.py",
      "edits": [
        {
          "mode": "insert_after",
          "anchor": {
            "start": {
              "line": 5,
              "text": "import json",
              "before": ["import sys", "import os"],
              "after": ["", "def main():"]
            }
          },
          "content": [
            "import logging",
            "from pathlib import Path"
          ]
        }
      ]
    }
  }
]
```

#### Example: Multiple Edits

```tool-call
[
  {
    "tool": "file.edit",
    "params": {
      "path": "app.py",
      "edits": [
        {
          "mode": "replace",
          "anchor": {
            "start": {
              "line": 3,
              "text": "VERSION = \"1.0.0\"",
              "before": ["", "# Metadata"],
              "after": ["AUTHOR = \"dev\"", ""]
            }
          },
          "content": ["VERSION = \"1.1.0\""]
        },
        {
          "mode": "insert_after",
          "anchor": {
            "start": {
              "line": 10,
              "text": "import utils",
              "before": ["import os", "import sys"],
              "after": ["", "class App:"]
            }
          },
          "content": ["import logging"]
        }
      ]
    }
  }
]
```

#### Matching Rules

1. **Exact Match** (preferred)
   - `text` + `before` + `after` all match exactly
   - Edit applied directly

2. **Fuzzy Match** (fallback)
   - Ignore leading/trailing whitespace
   - Ignore differences in consecutive whitespace
   - `text` content must still match

3. **Line Hint Match** (last resort)
   - Context doesn't match, search ±5 lines around `line` hint
   - Apply only if exactly one match found
   - Multiple matches → error

4. **Match Failure**
   - No valid match found → error, no changes applied

#### Whitespace Handling

| File Type | Indentation | Trailing Whitespace | Blank Lines |
|-----------|-------------|---------------------|-------------|
| Python, YAML, Makefile | Strict | Ignore | Ignore |
| Other languages | Ignore | Ignore | Ignore |

#### Atomicity

* **Default (atomic: true)**: All edits validate → all apply; any failure → none apply
* **Non-atomic (atomic: false)**: Apply successful edits, report failures

#### Error Types

| Error Code | Meaning | Suggested Action |
|------------|---------|------------------|
| `NO_MATCH` | Anchor not found | Reload file, verify content |
| `AMBIGUOUS_MATCH` | Multiple possible matches | Add more context lines |
| `OVERLAP_CONFLICT` | Edit ranges overlap | Merge edits or separate calls |
| `CONTENT_CHANGED` | File modified externally | Reload file |

#### Response Structure

Success:
```json
{
  "success": true,
  "applied": [
    {
      "index": 0,
      "mode": "replace",
      "matched_range": [12, 18],
      "new_range": [12, 16],
      "match_quality": "exact"
    }
  ],
  "file_state": {
    "total_lines": 142,
    "modified_regions": [[12, 16]]
  }
}
```

Partial failure:
```json
{
  "success": false,
  "applied": [],
  "errors": [
    {
      "index": 0,
      "error": "AMBIGUOUS_MATCH",
      "message": "Found 2 matches at lines 45, 89",
      "candidates": [
        {"line": 45, "preview": "def process(data):"},
        {"line": 89, "preview": "def process(items):"}
      ]
    }
  ],
  "rollback": true
}
```

---

### File Write Tools

```
file
  file.create:
    DESCRIPTION: Create a new file with content
    PARAMS:
      path: string - File path
      content: string - File content
    RETURNS:
      success: bool
      total_lines: number

  file.overwrite:
    DESCRIPTION: Overwrite entire file content
    PARAMS:
      path: string - File path
      content: string - New content
    RETURNS:
      success: bool
      total_lines: number

  file.append:
    DESCRIPTION: Append content to end of file
    PARAMS:
      path: string - File path
      content: string - Content to append
    RETURNS:
      success: bool
      total_lines: number
```

---

### File Search Tool

```
search
  search.files:
    DESCRIPTION: Search for pattern across files
    PARAMS:
      pattern: string - Search pattern (regex supported)
      path: string [optional] - Directory to search (default: workspace root)
      include: string [optional] - File glob pattern to include
      exclude: string [optional] - File glob pattern to exclude
      max_results: number [optional] - Maximum results (default: 50)
    RETURNS:
      matches: array<{path, line, content, context}>
      truncated: bool

  search.symbols:
    DESCRIPTION: Search for symbol definitions (not implemented yet, language server required)
    PARAMS:
      name: string - Symbol name pattern
      kind: string [optional] - "function" | "class" | "variable" | "all"
      path: string [optional] - Directory to search
    RETURNS:
      symbols: array<{name, kind, path, line, signature}>
```

---

### Todo Tools

```
todo
  todo.set:
    DESCRIPTION: Overwrite entire todo list
    PARAMS:
      items: array<object>
        text: string - Item description
        state: string - "done" | "active" | "pending"
    RETURNS:
      success: bool

  todo.update:
    DESCRIPTION: Update state of a todo item
    PARAMS:
      text: string - Item text (must match exactly)
      state: string - "done" | "active" | "pending"
    RETURNS:
      success: bool

  todo.append:
    DESCRIPTION: Add new items to todo list
    PARAMS:
      items: array<string> - New item descriptions
    RETURNS:
      success: bool
      total_items: number
```

#### Example: Initialize Todo

```tool-call
[
  {
    "tool": "todo.set",
    "params": {
      "items": [
        {"text": "Analyze project structure", "state": "done"},
        {"text": "Fix type errors in utils.ts", "state": "active"},
        {"text": "Update documentation", "state": "pending"}
      ]
    }
  }
]
```

#### Example: Update Item State

```tool-call
[
  {
    "tool": "todo.update",
    "params": {
      "text": "Fix type errors in utils.ts",
      "state": "done"
    }
  }
]
```

---

### Notepad Tools

```
notepad
  notepad.update:
    DESCRIPTION: Overwrite entire notepad
    PARAMS:
      content: string
    RETURNS:
      success: bool

  todo.append:
    DESCRIPTION: Append content to the start/end of the notepad
    PARAMS:
      content: string
      mode: string ("begin" | "end")
    RETURNS:
      success: bool
      total_items: number
```

---

### MCP Tools (Planned)

```
mcp
  mcp_call:
    DESCRIPTION: Call an MCP-protocol tool
    PARAMS:
      server: string - MCP server identifier
      method: string - Method name
      params: object - Method parameters
    RETURNS:
      result: object
```

Reserved namespace for Model Context Protocol integration.

---

### Task End tool

```tool-call
[
  {
    "tool": "task.end",
    "params": {
      "reason": <brief summary on why the task is over>,
      "summary": <what agent done in this task>
    }
  }
]
```

---

## Context Management Philosophy

* No external KV cache manipulation
* No forced eviction policies
* No summarization without explicit LLM instruction

The LLM is expected to:

* Monitor context usage via the status section
* Load only necessary directories and files
* Unload unused context to conserve tokens
* Manage its own working memory

The framework **trusts** the LLM's reasoning capacity while ensuring:

* All state changes are explicit
* All side effects are tool‑mediated
* All context remains inspectable
* Context pressure is visible

---

## Error Handling and Validation

### Framework Responsibilities

* Validate JSON syntax before execution
* Validate required parameters
* Match validation for file edits
* Report execution failures with actionable details
* Provide partial success indicators when applicable

### Error Response Format

All errors return structured information:

```json
{
  "error": "<ERROR_CODE>",
  "message": "<Human readable message>",
  "details": { ... },
  "suggestion": "<Recommended action>"
}
```

### Common Error Codes

| Code | Meaning |
|------|---------|
| `PARSE_ERROR` | Invalid JSON in tool-call |
| `UNKNOWN_TOOL` | Tool name not recognized |
| `MISSING_PARAM` | Required parameter missing |
| `INVALID_PARAM` | Parameter type or value invalid |
| `PATH_NOT_FOUND` | File or directory doesn't exist |
| `PERMISSION_DENIED` | Insufficient permissions |
| `EXECUTION_TIMEOUT` | Operation timed out |
| `MATCH_FAILED` | Edit anchor matching failed |

---

## Security Considerations

### Shell Command Execution

* Shell command execution should be confirmed before execution
* Configurable command allowlist/blocklist
* Timeout enforcement (default: 30 seconds)
* Working directory restrictions

### File System Access

* Configurable workspace root boundary
* Path traversal prevention
* Optional read-only mode

---

### Configuration Example

```json
{
  "security": {
    "workspace_root": "/project",
    "allow_outside_workspace": false,
    "shell": {
      "enabled": true,
      "timeout": 30,
      "blocked_commands": ["rm -rf", "sudo", ":(){:|:&};:"]
    },
    "file": {
      "max_file_size": 1048576,
      "blocked_extensions": [".exe", ".bin"]
    }
  }
}
```

---

## ReAct Structure

structure of context window:

```
system-promot
    includes:
        1. System prompt
        2. Tool definitions and protocol specification
        3. Context status (token usage, workspace summary)
        4. Directory workspace
        5. File workspace
        6. Todo list
LLM request 1
Tool output
LLM request 2
Tool output
...
<task end>
```

When LLM supports interleaved reasoning tokens, the structure of context window:

```
system-promot
    includes:
        1. System prompt
        2. Tool definitions and protocol specification
        3. Context status (token usage, workspace summary)
        4. Directory workspace
        5. File workspace
        6. Todo list
LLM reasoning
LLM request 1
Tool output
LLM reasoning
LLM request 2
Tool output
...
<task end>
```

Interleaved reasoning means LLM would call tools while reasoning. Reasoning process is continuous between rounds of tool calling. LLM can adjust their reasoning based on tool outputs before making the next tool call.

---

## Non‑Goals

* Automatic planning or decomposition
* Embedding‑based retrieval
* Multi‑agent coordination
* Hidden memory layers
* Model fine‑tuning
* Implicit context eviction

---

## Implementation Notes

### Recommended Execution Order

When multiple tools are called in a single request:

1. Validate all tool calls first
2. Execute in array order
3. Stop on first error (unless `continue_on_error` is set)
4. Return aggregated results

### File Edit Execution Order

For `file.edit` with multiple edits:

1. Sort edits by line number (descending) to preserve line numbers
2. Validate all anchors before any modification
3. Apply edits from bottom to top
4. Update file workspace after all edits complete

### Context Workspace Updates

After tool execution, the framework should:

1. Update relevant workspace sections
2. Recalculate context status metrics
3. Update the injection part in system prompt.

---

## Example Session

### User Request

```
Fix the type error in utils.ts where the function returns string | undefined but is typed as string.
```

### System Prompt Injection 1

```
=========TASK
Fix the type error in utils.ts where the function returns string | undefined but is typed as string.
=========

=========CONTEXT STATUS
Token Usage: 0 / 128,000 (0%)
Directory Workspace: 0 directories loaded
File Workspace: 0 files, 0 lines loaded
=========

=========DIRECTORY WORKSPACE
[EMPTY]
=========

=========FILE WORKSPACE
[EMPTY]
=========

=========TODO
[EMPTY]
=========

=========NOTEPAD
[EMPTY]
=========
```

### LLM Response 1

I'll start by loading the project structure and the mentioned file.

```tool-call
[
  {
    "tool": "dir.list",
    "params": {"path": "src"}
  },
  {
    "tool": "file.load",
    "params": {"path": "src/utils.ts"}
  }
]
```

The message list would look like this:

```
<System Prompt Injection 1>
<LLM Response 1>
```

### System Prompt Injection 2

```
=========TASK
Fix the type error in utils.ts where the function returns string | undefined but is typed as string.
=========

<some tool call definitions>

=========CONTEXT STATUS
Token Usage: 12,450 / 128,000 (9.7%)
Directory Workspace: 1 directories loaded
File Workspace: 1 files, 45 lines loaded
=========

=========DIRECTORY WORKSPACE
src
---------
FILE | main.ts
FILE | utils.ts
FILE | types.ts
DIR  | components
---------
=========

=========FILE WORKSPACE
src/utils.ts [lines 1-45 of 45]
---------
   1 | import { User } from './types';
   2 |
   3 | export function getUserName(user: User): string {
   4 |   if (!user) {
   5 |     return undefined;  // Type error here
   6 |   }
   7 |   return user.name;
   8 | }

[UNLOADED]

  45 | }
---------
=========
```

### LLM Response 2

I found the issue on line 5. The function returns `undefined` but the return type is `string`. I'll fix this:

```tool-call
[
  {
    "tool": "file.edit",
    "params": {
      "path": "src/utils.ts",
      "edits": [
        {
          "mode": "replace",
          "anchor": {
            "start": {
              "line": 3,
              "text": "export function getUserName(user: User): string {",
              "before": ["import { User } from './types';", ""],
              "after": ["  if (!user) {", "    return undefined;"]
            }
          },
          "content": ["export function getUserName(user: User): string | undefined {"]
        }
      ]
    }
  },
  {
    "tool": "todo.set",
    "params": {
      "items": [
        {"text": "Fix return type in getUserName", "state": "done"},
        {"text": "Verify no downstream type errors", "state": "pending"}
      ]
    }
  }
]
```

The message list would grow like this:

```
<System Prompt Injection 2>
<LLM Response 1>
<LLM Response 2>
```
