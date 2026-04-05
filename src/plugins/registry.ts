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
 *
 * Plugins run in isolated processes or containers by default.
 * 'in_process_trusted' is the break-glass mode and requires explicit review.
 */

import { z } from 'zod';
import { PluginManifest } from '../core/types';

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
});

export type ValidatedPluginManifest = z.infer<typeof PluginManifestSchema>;

// ---------------------------------------------------------------------------
// Plugin registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private manifests: Map<string, PluginManifest> = new Map();

  /**
   * Register a plugin manifest after validation.
   * Throws if the manifest fails schema validation.
   * Warns (does not throw) if execution mode is 'in_process_trusted'.
   */
  register(raw: unknown): PluginManifest {
    const result = PluginManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid plugin manifest: ${result.error.message}`);
    }
    const manifest = result.data as PluginManifest;
    if (manifest.executionMode === 'in_process_trusted') {
      // Break-glass mode — log a warning
      console.warn(
        `[PluginRegistry] WARNING: Plugin "${manifest.id}" uses in_process_trusted execution mode. ` +
          'This is a break-glass setting and requires explicit review.'
      );
    }
    this.manifests.set(manifest.id, manifest);
    return manifest;
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
