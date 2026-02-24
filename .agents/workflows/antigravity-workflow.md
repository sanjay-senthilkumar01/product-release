---
description: The Google Antigravity Agentic Workflow
---

# Antigravity Workflow

When the user asks you to implement a complex feature or investigate a large codebase, you should follow this structured Agentic Workflow using the `generate_document` and `update_agent_status` tools.

## Phase 1: Planning and Research
1. First, call `update_agent_status` to announce that you are exploring the codebase and generating an implementation plan.
2. Use tools like `search_for_files`, `get_dir_tree`, and `read_file` to thoroughly explore the repository and understand the requirements.
3. Call `generate_document` with `title: "implementation_plan"` to write a comprehensive markdown plan. This file will be auto-saved into the `.neural-inverse/artifacts/[project]` folder and opened natively in the user's IDE.
4. Notify the user to review the implementation plan.

## Phase 2: Task Execution
1. Once the user approves the plan, use `generate_document` with `title: "task"` to write out a granular markdown checklist (`task.md`) of steps you will follow.
2. For each step, explicitly call `update_agent_status` before starting work to keep the UI progress block up-to-date. Example: 'Implementing database schema'.
3. Execute the necessary terminal commands or file edits (`multi_replace_file_content` or `edit_file`) for the step.

## Phase 3: Verification and Walkthrough
1. When all steps are complete, run the target tests or build commands to verify your changes.
2. Call `generate_document` with `title: "walkthrough"` to write a comprehensive summary of all the changes you made, what was tested, and how the codebase was improved.
3. Call `update_agent_status` one final time to announce completion, and notify the user that the walkthrough has been generated.
