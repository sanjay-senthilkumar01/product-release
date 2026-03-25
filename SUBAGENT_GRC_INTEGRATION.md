# Sub-Agent GRC Integration - Regulated Software Development

## 🏛️ Overview

All sub-agents now include **GRC compliance checks** and **audit trail logging** for regulated and critical software development. Every agent that modifies code must verify compliance before reporting success.

---

## 🔐 Compliance Workflow

### Mandatory Steps for ALL Code-Modifying Agents

1. **Before Making Changes**:
   - Check existing violations with `grc_violations`
   - Review framework rules with `grc_framework_rules`
   - Assess impact with `grc_impact_chain`

2. **After Making Changes**:
   - Run `grc_rescan` to re-evaluate
   - Check `grc_blocking_violations`
   - **FAIL if blocking violations detected**

3. **Always Log**:
   - Use `memory_write` to log all changes
   - Include: what changed, why, GRC results
   - Generate documentation with `generate_document`

---

## 🛠️ Updated Tool Access

### 🐛 Debugger (Enhanced for Compliance)
**New Tools Added**:
- ✅ `create_file_or_folder` - Create missing files when fixing bugs
- ✅ `delete_file_or_folder` - Clean up during fixes
- ✅ `grc_violations` - Check if fix introduces violations
- ✅ `grc_blocking_violations` - Ensure no blockers
- ✅ `grc_impact_chain` - Assess blast radius of fix
- ✅ `grc_rescan` - Re-scan after fix
- ✅ `memory_write` / `memory_read` - Audit trail logging
- ✅ `web_fetch` - Research error messages/solutions

**Compliance Workflow**:
```
1. Analyze bug
2. Check grc_violations for related compliance issues
3. Reproduce with tests
4. Implement fix
5. Run grc_rescan
6. Check grc_blocking_violations
7. If violations → FAIL, report to user
8. If clean → run tests to verify
9. Log fix with memory_write
10. Generate fix documentation
```

---

### 👁️ Reviewer (CRITICAL for Regulated Software)
**New Tools Added**:
- ✅ `grc_violations` - Check compliance violations
- ✅ `grc_domain_summary` - Review by compliance domain
- ✅ `grc_blocking_violations` - Identify blockers
- ✅ `grc_framework_rules` - Check against frameworks
- ✅ `grc_impact_chain` - Cross-file impact analysis
- ✅ `ask_checksagent` - Deep compliance reasoning
- ✅ `web_fetch` - CVE lookups, best practices
- ✅ `memory_write` / `memory_read` - Audit findings

**Review Levels**:
- **CRITICAL**: Blocking GRC violations (grc_blocking_violations)
- **HIGH**: Security vulnerabilities (CVEs, injection, XSS)
- **MEDIUM**: Code quality, best practices
- **LOW**: Style, conventions

**Compliance Workflow**:
```
1. Read code
2. Check grc_violations
3. Review grc_blocking_violations → mark as CRITICAL
4. Use ask_checksagent for complex compliance questions
5. Check grc_impact_chain for cross-file effects
6. web_fetch for CVE/security research
7. Log all findings with memory_write
8. Generate comprehensive review report (includes compliance section)
```

---

### 🧪 Tester (Compliance Test Validation)
**New Tools Added**:
- ✅ `delete_file_or_folder` - Clean up obsolete tests
- ✅ `grc_violations` - Verify tests cover compliance rules
- ✅ `grc_framework_rules` - Identify what must be tested
- ✅ `grc_rescan` - Re-scan after test updates
- ✅ `memory_write` / `memory_read` - Log test coverage

**Compliance Workflow**:
```
1. Check grc_framework_rules to see what MUST be tested
2. Read existing code and tests
3. Identify gaps in compliance test coverage
4. Write tests that verify compliance rules
5. Run tests to verify they work
6. Run grc_rescan
7. Check grc_violations to ensure tests cover rules
8. Log coverage improvements with memory_write
9. Generate test report
```

---

### 📝 Documenter (Compliance Documentation)
**New Tools Added**:
- ✅ `grc_framework_rules` - Document compliance requirements
- ✅ `grc_domain_summary` - Document by compliance domain
- ✅ `grc_violations` - Document compliance status
- ✅ `web_fetch` - Research best practices
- ✅ `memory_write` / `memory_read` - Track doc changes

**Compliance Workflow**:
```
1. Read code
2. Check grc_framework_rules for regulatory requirements
3. Review grc_domain_summary for compliance domains
4. Include compliance information in documentation
5. Document regulatory traceability
6. web_fetch for best practices
7. Log documentation changes with memory_write
8. Generate final documentation
```

**Documentation Must Include**:
- Regulatory context (which frameworks apply)
- Compliance requirements met
- Any known violations or exceptions
- Traceability to requirements

---

### 🏗️ Architect (Compliance Impact Analysis)
**New Tools Added**:
- ✅ `grc_impact_chain` - Architectural impact analysis
- ✅ `grc_domain_summary` - Cross-domain assessment
- ✅ `grc_framework_rules` - Architectural constraints
- ✅ `web_fetch` - Design pattern research
- ✅ `memory_write` / `memory_read` - Audit trail

**Compliance Workflow**:
```
1. Read and analyze architecture
2. Use grc_impact_chain to map dependencies
3. Review grc_domain_summary for affected domains
4. Check grc_framework_rules for architectural constraints
5. Assess compliance impact of proposed changes
6. Use query_ni_agent and web_fetch for research
7. Log findings with memory_write
8. Generate architectural proposal (includes compliance impact section)
```

