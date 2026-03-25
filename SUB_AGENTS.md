# Sub-Agent System Reference

## Overview
The Sub-Agent system allows the main NeuralInverse Agent to spawn specialized sub-agents that run concurrently with scoped tool access. Each sub-agent focuses on a specific task type.

## Available Sub-Agent Roles

### 1. **Explorer** (Read-Only)
**Purpose**: Codebase research and discovery
**Tools**: read_file, ls_dir, get_dir_tree, search tools
**Use Cases**:
- Find relevant code sections
- Understand project structure
- Locate dependencies
- Discover patterns

**Example**:
```typescript
spawn({
  role: 'explorer',
  goal: 'Find all API endpoint definitions in the project'
});
```

---

### 2. **Editor** (Read + Write)
**Purpose**: Targeted code modifications
**Tools**: read_file, search tools, edit_file, rewrite_file, multi_replace
**Use Cases**:
- Implement features
- Fix bugs
- Refactor code
- Update configurations

**Example**:
```typescript
spawn({
  role: 'editor',
  goal: 'Add error handling to the login function',
  scopedFiles: ['src/auth/login.ts']
});
```

---

### 3. **Verifier** (Read + Terminal)
**Purpose**: Test execution and validation
**Tools**: read_file, search tools, terminal access, run_command
**Use Cases**:
- Run test suites
- Execute lint checks
- Verify fixes work
- Check code quality

**Example**:
```typescript
spawn({
  role: 'verifier',
  goal: 'Run all tests and report any failures'
});
```

---

### 4. **Debugger** ✨ NEW
**Purpose**: Bug hunting and fixing
**Tools**: read_file, search tools, edit_file, terminal access
**Use Cases**:
- Analyze stack traces
- Reproduce bugs
- Identify root causes
- Implement and verify fixes

**Example**:
```typescript
spawn({
  role: 'debugger',
  goal: 'Fix the NullPointerException in UserService.getUserById()'
});
```

---

### 5. **Reviewer** ✨ NEW (Read-Only)
**Purpose**: Code review and security audit
**Tools**: read_file, search tools (NO write access)
**Use Cases**:
- Security vulnerability scanning
- Code smell detection
- Best practices enforcement
- Performance analysis

**Example**:
```typescript
spawn({
  role: 'reviewer',
  goal: 'Review the authentication module for security vulnerabilities',
  scopedFiles: ['src/auth/**']
});
```

---

### 6. **Tester** ✨ NEW
**Purpose**: Test creation and coverage
**Tools**: read_file, search tools, write/edit files, terminal access
**Use Cases**:
- Write unit tests
- Create integration tests
- Improve coverage
- Identify edge cases

**Example**:
```typescript
spawn({
  role: 'tester',
  goal: 'Write comprehensive unit tests for the PaymentService class'
});
```

---

### 7. **Documenter** ✨ NEW
**Purpose**: Technical documentation
**Tools**: read_file, search tools, write/edit files
**Use Cases**:
- Generate API docs
- Update README files
- Write code comments
- Create tutorials

**Example**:
```typescript
spawn({
  role: 'documenter',
  goal: 'Document all public API endpoints in the REST controller'
});
```

---

### 8. **Architect** ✨ NEW (Read-Only + Research)
**Purpose**: System design and planning
**Tools**: read_file, search tools, query_ni_agent
**Use Cases**:
- Architecture analysis
- Design patterns
- Dependency analysis
- Refactoring plans

**Example**:
```typescript
spawn({
  role: 'architect',
  goal: 'Analyze the microservices architecture and propose improvements'
});
```

---

### 9. **Compliance**
**Purpose**: GRC compliance checking
**Tools**: read_file, search tools, GRC tools, ask_checksagent
**Use Cases**:
- Compliance verification
- GRC scanning
- Policy enforcement
- Regulatory adherence

---

### 10. **Checks-Agent** (Delegated)
**Purpose**: Full GRC agent with reasoning
**Tools**: All GRC tools via Checks Agent service
**Use Cases**:
- Deep compliance analysis
- Violation explanation
- Framework guidance

---

### 11. **Power-Mode** (Delegated)
**Purpose**: Full coding agent with bash
**Tools**: All tools via Power Mode service
**Use Cases**:
- Complex multi-step tasks
- System-level operations
- Advanced automation

---

## Tool Access Matrix

| Role | Read | Search | Edit | Terminal | GRC | Agent |
|------|------|--------|------|----------|-----|-------|
| Explorer | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editor | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Verifier | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Debugger** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Reviewer** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Tester** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Documenter** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Architect** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Compliance | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Checks-Agent | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Power-Mode | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |

---

## Concurrent Execution

Sub-agents run **in parallel** up to `maxConcurrentSubAgents` (default: 5). Additional spawns are queued.

**Example Workflow**:
```typescript
// Parallel research phase
spawn({ role: 'explorer', goal: 'Find authentication code' });
spawn({ role: 'architect', goal: 'Analyze auth architecture' });
spawn({ role: 'reviewer', goal: 'Review auth security' });

// Sequential fix phase (wait for research)
spawn({ role: 'debugger', goal: 'Fix auth bug based on findings' });
spawn({ role: 'tester', goal: 'Write tests for auth fix' });
spawn({ role: 'verifier', goal: 'Verify auth tests pass' });
```

---

## Usage from Main Agent

The main NeuralInverse Agent can spawn sub-agents via the `query_ni_agent` tool:

```typescript
await agentService.recordContext({
  type: 'tool_result',
  summary: 'Spawned debugger sub-agent to fix NullPointerException',
  importance: 7,
});

const subAgent = subAgentService.spawn({
  role: 'debugger',
  goal: 'Fix the NullPointerException in UserService.getUserById()',
});
```

---

## Configuration

Sub-agent behavior is configured via `.neuralinverseagent`:

```json
{
  "constraints": {
    "maxConcurrentSubAgents": 5,
    "subAgentTimeout": 300000
  }
}
```

---

## Future Enhancements (Phase 2-4)

### Phase 2: Core Improvements
- [ ] Sub-agent communication (message passing)
- [ ] Result aggregation
- [ ] Priority queue system
- [ ] Dependency chains

### Phase 3: Advanced Features
- [ ] Agent metrics and monitoring
- [ ] Dynamic tool whitelisting
- [ ] Agent templates (common workflows)
- [ ] Token budgets per agent

### Phase 4: Intelligence Layer
- [ ] Context-aware agent selection
- [ ] Learning from history
- [ ] Agent specialization
- [ ] Automatic orchestration

---

## Best Practices

1. **Use specific goals**: "Fix NullPointerException in UserService" not "Fix bugs"
2. **Scope editors**: Always provide `scopedFiles` for editor role
3. **Sequential dependencies**: Don't spawn dependent agents in parallel
4. **Read-only first**: Use explorer/reviewer before editor/debugger
5. **Verify changes**: Always follow edits with verifier

---

## Implementation Status

✅ **Phase 1 Complete**: 5 new roles added
- Debugger
- Reviewer
- Tester
- Documenter
- Architect

📋 **Next Steps**: Phase 2 improvements (communication, aggregation, metrics)
