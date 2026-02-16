# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public issue.** Instead, contact the maintainer directly via email or through a private GitHub message.

Please include:

- A description of the vulnerability.
- Steps to reproduce it.
- The potential impact.

Reports will be acknowledged within 48 hours. A fix will be prioritized based on severity.

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |

## Security Measures

This application implements the following security practices:

- **No hardcoded secrets.** API keys are stored locally using encrypted storage.
- **Context isolation and sandboxing** are enabled in all Electron windows.
- **Content Security Policy** restricts resource loading in the renderer.
- **DevTools are disabled** in production builds.
- **All network traffic** uses HTTPS exclusively.
- **No telemetry or analytics** are collected.
