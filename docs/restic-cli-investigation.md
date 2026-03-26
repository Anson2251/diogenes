# Restic CLI Investigation

Date: 2026-03-26

## Overview

Restic is a modern backup program that provides:
- Encrypted, deduplicated backups
- Incremental snapshots
- Cross-platform support (Linux, BSD, macOS, Windows)
- Multiple backend support (local, SFTP, S3, B2, Azure, etc.)

## Core Commands for Session Snapshot System

### 1. `restic init` - Initialize Repository

Initialize a new repository at the specified path:

```bash
# Basic initialization
restic init --repo /path/to/repo

# With environment variable
export RESTIC_REPOSITORY=/path/to/repo
restic init

# With password file
restic init --repo /path/to/repo --password-file /path/to/password.txt

# With password from environment
export RESTIC_PASSWORD="your-password"
restic init --repo /path/to/repo

# Insecure: no password (not recommended for production)
restic init --repo /path/to/repo --insecure-no-password
```

**Important Notes:**
- Password is required for all subsequent operations
- Losing the password means data is irrecoverable
- Repository is created with encryption by default

### 2. `restic backup` - Create Snapshot

Create a new snapshot of files/directories:

```bash
# Basic backup
restic backup /path/to/backup

# With repository specified
restic -r /path/to/repo backup /path/to/backup

# With verbose output
restic backup --verbose /path/to/backup

# With tags
restic backup --tag important --tag daily /path/to/backup

# Dry run
restic backup --dry-run /path/to/backup

# Exclude patterns
restic backup --exclude "*.tmp" --exclude ".git" /path/to/backup

# Exclude from file
restic backup --exclude-file excludes.txt /path/to/backup

# Skip if unchanged
restic backup --skip-if-unchanged /path/to/backup

# JSON output
restic backup --json /path/to/backup
```

**Output Example:**
```
repository a14e5863 opened (version 2, compression level auto)
using parent snapshot 40dc1520
start scan on [/home/user/work]
start backup on [/home/user/work]
scan finished in 1.881s: 5307 files, 1.720 GiB
Files: 0 new, 0 changed, 5307 unmodified
Dirs: 0 new, 0 changed, 1867 unmodified
Added to the repository: 0 B (0 B stored)
processed 5307 files, 1.720 GiB in 0:03
snapshot 79766175 saved
```

**Key Features:**
- Deduplication: only stores new/changed data
- Incremental: uses parent snapshot for change detection
- Compression: automatic compression (repo version 2)
- Metadata preservation: permissions, timestamps, etc.

### 3. `restic snapshots` - List Snapshots

List all snapshots in the repository:

```bash
# Basic listing
restic snapshots

# With repository specified
restic -r /path/to/repo snapshots

# JSON output (useful for programmatic access)
restic snapshots --json

# Filter by host
restic snapshots --host myhost

# Filter by path
restic snapshots --path /home/user

# Filter by tag
restic snapshots --tag important

# Compact output
restic snapshots --compact
```

**JSON Output Example:**
```json
[
  {
    "time": "2026-03-26T10:30:00.123456789+08:00",
    "tree": "bf25241679533df554fc0fd0ae6dbb9dcf1859a13f2bc9dd4543c354eff6c464",
    "paths": ["/home/user/work"],
    "hostname": "myhost",
    "username": "user",
    "uid": 1000,
    "gid": 100,
    "id": "79766175d126594950bf74f0a348d5d98d9e99f3215082eb69bf02dc9b3e464c",
    "short_id": "79766175",
    "tags": ["important", "daily"]
  }
]
```

### 4. `restic restore` - Restore Snapshot

Extract data from a snapshot:

```bash
# Basic restore
restic restore <snapshot-id> --target /path/to/restore

# Restore latest snapshot
restic restore latest --target /path/to/restore

# With repository specified
restic -r /path/to/repo restore <snapshot-id> --target /path/to/restore

# Restore specific subdirectory
restic restore <snapshot-id>:path/to/subdir --target /path/to/restore

# Include/exclude patterns
restic restore <snapshot-id> --target /path/to/restore \
  --include /important \
  --exclude "*.tmp"

# Delete files not in snapshot
restic restore <snapshot-id> --target /path/to/restore --delete

# Dry run
restic restore <snapshot-id> --target /path/to/restore --dry-run

# Verbose output
restic restore <snapshot-id> --target /path/to/restore --verbose=2
```