---

## 📊 Tool Access Matrix (Updated)

| Role | Read | Search | Edit | Delete | Terminal | GRC | Audit | Research |
|------|------|--------|------|--------|----------|-----|-------|----------|
| Explorer | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Editor | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Verifier | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Debugger** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Reviewer** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Tester** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Documenter** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Architect** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Compliance | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

**Legend**:
- GRC = GRC compliance tools (grc_violations, grc_rescan, etc.)
- Audit = memory_write/read for audit trail
- Research = web_fetch + query_ni_agent

---

## 🎯 Compliance Gates

### Gate 1: Before Code Changes
- Review `grc_violations` for existing issues
- Understand `grc_framework_rules` constraints
- Check `grc_impact_chain` for dependencies

### Gate 2: After Code Changes
- Run `grc_rescan` (MANDATORY)
- Check `grc_blocking_violations`
- **If blocking violations exist → FAIL and report**

### Gate 3: Documentation
- Log all changes with `memory_write`
- Generate documentation with `generate_document`
- Include compliance status in reports

---

## 🚨 Failure Scenarios

### Scenario 1: Blocking Violation Detected
```
Debugger fixes bug → runs grc_rescan → blocking violation found
↓
FAIL: "Fix introduced blocking violation: [details]"
↓
Report to user with violation details
DO NOT mark fix as complete
```

### Scenario 2: Compliance Impact Too Large
```
Architect proposes refactoring → grc_impact_chain shows 50+ files affected
↓
WARN: "High compliance impact: affects 50 files across 3 domains"
↓
Flag for human review before proceeding
```

### Scenario 3: Missing Compliance Tests
```
Tester checks grc_framework_rules → 10 rules without test coverage
↓
Write tests for uncovered compliance rules
↓
Verify with grc_violations
```

---

## 📝 Audit Trail Format

All agents must log to memory with this structure:

```json
{
  "timestamp": "2026-03-25T10:30:00Z",
  "agent_role": "debugger",
  "task_id": "abc-123",
  "action": "fix_bug",
  "files_modified": ["src/auth/login.ts"],
  "grc_status": {
    "scan_run": true,
    "blocking_violations": 0,
    "warnings": 2,
    "impact_chain_checked": true,
    "affected_domains": ["authentication", "authorization"]
  },
  "tests_run": true,
  "tests_passed": true,
  "documentation_generated": true
}
```

---

## 🔍 Testing Compliance Integration

### Test 1: Debugger with Compliance Check
```typescript
await subAgentService.spawn({
  role: 'debugger',
  goal: 'Fix the authentication bypass bug in login.ts'
});

// Expected:
// 1. Analyzes bug
// 2. Implements fix
// 3. Runs grc_rescan
// 4. Checks grc_blocking_violations
// 5. If violations → reports FAILURE
// 6. If clean → runs tests and reports SUCCESS
// 7. Logs to memory
// 8. Generates fix documentation
```

### Test 2: Reviewer with GRC Analysis
```typescript
await subAgentService.spawn({
  role: 'reviewer',
  goal: 'Review PaymentController.ts for security and compliance'
});

// Expected:
// 1. Reads code
// 2. Checks grc_violations
// 3. Identifies blocking violations as CRITICAL
// 4. Uses ask_checksagent for complex questions
// 5. Checks grc_impact_chain
// 6. web_fetch for CVE research
// 7. Generates report with sections:
//    - CRITICAL: Blocking violations
//    - HIGH: Security issues
//    - MEDIUM: Code quality
//    - LOW: Style
// 8. Logs findings to memory
```

### Test 3: Tester with Compliance Coverage
```typescript
await subAgentService.spawn({
  role: 'tester',
  goal: 'Ensure all HIPAA compliance rules are tested'
});

// Expected:
// 1. Checks grc_framework_rules for HIPAA
// 2. Identifies rules without test coverage
// 3. Writes tests for uncovered rules
// 4. Runs tests to verify
// 5. Runs grc_rescan
// 6. Verifies grc_violations improved
// 7. Logs coverage to memory
// 8. Generates test report
```

---

## ✅ Implementation Complete

**Files Modified**:
1. `subAgentTypes.ts` - Added GRC tools, audit tools, research tools to all roles
2. `subAgentTypes.ts` - Updated metadata with compliance workflows
3. `neuralInverseSubAgentService.ts` - Removed unused import

**New Capabilities**:
- ✅ All code-modifying agents run GRC checks
- ✅ Audit trail logging via memory_write
- ✅ Compliance-first workflows
- ✅ Research capabilities (web_fetch)
- ✅ Comprehensive documentation generation

**Status**: Ready for testing in regulated software development environment.

---

## 🔜 Future Enhancements

1. **Automated Compliance Dashboards**
   - Track violation trends
   - Agent compliance scores
   - Audit trail visualization

2. **Pre-commit Hooks**
   - Auto-run grc_rescan before commits
   - Block commits with violations

3. **Compliance Templates**
   - Pre-defined workflows for specific regulations (HIPAA, SOX, GDPR)
   - Industry-specific rule sets

4. **Cross-Agent Compliance**
   - Share compliance findings between agents
   - Collaborative compliance verification
