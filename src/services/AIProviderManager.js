/**
 * AIProviderManager
 *
 * Manages AI provider configurations (OpenAI-compatible & Ollama).
 * Config is persisted to localStorage under the key `glotshot_ai_providers_v1`.
 *
 * Data shape:
 * {
 *   providers: Array<Provider>,
 *   activeProviderId: string | null,
 *   activeModelName: string | null,
 * }
 *
 * Provider shape:
 * {
 *   id: string,
 *   name: string,
 *   type: 'openai-compatible' | 'ollama',
 *   baseUrl: string,
 *   apiKey: string,       // empty string for ollama
 *   models: string[],
 *   createdAt: string,    // ISO timestamp
 * }
 */

const STORAGE_KEY = 'glotshot_ai_providers_v1';
const TRANSLATION_TIMEOUT_MS = 15000;

// ─── Persistence helpers ───────────────────────────────────────────────────

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('[AIProviderManager] Failed to save config:', e);
  }
}

function defaultConfig() {
  return {
    providers: [],
    activeProviderId: null,
    activeModelName: null,
  };
}

// ─── ID generator ──────────────────────────────────────────────────────────

function generateId() {
  return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Change listeners ──────────────────────────────────────────────────────

const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(AIProviderManager.getState()); } catch { /* ignore */ }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export const AIProviderManager = {
  /** Get full config object */
  getConfig() {
    return loadConfig();
  },

  /** Get all providers */
  getAll() {
    return loadConfig().providers;
  },

  /** Get active provider + model info, or null if not configured */
  getActiveConfig() {
    const config = loadConfig();
    const provider = config.providers.find(p => p.id === config.activeProviderId) ?? null;
    const modelName = config.activeModelName ?? null;
    return { provider, modelName };
  },

  /** Readable state object for UI */
  getState() {
    return {
      providers: loadConfig().providers,
      activeProviderId: loadConfig().activeProviderId,
      activeModelName: loadConfig().activeModelName,
    };
  },

  /** Add a new provider and persist */
  addProvider(fields) {
    const config = loadConfig();
    const provider = {
      id: generateId(),
      name: fields.name || 'Unnamed Provider',
      type: fields.type || 'openai-compatible',
      baseUrl: (fields.baseUrl || '').trim().replace(/\/$/, ''),
      apiKey: fields.apiKey || '',
      models: Array.isArray(fields.models) ? fields.models.filter(Boolean) : [],
      createdAt: new Date().toISOString(),
    };
    config.providers = [...config.providers, provider];
    saveConfig(config);
    notify();
    return provider;
  },

  /** Update an existing provider by id */
  updateProvider(id, fields) {
    const config = loadConfig();
    config.providers = config.providers.map(p => {
      if (p.id !== id) return p;
      return {
        ...p,
        name: fields.name ?? p.name,
        type: fields.type ?? p.type,
        baseUrl: fields.baseUrl != null ? fields.baseUrl.trim().replace(/\/$/, '') : p.baseUrl,
        apiKey: fields.apiKey ?? p.apiKey,
        models: Array.isArray(fields.models) ? fields.models.filter(Boolean) : p.models,
      };
    });
    saveConfig(config);
    notify();
  },

  /** Remove a provider by id. Clears active selection if it was the active one. */
  removeProvider(id) {
    const config = loadConfig();
    config.providers = config.providers.filter(p => p.id !== id);
    if (config.activeProviderId === id) {
      config.activeProviderId = null;
      config.activeModelName = null;
    }
    saveConfig(config);
    notify();
  },

  /** Set the active provider and model for translation */
  setActive(providerId, modelName) {
    const config = loadConfig();
    config.activeProviderId = providerId;
    config.activeModelName = modelName;
    saveConfig(config);
    notify();
  },

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ── Connection test ──────────────────────────────────────────────────────

  /**
   * Test connectivity to a provider.
   * Returns { ok: boolean, reason: string | null, models: string[] }
   */
  async testConnection(provider) {
    if (!provider?.baseUrl) {
      return { ok: false, reason: 'missing-url', models: [] };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      if (provider.type === 'ollama') {
        // Ollama: GET /api/tags
        const res = await fetch(`${provider.baseUrl}/api/tags`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = (data.models || []).map(m => m.name).filter(Boolean);
        return { ok: true, reason: null, models };
      } else {
        // OpenAI-compatible: GET /models
        const headers = { 'Content-Type': 'application/json' };
        if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
        const res = await fetch(`${provider.baseUrl}/models`, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Some APIs return { data: [...] }, others return { models: [...] }
        const rawModels = data.data || data.models || [];
        const models = rawModels.map(m => m.id || m.name).filter(Boolean);
        return { ok: true, reason: null, models };
      }
    } catch (err) {
      const reason = err?.name === 'AbortError' ? 'timeout' : 'offline';
      return { ok: false, reason, models: [] };
    } finally {
      clearTimeout(timeoutId);
    }
  },

  // ── Translation ──────────────────────────────────────────────────────────

  /**
   * Translate `text` into `targetLangCode` using the active provider/model.
   * Returns { ok: boolean, text: string, reason: string | null }
   */
  async translate(text, targetLangCode, langNameHint) {
    const sourceText = (text || '').trim();
    if (!sourceText) return { ok: false, reason: 'empty', text: '' };
    if (!targetLangCode || targetLangCode === 'none') {
      return { ok: false, reason: 'disabled', text: sourceText };
    }

    const { provider, modelName } = AIProviderManager.getActiveConfig();
    if (!provider || !modelName) {
      return { ok: false, reason: 'not-configured', text: '' };
    }

    const targetLangName = langNameHint || targetLangCode;
    const prompt = `Translate the following mobile app feature title into ${targetLangName}. Keep it concise, marketing style. Only output the ${targetLangName} text, no explanations. Text: "${sourceText}"`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

    try {
      let translatedText = '';

      if (provider.type === 'ollama') {
        // Ollama generate API
        const res = await fetch(`${provider.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: modelName, prompt, stream: false }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        translatedText = (data.response || '').trim().replace(/^"|"$/g, '');
      } else {
        // OpenAI-compatible chat completions
        const headers = { 'Content-Type': 'application/json' };
        if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
        const res = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        translatedText = (
          data?.choices?.[0]?.message?.content || ''
        ).trim().replace(/^"|"$/g, '');
      }

      if (!translatedText) {
        return { ok: false, reason: 'empty-response', text: '' };
      }
      return { ok: true, reason: null, text: translatedText };
    } catch (err) {
      const reason = err?.name === 'AbortError' ? 'timeout' : 'error';
      return { ok: false, reason, text: '' };
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

export default AIProviderManager;
