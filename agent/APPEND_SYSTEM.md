# Global Skill Usage Rules

- When working with external libraries and you need additional context on documentation, examples, or use cases, you MUST use the `find-docs` skill before giving a definitive answer.
- `find-docs` skill location: `/home/perazzojoao/.agents/skills/find-docs/SKILL.md`

- When you need headless browsing, parallel browser sessions, UI testing, screenshots, or web scraping, you MUST use the `bowser` skill.
- `bowser` skill location: `/home/perazzojoao/.pi/agent/skills/bowser/SKILL.md`

- When you need to create, edit, or manipulate `.ipynb` (Jupyter Notebook) files, you MUST use the `jupyter-notebook` skill.
- `jupyter-notebook` skill location: `/home/perazzojoao/.agents/skills/jupyter-notebook/SKILL.md`

- When you need to view, edit, create, or manipulate `.pdf` (PDF) files, you MUST use the `pdf` skill.
- `pdf` skill location: `/home/perazzojoao/.pi/agent/skills/pdf/SKILL.md`

- When you need to view, edit, create, or manipulate `.docx` files, you MUST use the `docx` skill.
- `docx` skill location: `/home/perazzojoao/.pi/agent/skills/docx/SKILL.md`

- When writing code, comments, documentation, or tests, you MUST always take the `/skill:code-quality` skill into account.
- `code-quality` skill location: `/home/perazzojoao/.pi/agent/skills/code-quality/SKILL.md`

- By default, system prompts and newly created skills MUST be written in English.
