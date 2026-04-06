/**
 * Plugin manifest validation for OpenClaw Secure.
 *
 * Plugins must declare:
 *   - manifest (id, name, version, description)
 *   - declared capabilities
 *   - declared network domains
 *   - declared secret needs
 *   - execution mode
 *   - package hash (for pinning/signing)
 *   - risk class (A-F) for broker-mediated enforcement
 *
 * Plugins run in isolated processes or containers by default.
 * 'in_process_trusted' is the break-glass mode and requires explicit review.
 */

import { z } from 'zod';
import { PluginManifest, PluginState } from '../core/types';

// ---------------------------------------------------------------------------
// Zod schema for manifest validation
// ---------------------------------------------------------------------------

export const PluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  capabilities: z.array(z.string()),
  allowedNetworkDomains: z.array(z.string()),
  declaredSecretNeeds: z.array(z.string()),
  executionMode: z.enum(['isolated_process', 'container', 'in_process_trusted']),
  packageHash: z.string().min(1),
  pinnedVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  installedAt: z.string(),
  reviewedAt: z.string().optional(),
  riskClass: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
  state: z.enum(['installed', 'enabled', 'disabled']).optional(),
});

export type ValidatedPluginManifest = z.infer<typeof PluginManifestSchema>;

// ---------------------------------------------------------------------------
// Version compatibility
// ---------------------------------------------------------------------------

/**
 * Parse a semver string into [major, minor, patch].
 * Returns undefined if parsing fails.
 */
function parseSemver(v: string): [number, number, number] | undefined {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return undefined;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * Returns true if `incoming` is compatible with `existing`.
 * Compatibility: same major, incoming minor >= existing minor.
 */
export function isVersionCompatible(existing: string, incoming: string): boolean {
  const e = parseSemver(existing);
  const i = parseSemver(incoming);
  if (!e || !i) return false;
  if (e[0] !== i[0]) return false;  // major version mismatch = breaking
  return i[1] >= e[1];
}

// ---------------------------------------------------------------------------
// Plugin registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private manifests: Map<string, PluginManifest> = new Map();

  /**
   * Register a plugin manifest after validation.
   * Throws if the manifest fails schema validation.
   * Warns (does not throw) if execution mode is 'in_process_trusted'.
   * If a plugin with the same id exists, performs a version compatibility check.
   */
  register(raw: unknown): PluginManifest {
    const result = PluginManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid plugin manifest: ${result.error.message}`);
    }
    const manifest = result.data as PluginManifest;

    // Version compatibility check against existing registration
    const existing = this.manifests.get(manifest.id);
    if (existing && !isVersionCompatible(existing.version, manifest.version)) {
      throw new Error(
        `Version incompatibility: existing=${existing.version}, incoming=${manifest.version}. ` +
        'Major version change is a breaking change.'
      );
    }

    if (manifest.executionMode === 'in_process_trusted') {
      // Break-glass mode — log a warning
      console.warn(
        `[PluginRegistry] WARNING: Plugin "${manifest.id}" uses in_process_trusted execution mode. ` +
          'This is a break-glass setting and requires explicit review.'
      );
    }

    const installed: PluginManifest = { ...manifest, state: manifest.state ?? 'installed' };
    this.manifests.set(installed.id, installed);
    return installed;
  }

  get(id: string): PluginManifest | undefined {
    return this.manifests.get(id);
  }

  list(): PluginManifest[] {
    return Array.from(this.manifests.values());
  }

  unregister(id: string): void {
    this.manifests.delete(id);
  }

  /**
   * Enable a registered plugin.
   * Returns the updated manifest, or undefined if not found.
   */
  enable(id: string): PluginManifest | undefined {
    const m = this.manifests.get(id);
    if (!m) return undefined;
    const updated: PluginManifest = { ...m, state: 'enabled' as PluginState };
    this.manifests.set(id, updated);
    return updated;
  }

  /**
   * Disable a registered plugin.
   * Returns the updated manifest, or undefined if not found.
   */
  disable(id: string): PluginManifest | undefined {
    const m = this.manifests.get(id);
    if (!m) return undefined;
    const updated: PluginManifest = { ...m, state: 'disabled' as PluginState };
    this.manifests.set(id, updated);
    return updated;
  }

  /**
   * Remove a plugin entirely (safe removal).
   * Returns true if the plugin was found and removed.
   */
  remove(id: string): boolean {
    return this.manifests.delete(id);
  }

  /**
   * Check whether a plugin is allowed to access a given network domain.
   */
  canAccessDomain(pluginId: string, domain: string): boolean {
    const manifest = this.manifests.get(pluginId);
    if (!manifest) return false;
    return manifest.allowedNetworkDomains.includes(domain);
  }

  /**
   * Check whether a plugin is allowed to access a given secret.
   */
  canAccessSecret(pluginId: string, secretName: string): boolean {
    const manifest = this.manifests.get(pluginId);
    if (!manifest) return false;
    return manifest.declaredSecretNeeds.includes(secretName);
  }
}
