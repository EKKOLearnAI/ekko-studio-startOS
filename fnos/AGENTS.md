# fnOS package maintenance

Keep fnOS packaging in this directory and `.github/workflows/fnos-package.yml`.
The root StartOS wrapper is a different target; do not mix its `.s9pk` metadata
or lifecycle with this `.fpk` target.

Use upstream EKKOLearnAI source at `package-config.json`'s exact commit.
Keep distributor identity EKKOLearnAI and verify both native architectures.
Run `node --test fnos/tests/control.test.mjs`, then the Docker build/native
smoke and actual fnpack artifact verification from the workflow.

Do not log passwords/tokens, weaken package-user execution, expose default
credentials, or claim fnOS device validation from Linux/container tests.
StartOS registry publication and fnOS App Center submission remain separate
user-authorized actions.
