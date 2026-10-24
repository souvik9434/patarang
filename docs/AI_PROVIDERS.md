# Configuring AI Providers & API Keys

SlideForge uses a **Bring Your Own Key (BYOK)** model. You maintain complete control over your AI provider, model choice, and API spend.

---

## Supported Providers

### 1. Google Gemini (AI Studio) — *Recommended*
- **Provider key**: `gemini`
- **Default model**: `gemini-2.5-flash` (or `gemini-2.5-pro`)
- **How to get a key**: Visit [Google AI Studio](https://aistudio.google.com/) to generate a free or paid API key (`AIza...`).
- **Configuration**: Open Setup (⚙) in the SlideForge studio, select **Gemini**, paste your API key, and click **Save & Validate**.

### 2. Google Cloud Vertex AI (Express Mode)
- **Provider key**: `vertex`
- **Default model**: `gemini-2.5-flash`
- **How to use**: Enter your Vertex AI Agent Studio API key (`aiplatform.googleapis.com` endpoint with header `x-goog-api-key`).

### 3. OpenAI-Compatible Endpoints (OpenAI, OpenRouter, LM Studio, Ollama)
- **Provider key**: `openai-compatible`
- **Default model**: `gpt-4o` or local model name
- **Base URL**: Set your custom base URL (e.g., `https://api.openai.com/v1` or `http://localhost:1234/v1`).

---

## Security Guarantees

- **Zero Telemetry**: Your API key never leaves your local machine.
- **File Storage**: Keys are stored securely in `data/config.json` (excluded from git).
- **UI Masking**: The server returns only masked representations (`••••w9yz`) to the browser UI.
