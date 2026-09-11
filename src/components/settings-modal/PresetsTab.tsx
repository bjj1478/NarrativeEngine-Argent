import { useState } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { AIPreset, SamplingConfig } from '../../types';
import { uid } from '../../utils/uid';
import { SamplingPanel } from '../SamplingPanel';
import { PROVIDER_ROLES, findUnassignedRequiredRoles } from '../../services/providerRoles';

export function PresetsTab() {
  const { settings, addPreset, updatePreset, removePreset } = useAppStore();
  const [activeTab, setActiveTab] = useState(settings.presets[0]?.id || '');

  const activePreset = settings.presets.find((p) => p.id === activeTab) || settings.presets[0];
  const unassignedRequired = findUnassignedRequiredRoles(activePreset, settings.providers);

  const handleAddPreset = () => {
    const firstProviderId = settings.providers[0]?.id || '';
    const newPreset: AIPreset = {
      id: uid(),
      name: `Preset ${settings.presets.length + 1}`,
      // Required slots seed from the first provider so a new preset is runnable
      // immediately; optional slots stay unset, disabling their feature.
      ...Object.fromEntries(
        PROVIDER_ROLES.map(role => [role.presetField, role.required ? firstProviderId : '']),
      ),
      storyAIProviderId: firstProviderId,
    };
    addPreset(newPreset);
    setActiveTab(newPreset.id);
  };

  const handleDuplicatePreset = () => {
    if (!activePreset) return;
    const duplicated: AIPreset = {
      ...activePreset,
      id: uid(),
      name: `${activePreset.name} (copy)`,
    };
    addPreset(duplicated);
    setActiveTab(duplicated.id);
  };

  const handleRemovePreset = (id: string) => {
    if (settings.presets.length <= 1) return;
    removePreset(id);
    const updatedPresets = useAppStore.getState().settings.presets;
    setActiveTab(updatedPresets[0]?.id || '');
  };

  const handleUpdatePresetName = (name: string) => {
    if (!activePreset) return;
    updatePreset(activePreset.id, { name });
  };

  return (
    <>
      {/* ─── Preset Tabs ─── */}
      <div className="flex flex-col mb-6">
        <label className="text-text-dim text-xs uppercase tracking-widest mb-2 font-bold">AI Presets</label>
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-px">
          {settings.presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveTab(p.id)}
              className={`px-3 py-2 text-[11px] uppercase tracking-wider whitespace-nowrap transition-all border-b-2 -mb-px ${activeTab === p.id
                ? 'text-terminal border-terminal bg-terminal/5 font-bold'
                : 'text-text-dim border-transparent hover:text-text-primary hover:border-border'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={handleAddPreset}
            className="px-3 py-2 text-text-dim hover:text-terminal transition-colors -mb-px border-b-2 border-transparent"
            title="Add Preset"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* ─── Active Preset Config ─── */}
      {activePreset && (
        <div className="mb-8 animate-in fade-in duration-200">
          <div className="flex gap-2 items-end mb-6">
            <div className="flex-1">
              <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1">Preset Name</label>
              <input
                type="text"
                value={activePreset.name}
                onChange={(e) => handleUpdatePresetName(e.target.value)}
                className="w-full bg-void border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/40 font-bold focus:border-terminal focus:outline-none"
                placeholder="e.g. Local Heavy"
              />
            </div>
            <button
              onClick={handleDuplicatePreset}
              className="bg-void border border-border text-text-dim hover:text-terminal hover:border-terminal transition-colors px-3 py-2"
              title="Duplicate preset"
            >
              <Copy size={16} />
            </button>
            {settings.presets.length > 1 && (
              <button
                onClick={() => handleRemovePreset(activePreset.id)}
                className="bg-void border border-danger/40 hover:border-danger text-danger px-4 py-2 hover:bg-danger/10 transition-all flex border-dashed focus:outline-none"
                title="Delete this preset"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          {/* ─── Provider dropdowns ─── */}
          {/* Rendered from PROVIDER_ROLES (services/providerRoles.ts) rather than
              hand-written per slot — the slot list used to be repeated in nine places,
              which is how the Director ended up on a dropdown labelled "NPC
              Classification". Story spans every column to keep the * marker readable;
              the rest flow two-up, three-up on a full-stretch pane. */}
          {unassignedRequired.length > 0 && (
            <div className="mb-4 border border-error/60 bg-error/10 px-3 py-2 text-[11px] text-error">
              <span className="font-semibold">Assign a model to every required slot.</span>{' '}
              Unassigned: {unassignedRequired.map(role => role.label).join(', ')}. Roles never
              borrow each other&apos;s models, so a turn will stop rather than quietly use the
              wrong one. Pointing several slots at the same provider is fine.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 md:gap-4 space-y-4 md:space-y-0 mb-6">
            {PROVIDER_ROLES.map(role => {
              const value = activePreset[role.presetField] || '';
              const missing = role.required && !settings.providers.some(p => p.id === value);
              return (
                <div key={role.key} className={role.key === 'story' ? 'md:col-span-2 xl:col-span-3' : undefined}>
                  <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1">
                    {role.label}
                    {role.required && <span className="text-terminal"> *</span>}
                  </label>
                  <select
                    value={value}
                    onChange={(e) => updatePreset(activePreset.id, { [role.presetField]: e.target.value })}
                    className={`w-full bg-surface border px-3 py-2 text-sm text-text-primary focus:border-terminal focus:outline-none appearance-none ${missing ? 'border-error' : 'border-border'}`}
                  >
                    {/* Required slots offer no empty choice — there is nothing to fall back to. */}
                    {!role.required && <option value="">None</option>}
                    {role.required && !value && <option value="">— select a model —</option>}
                    {settings.providers.map(p => (
                      <option key={p.id} value={p.id}>{p.label || p.modelName || p.endpoint}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-text-dim">{role.description}</p>
                </div>
              );
            })}
          </div>

          <SamplingPanel
            preset={activePreset}
            onUpdate={(sampling: SamplingConfig) => updatePreset(activePreset.id, { sampling })}
          />
        </div>
      )}
    </>
  );
}