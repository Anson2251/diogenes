# Diogenes

A minimal LLM-controlled agent framework with explicit context management, implemented in TypeScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Note**: This project is in active development. APIs may change until version 1.0.0.

## 1. What it is

Diogenes is a framework that treats the LLM as the primary controller of its own context window. Unlike traditional agent frameworks that use hidden memory layers, embeddings, or forced summarization, Diogenes exposes context manipulation explicitly through tools, allowing the LLM to decide what information stays in context.

### Core Principles

1. **LLM-controlled context**: The LLM decides what to load, unload, and modify in its context window
2. **No implicit memory**: All context must be explicitly visible to the LLM
3. **Tool-mediated interaction**: Any interaction with files, directories, or the system happens via tools
4. **Simplicity over abstraction**: Avoids planners, sub-agents, embeddings, or hidden heuristics
5. **Trust the model, but verify execution**: Tools validate and report results; the LLM reasons about them
6. **Protocol uniformity**: All tools use a single, consistent JSON invocation protocol

## 2. What is the difference

Traditional agent frameworks often hide complexity behind abstractions like:
- Implicit memory systems that summarize or embed content
- Hidden planners that break down tasks without LLM awareness
- Forced context window management (truncation, summarization)
- Complex orchestration layers

Diogenes takes a different approach:
- **Explicit context management**: The LLM sees exactly what's loaded via workspace sections
- **Direct control**: The LLM decides what to load/unload using tools
- **Transparent execution**: All tool results are visible in the context
- **Minimal abstraction**: No hidden planners, embeddings, or memory systems
- **Unified protocol**: All tools use the same simple JSON format

The key difference is **agency**: Diogenes gives the LLM direct control over its working memory, rather than hiding it behind layers of automation.

## 3. How to use it

### Prerequisites
- Node.js 18 or higher
- TypeScript 5.0+ (for development)
- pnpm (recommended) or npm/yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/Anson2251/diogenes.git
cd diogenes

# Install dependencies
pnpm install  # or npm install or yarn install
```

### Available Scripts

The following scripts are available in `package.json`:

- **`pnpm run build`** - Compile TypeScript to JavaScript using tsgo
- **`pnpm run dev`** - Development mode with watch functionality (tsgo --watch)
- **`pnpm test`** - Run tests with Vitest
- **`pnpm run lint`** - Lint code with oxlint
- **`pnpm run bundle`** - Build and create a bundled CLI executable

### Basic Usage

1. **Build the project**:
   ```bash
   pnpm run build
   ```

   or

   ```bash
   pnpm run bundle
   ```

2. **Run tests** to verify everything works:
   ```bash
   pnpm test
   ```

3. **Use the CLI** (after building):
   ```bash
   # Run a simple task
   node dist/cli.js "List all files in the current directory"
   ```

4. **For development** with auto-rebuild:
   ```bash
   pnpm run dev
   ```

### Development Workflow

1. Make changes to TypeScript files in the `src/` directory
2. Run `pnpm run dev` to watch for changes and rebuild automatically
3. Test your changes with `pnpm test`
4. Lint your code with `pnpm run lint`
5. Create a bundled executable with `pnpm run bundle`

### Project Structure

- `src/` - TypeScript source code
  - `cli.ts` - Command-line interface
  - `index.ts` - Main library entry point
  - `config/` - Configuration management
  - `context/` - Context window management
  - `llm/` - LLM integration
  - `tools/` - Tool implementations
  - `utils/` - Utility functions
- `dist/` - Compiled JavaScript (generated after build)
- `tests/` - Test files
- `bundle/` - Bundled CLI executable (generated after bundle)

### Quick Example

```typescript
import { createDiogenes } from 'diogenes';

// Create a Diogenes instance
const diogenes = createDiogenes({
  security: {
    workspaceRoot: '/path/to/workspace'
  }
});

// Get the initial prompt for the LLM
const prompt = diogenes.buildPrompt();
console.log(prompt);
```

### Note on File Editing

The file editing tool (`file.edit`) is currently in testing and may contain bugs. When editing files, ensure you:
1. Always load the file first with `file.load` to get exact content
2. Copy text verbatim from the loaded file for anchors
3. Include before/after context lines for reliable anchoring
4. Use heredoc syntax for multi-line content

## License

Diogenes is released under the MIT License. See the [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Diogenes Contributors
