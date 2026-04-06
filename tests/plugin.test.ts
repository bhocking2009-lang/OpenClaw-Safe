/**
 * Tests for the plugin registry.
 */

import { PluginRegistry } from '../src/plugins/registry';

const VALID_MANIFEST = {
  id: 'plugin-search',
  name: 'Web Search Plugin',
  version: '1.0.0',
  description: 'Provides web search capabilities',
  capabilities: ['web_search'],
  allowedNetworkDomains: ['api.example.com'],
  declaredSecretNeeds: ['SEARCH_API_KEY'],
  executionMode: 'isolated_process' as const,
  packageHash: 'sha256:abc123def456',
  pinnedVersion: '1.0.0',
  installedAt: new Date().toISOString(),
  riskClass: 'C' as const,
};

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('registers a valid manifest', () => {
    const manifest = registry.register(VALID_MANIFEST);
    expect(manifest.id).toBe('plugin-search');
    expect(registry.get('plugin-search')).toEqual(manifest);
  });

  it('lists registered plugins', () => {
    registry.register(VALID_MANIFEST);
    registry.register({ ...VALID_MANIFEST, id: 'plugin-2', name: 'Plugin 2' });
    expect(registry.list()).toHaveLength(2);
  });

  it('unregisters a plugin', () => {
    registry.register(VALID_MANIFEST);
    registry.unregister('plugin-search');
    expect(registry.get('plugin-search')).toBeUndefined();
  });

  it('rejects invalid manifest (missing required fields)', () => {
    expect(() => registry.register({ id: '', name: '' })).toThrow();
  });

  it('rejects invalid version format', () => {
    expect(() => registry.register({ ...VALID_MANIFEST, version: 'invalid' })).toThrow();
  });

  it('warns on in_process_trusted execution mode', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register({ ...VALID_MANIFEST, executionMode: 'in_process_trusted' });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('in_process_trusted'));
    consoleSpy.mockRestore();
  });

  it('checks domain access', () => {
    registry.register(VALID_MANIFEST);
    expect(registry.canAccessDomain('plugin-search', 'api.example.com')).toBe(true);
    expect(registry.canAccessDomain('plugin-search', 'evil.example.com')).toBe(false);
    expect(registry.canAccessDomain('nonexistent', 'api.example.com')).toBe(false);
  });

  it('checks secret access', () => {
    registry.register(VALID_MANIFEST);
    expect(registry.canAccessSecret('plugin-search', 'SEARCH_API_KEY')).toBe(true);
    expect(registry.canAccessSecret('plugin-search', 'OTHER_SECRET')).toBe(false);
    expect(registry.canAccessSecret('nonexistent', 'SEARCH_API_KEY')).toBe(false);
  });

  it('returns undefined for unknown plugin id', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});
