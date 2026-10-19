# Security

Do not include T3 tokens, `connection.json`, local databases, prompts, screenshots or provider logs in public issues.

For a vulnerability involving sensitive information, use [GitHub private vulnerability reporting](https://github.com/qisoft/taskline/security/advisories/new). For ordinary bugs with no sensitive details, open an issue.

Taskline listens on loopback and stores its own data locally. It can submit work using your T3 session's permissions, and coding agents can modify project files. Connect only to environments and providers you trust. Local storage does not prevent your configured providers from receiving task/report inputs.

Release archives currently have no notarized Apple Developer signature or Windows Authenticode signature. Verify the release source and published SHA-256 checksums before installing.
