---
name: qa
description: 'QA skill collection for generating high-quality tests, evaluating coverage, and guiding test-related workflows. Use only when QA work requires detailed testing guidance, test generation, test-case analysis, or subskill selection.'
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
context: fork
---

# QA Skill Collection

This skill collection helps QA agents generate, maintain, and evaluate high-quality project tests while preserving project conventions and minimizing unnecessary context usage.

## Available Subskills / Commands

- `generate-tests`
  - Use when the user asks to generate, create, or write test code.
  - Analyze the target code, identify missing coverage, propose structured test cases, then generate test code when appropriate.
  - Existing specialized support includes Java unit tests with JUnit 5, Mockito, and AssertJ.

- `generate-test-cases`
  - Use when the user asks to analyze coverage, list needed test cases, or review testing strategy without writing test code.
  - Produces structured test case descriptions only.

## Workflow

1. Clarify the target under test and the requested test scope: unit, integration, end-to-end, regression, or coverage review.
2. Dynamically load only the subskill needed for the task:
   - Load `generate-tests/SKILL.md` for generating actual tests.
   - Load `generate-test-cases/SKILL.md` for test-case planning only.
3. Read the relevant source, dependencies, existing tests, fixtures, and project testing conventions before proposing or writing tests.
4. Prefer extending existing test files when that matches project conventions; create new test files only when appropriate.
5. Cover meaningful behavior and branches, including success paths, validation, errors, edge cases, security behavior, and integrations where requested.
6. Run the relevant test and lint commands when available and report failures clearly with file paths and actionable details.
7. Keep generated tests focused, deterministic, maintainable, and aligned with existing style.

## Rules

- Tests must validate behavior, not implementation details, unless the project convention requires otherwise.
- Avoid brittle tests that depend on timing, ordering, randomness, external services, or global state unless properly controlled.
- Use existing fixtures, helpers, factories, mocks, and assertion style whenever possible.
- Do not invent APIs, constructors, fields, test utilities, or commands; inspect the codebase first.
- Do not skip existing tests. Always check whether coverage already exists before adding duplicate tests.
- If linting or tests fail, report the exact command and relevant errors.
- If source code appears buggy, report the suspected issue and demonstrate it through tests when possible.

## Strict File Modification Policy

QA work is categorically prohibited from modifying files unrelated to tests. Only create or edit test files, test fixtures, test snapshots, and test-specific configuration when explicitly required for testing. If a non-test source file appears to need changes, report the issue instead of modifying it.

## Dynamic Loading Guidance

Use this collection as an index. Do not load every QA subskill by default. Load detailed subskill instructions only when they are needed for the current request, so token usage stays low.

Examples:

- User asks: "What test cases are missing for this class?" Load `generate-test-cases` only.
- User asks: "Write unit tests for this service." Load `generate-tests`.
- User asks: "Run tests and lint." Do not load a subskill unless deeper testing guidance is needed.

## Contribution Notes

When adding new QA subskills:

- Place each subskill in its own directory relative to this QA skill directory, with a `SKILL.md` file.
- Give the subskill a narrow trigger description so it loads only for relevant tasks.
- Document the expected inputs, workflow, output format, and quality rules.
- Update this collection index with the new subskill name, purpose, and when to load it.
- Preserve the strict file modification policy for QA-related work.