**Important Notes:**
- Default behavior: overwrites existing files at target
- `--delete`: removes files not in snapshot (dangerous!)
- `--dry-run`: preview changes without writing
- Restore to staging directory first for safety

## Environment Variables

Restic supports configuration through environment variables:

```bash
# Repository location
export RESTIC_REPOSITORY=/path/to/repo

# Password (insecure if in shell history)
export RESTIC_PASSWORD="your-password"

# Password file
export RESTIC_PASSWORD_FILE=/path/to/password.txt

# Password command
export RESTIC_PASSWORD_COMMAND="cat /path/to/password.txt"

# Cache directory
export RESTIC_CACHE_DIR=/path/to/cache

# Compression mode
export RESTIC_COMPRESSION=auto  # auto|off|max

# Hostname override
export RESTIC_HOST=myhost

# Concurrency
export RESTIC_READ_CONCURRENCY=2
```

## Exit Codes

Understanding exit codes is important for error handling:

- `0`: Success (snapshot created successfully)
- `1`: Fatal error (no snapshot created)
- `3`: Partial success (incomplete snapshot created)

**Example handling:**
```bash
restic backup /path/to/backup
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "Backup successful"
elif [ $EXIT_CODE -eq 1 ]; then
    echo "Backup failed - fatal error"
    exit 1
elif [ $EXIT_CODE -eq 3 ]; then
    echo "Backup completed with warnings - some files unreadable"
fi
```

## Recommended Patterns for Session Snapshots

### 1. Repository Initialization

```bash
# Create session-specific repository
SESSION_ID="session-$(uuidgen)"
REPO_PATH="/tmp/diogenes-snapshots/$SESSION_ID/repo"

# Generate random password for session
PASSWORD_FILE="/tmp/diogenes-snapshots/$SESSION_ID/.password"
openssl rand -base64 32 > "$PASSWORD_FILE"

# Initialize repository
export RESTIC_REPOSITORY="$REPO_PATH"
export RESTIC_PASSWORD_FILE="$PASSWORD_FILE"
restic init
```

### 2. Create Automatic Snapshot

```bash
# Before each prompt, create snapshot
restic backup /workspace \
  --tag "before_prompt" \
  --tag "turn_1" \
  --json \
  --quiet
```

### 3. Create Manual Snapshot

```bash
# LLM-triggered snapshot
restic backup /workspace \
  --tag "llm_manual" \
  --tag "before_risky_edit" \
  --json \
  --quiet
```

### 4. List Session Snapshots

```bash
# Get all snapshots for this session
restic snapshots --json | jq -r '.[] | select(.tags | contains(["session-xxx"]))'
```

### 5. Restore Snapshot

```bash
# Restore to staging directory first
STAGING_DIR="/tmp/diogenes-snapshots/$SESSION_ID/restore-staging"
restic restore <snapshot-id> --target "$STAGING_DIR"

# Validate restore
if [ $? -eq 0 ]; then
    # Replace workspace contents
    rsync -a --delete "$STAGING_DIR/" /workspace/
fi
```

### 6. Cleanup Session

```bash
# Remove entire session directory
rm -rf "/tmp/diogenes-snapshots/$SESSION_ID"
```

## Important Considerations

### 1. Password Management

**Option A: Random Password (Recommended for Sessions)**
```bash
# Generate random password
PASSWORD=$(openssl rand -base64 32)
echo "$PASSWORD" > "$PASSWORD_FILE"

# Use with environment variable
export RESTIC_PASSWORD="$PASSWORD"
```

**Option B: Empty Password (Insecure but Simple)**
```bash
# Use --insecure-no-password flag
restic init --insecure-no-password
restic backup --insecure-no-password /path/to/backup
```

### 2. Performance Optimization

```bash
# Skip unchanged files
restic backup --skip-if-unchanged /workspace

# Disable change detection (force rescan)
restic backup --force /workspace

# Limit concurrent reads
restic backup --read-concurrency 4 /workspace
```

### 3. Exclude Patterns

```bash
# Common excludes for code projects
restic backup /workspace \
  --exclude "node_modules" \
  --exclude ".git" \
  --exclude "*.log" \
  --exclude ".DS_Store" \
  --exclude "dist" \
  --exclude "build"
```

### 4. JSON Output Parsing

```bash
# Get snapshot ID from backup
SNAPSHOT_ID=$(restic backup /workspace --json 2>&1 | \
  jq -r 'select(.message_type == "summary") | .snapshot_id')

# List snapshots with specific tags
restic snapshots --json | jq -r '.[] | select(.tags | contains(["before_prompt"])) | .id'
```

