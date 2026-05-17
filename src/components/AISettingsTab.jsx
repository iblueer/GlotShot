import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, RefreshCw, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { AIProviderManager } from '../services/AIProviderManager';

const PROVIDER_TYPES = [
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'ollama', label: 'Ollama (Local)' },
];

const defaultForm = () => ({
  name: '',
  type: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  models: [],
  modelInput: '',
});

function ProviderForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    ...defaultForm(),
    ...(initial || {}),
    modelInput: '',
  }));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, reason, models }

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const addModel = () => {
    const m = form.modelInput.trim();
    if (!m || form.models.includes(m)) return;
    set('models', [...form.models, m]);
    set('modelInput', '');
  };

  const removeModel = (m) => set('models', form.models.filter(x => x !== m));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await AIProviderManager.testConnection({
      type: form.type,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
    });
    setTestResult(result);
    // If test returns model list, offer to import them
    setTesting(false);
  };

  const importModels = () => {
    if (!testResult?.models?.length) return;
    const merged = [...new Set([...form.models, ...testResult.models])];
    set('models', merged);
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    onSave({
      name: form.name.trim(),
      type: form.type,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey,
      models: form.models,
    });
  };

  return (
    <div className="ai-provider-form">
      <div className="form-row">
        <label className="form-label-sm">名称</label>
        <input
          className="form-input-sm"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="My Provider"
        />
      </div>

      <div className="form-row">
        <label className="form-label-sm">类型</label>
        <select
          className="form-input-sm"
          value={form.type}
          onChange={e => set('type', e.target.value)}
        >
          {PROVIDER_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <label className="form-label-sm">
          {form.type === 'ollama' ? 'Ollama Host' : 'Base URL'}
        </label>
        <input
          className="form-input-sm"
          value={form.baseUrl}
          onChange={e => set('baseUrl', e.target.value)}
          placeholder={form.type === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
        />
      </div>

      {form.type !== 'ollama' && (
        <div className="form-row">
          <label className="form-label-sm">API Key</label>
          <input
            className="form-input-sm"
            type="password"
            value={form.apiKey}
            onChange={e => set('apiKey', e.target.value)}
            placeholder="sk-..."
            autoComplete="new-password"
          />
        </div>
      )}

      {/* Test connection */}
      <div className="ai-form-test-row">
        <button
          className="ai-test-btn"
          onClick={handleTest}
          disabled={testing || !form.baseUrl.trim()}
        >
          <RefreshCw className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`} />
          {testing ? '测试中...' : '测试连接'}
        </button>
        {testResult && (
          <span className={`ai-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
            {testResult.ok
              ? `✓ 已连通${testResult.models?.length ? `，发现 ${testResult.models.length} 个模型` : ''}`
              : `✗ 连接失败（${testResult.reason}）`}
          </span>
        )}
        {testResult?.ok && testResult.models?.length > 0 && (
          <button className="ai-import-models-btn" onClick={importModels}>
            导入模型列表
          </button>
        )}
      </div>

      {/* Models */}
      <div className="form-row" style={{ flexDirection: 'column', gap: '6px' }}>
        <label className="form-label-sm">支持的模型</label>
        <div className="ai-model-input-row">
          <input
            className="form-input-sm"
            value={form.modelInput}
            onChange={e => set('modelInput', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addModel()}
            placeholder="输入模型名称，按 Enter 添加"
          />
          <button className="ai-add-model-btn" onClick={addModel} disabled={!form.modelInput.trim()}>
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {form.models.length > 0 && (
          <div className="ai-model-tags">
            {form.models.map(m => (
              <span key={m} className="ai-model-tag">
                {m}
                <button onClick={() => removeModel(m)}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ai-form-actions">
        <button className="ai-save-btn" onClick={handleSave} disabled={!form.name.trim() || !form.baseUrl.trim()}>
          <Check className="w-3.5 h-3.5" /> 保存
        </button>
        <button className="ai-cancel-btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export default function AISettingsTab() {
  const [config, setConfig] = useState(() => AIProviderManager.getConfig());
  const [editingId, setEditingId] = useState(null); // provider id being edited, or 'new'
  const [expandedId, setExpandedId] = useState(null);
  const [testingActive, setTestingActive] = useState(false);
  const [activeTestResult, setActiveTestResult] = useState(null);

  const refresh = useCallback(() => setConfig(AIProviderManager.getConfig()), []);

  useEffect(() => AIProviderManager.onChange(refresh), [refresh]);

  const { providers, activeProviderId, activeModelName } = config;
  const activeProvider = providers.find(p => p.id === activeProviderId) ?? null;

  const handleSaveNew = (fields) => {
    AIProviderManager.addProvider(fields);
    setEditingId(null);
  };

  const handleSaveEdit = (id, fields) => {
    AIProviderManager.updateProvider(id, fields);
    setEditingId(null);
  };

  const handleDelete = (id) => {
    AIProviderManager.removeProvider(id);
    if (expandedId === id) setExpandedId(null);
  };

  const handleSetActive = (providerId, modelName) => {
    AIProviderManager.setActive(providerId, modelName);
  };

  const handleTestActive = async () => {
    if (!activeProvider) return;
    setTestingActive(true);
    setActiveTestResult(null);
    const result = await AIProviderManager.testConnection(activeProvider);
    setActiveTestResult(result);
    setTestingActive(false);
  };

  return (
    <div className="ai-settings-tab">
      {/* ── Current active model status ── */}
      <div className="ai-status-card">
        <div className="ai-status-card-header">
          <Zap className="w-4 h-4" style={{ color: 'var(--settings-accent)' }} />
          <span className="ai-status-title">当前生效模型</span>
        </div>

        {activeProvider && activeModelName ? (
          <div className="ai-status-body">
            <div className="ai-status-row">
              <span className="ai-status-label">Provider</span>
              <span className="ai-status-value">{activeProvider.name}</span>
            </div>
            <div className="ai-status-row">
              <span className="ai-status-label">Model</span>
              <span className="ai-status-value">{activeModelName}</span>
            </div>
            <div className="ai-status-row">
              <span className="ai-status-label">状态</span>
              <div className="ai-status-conn">
                {activeTestResult ? (
                  <span className={`ai-conn-badge ${activeTestResult.ok ? 'ok' : 'fail'}`}>
                    <span className="ai-conn-dot" />
                    {activeTestResult.ok ? '已连通' : '连接失败'}
                  </span>
                ) : (
                  <span className="ai-conn-badge unknown">
                    <span className="ai-conn-dot" />
                    未测试
                  </span>
                )}
                <button
                  className="ai-test-conn-btn"
                  onClick={handleTestActive}
                  disabled={testingActive}
                >
                  <RefreshCw className={`w-3 h-3 ${testingActive ? 'animate-spin' : ''}`} />
                  {testingActive ? '测试中' : '测试连接'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="ai-status-empty">
            尚未选择 Provider 和模型，请在下方配置后选择。
          </div>
        )}
      </div>

      {/* ── Provider list ── */}
      <div className="ai-section-header">
        <span className="ai-section-title">AI Provider</span>
        {editingId !== 'new' && (
          <button className="ai-add-provider-btn" onClick={() => setEditingId('new')}>
            <Plus className="w-3.5 h-3.5" /> 添加
          </button>
        )}
      </div>

      {/* New provider form */}
      {editingId === 'new' && (
        <div className="ai-provider-card editing">
          <ProviderForm
            onSave={handleSaveNew}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      {/* Existing providers */}
      {providers.length === 0 && editingId !== 'new' && (
        <div className="ai-empty-hint">暂无 Provider，点击「添加」创建第一个。</div>
      )}

      {providers.map(provider => {
        const isActive = provider.id === activeProviderId;
        const isExpanded = expandedId === provider.id;
        const isEditing = editingId === provider.id;

        return (
          <div
            key={provider.id}
            className={`ai-provider-card ${isActive ? 'active' : ''}`}
          >
            {/* Header row */}
            <div className="ai-provider-header" onClick={() => setExpandedId(isExpanded ? null : provider.id)}>
              <div className="ai-provider-info">
                <span className="ai-provider-name">{provider.name}</span>
                <span className="ai-provider-type-badge">
                  {provider.type === 'ollama' ? 'Ollama' : 'OpenAI Compatible'}
                </span>
                {isActive && activeModelName && (
                  <span className="ai-active-badge">
                    ✓ {activeModelName}
                  </span>
                )}
              </div>
              <div className="ai-provider-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="ai-action-btn edit"
                  title="编辑"
                  onClick={() => setEditingId(isEditing ? null : provider.id)}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  className="ai-action-btn delete"
                  title="删除"
                  onClick={() => handleDelete(provider.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {isExpanded
                  ? <ChevronDown className="w-3.5 h-3.5 text-[var(--settings-text-muted)]" />
                  : <ChevronRight className="w-3.5 h-3.5 text-[var(--settings-text-muted)]" />
                }
              </div>
            </div>

            {/* Edit form */}
            {isEditing && (
              <ProviderForm
                initial={provider}
                onSave={(fields) => handleSaveEdit(provider.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            )}

            {/* Expanded: model selection */}
            {isExpanded && !isEditing && (
              <div className="ai-model-select-panel">
                <div className="ai-model-select-title">选择生效模型</div>
                {provider.models.length === 0 ? (
                  <div className="ai-model-empty">此 Provider 尚未配置模型，请编辑后添加。</div>
                ) : (
                  <div className="ai-model-list">
                    {provider.models.map(m => {
                      const isActiveModel = isActive && activeModelName === m;
                      return (
                        <button
                          key={m}
                          className={`ai-model-option ${isActiveModel ? 'active' : ''}`}
                          onClick={() => handleSetActive(provider.id, m)}
                        >
                          {isActiveModel && <Check className="w-3 h-3" />}
                          {m}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
