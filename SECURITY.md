# Security Policy

## 🔒 API Key Safety & Local-First Architecture

Patarang is designed with **privacy and security as first-class principles**. Because presentation generation relies on powerful AI models (Google Gemini, Vertex AI, OpenAI, etc.), Patarang adheres to strict security rules regarding API keys:

1. **Bring Your Own Key (BYOK)**: Patarang does not bundle, proxy, or store any proprietary API keys on external servers. All AI calls go directly from your local instance to your chosen AI provider using your personal API key.
2. **Local Storage Only**: Your API key is saved locally in `data/config.json` on your machine (excluded from git via `.gitignore`).
3. **Zero UI Key Echoing**: The backend server **never** returns plaintext API keys to the frontend UI. The UI only receives masked strings (e.g., `••••w9yz`) and boolean presence flags.
4. **No Logging**: Outgoing requests and error handlers are sanitized so that API keys are never written to server logs or terminal output.

---

## Supported Security Best Practices for Users

- **Never Commit `.env` or `data/`**: Ensure your local configuration files and databases are never added to git.
- **Use Environment Variables (Optional)**: If preferred, you can supply your API key via local environment variables (`PATARANG_API_KEY`) rather than storing it in the config file.
- **Revoke Compromised Keys**: If you suspect an API key was exposed, revoke it immediately in your AI provider dashboard (Google AI Studio, OpenAI, etc.) and generate a new one.

---

## Reporting a Vulnerability

If you discover a security vulnerability or key-exposure risk within Patarang, please report it responsibly:

- **Email**: security@patarang.dev (or open a private security advisory on GitHub).
- **Scope**: Vulnerabilities in the core server, export pipeline, configuration store, or frontend bridge.

We commit to investigating all valid reports promptly and releasing patches as needed. Thank you for helping keep Patarang secure!