## Wrapper Implementation Recommendations

### TypeScript Interface

```typescript
interface ResticClient {
  initRepo(): Promise<void>;
  backup(params: {
    paths: string[];
    tags?: string[];
    exclude?: string[];
    skipIfUnchanged?: boolean;
  }): Promise<{ snapshotId: string }>;
  snapshots(params?: {
    tag?: string[];
    path?: string[];
    host?: string;
  }): Promise<Array<{ id: string; time: string; tags: string[] }>>;
  restore(params: {
    snapshotId: string;
    target: string;
    include?: string[];
    exclude?: string[];
  }): Promise<void>;
}
```

### Example Implementation

```typescript
class ResticClientImpl implements ResticClient {
  private repoPath: string;
  private passwordFile: string;
  
  constructor(repoPath: string, passwordFile: string) {
    this.repoPath = repoPath;
    this.passwordFile = passwordFile;
  }
  
  async initRepo(): Promise<void> {
    await exec(`restic init --repo "${this.repoPath}" --password-file "${this.passwordFile}"`);
  }
  
  async backup(params: BackupParams): Promise<{ snapshotId: string }> {
    const tags = params.tags?.map(t => `--tag "${t}"`).join(' ') || '';
    const excludes = params.exclude?.map(e => `--exclude "${e}"`).join(' ') || '';
    const skip = params.skipIfUnchanged ? '--skip-if-unchanged' : '';
    
    const output = await exec(
      `restic backup --repo "${this.repoPath}" --password-file "${this.passwordFile}" ` +
      `--json --quiet ${tags} ${excludes} ${skip} ${params.paths.join(' ')}`
    );
    
    const result = JSON.parse(output);
    return { snapshotId: result.snapshot_id };
  }
  
  async snapshots(params?: SnapshotParams): Promise<SnapshotInfo[]> {
    const cmd = `restic snapshots --repo "${this.repoPath}" --password-file "${this.passwordFile}" --json`;
    const output = await exec(cmd);
    return JSON.parse(output);
  }
  
  async restore(params: RestoreParams): Promise<void> {
    const includes = params.include?.map(i => `--include "${i}"`).join(' ') || '';
    const excludes = params.exclude?.map(e => `--exclude "${e}"`).join(' ') || '';
    
    await exec(
      `restic restore --repo "${this.repoPath}" --password-file "${this.passwordFile}" ` +
      `"${params.snapshotId}" --target "${params.target}" ${includes} ${excludes}`
    );
  }
}
```

## Error Handling Best Practices

```typescript
class ResticError extends Error {
  constructor(
    public exitCode: number,
    public stderr: string,
    public command: string
  ) {
    super(`Restic command failed: ${command}`);
  }
}

async function safeBackup(backupFn: () => Promise<void>): Promise<void> {
  try {
    await backupFn();
  } catch (error) {
    if (error instanceof ResticError) {
      if (error.exitCode === 1) {
        // Fatal error - reject the prompt
        throw new Error('Snapshot creation failed - prompt rejected for safety');
      } else if (error.exitCode === 3) {
        // Partial success - log warning but continue
        console.warn('Snapshot created with warnings - some files unreadable');
      }
    }
    throw error;
  }
}
```

## Security Considerations

1. **Password Storage**
   - Store password in temp file with restricted permissions
   - Use environment variables for transient sessions
   - Never commit password files to version control

2. **Repository Isolation**
   - Use separate repository per session
   - Clean up repositories when session ends
   - Avoid shared repositories for isolation

3. **Restore Safety**
   - Always restore to staging directory first
   - Validate restored data before replacing workspace
   - Use `--dry-run` to preview restore operations

4. **Access Control**
   - LLM should only have access to `backup` command
   - Host controls `restore` and repository management
   - Never expose raw restic commands to LLM

## Resources

- Official Documentation: https://restic.readthedocs.io/
- GitHub Repository: https://github.com/restic/restic
- Forum: https://forum.restic.net/

## Next Steps for Implementation

1. Implement `ResticClient` wrapper class
2. Add session-specific repository initialization
3. Integrate automatic snapshot before each prompt
4. Implement `snapshot.create` tool
5. Add restore functionality (host-controlled)
6. Add session cleanup on disposal
7. Write tests for snapshot lifecycle
