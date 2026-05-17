#!/usr/bin/env node
/**
 * Import boundary checker for OpenClaw Secure.
 *
 * Enforces the package boundaries defined in ARCHITECTURE.md §2:
 *
 *   - src/core/policy.ts must not import from gateway, session, audit,
 *     broker, agent, workers/*, or plugins/*.
 *   - src/core/types.ts must not import anything (zero-dependency contract).
 *   - src/workers/* must not import gateway, session, audit, or policy.
 *   - src/channels/* must not import workers/* or broker directly.
 *   - src/plugins/* must not import any core runtime packages.
 *
 * Exit code 0 = all boundaries respected.
 * Exit code 1 = one or more violations found.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'src');

let violations = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readLines(filePath) {
  return readFileSync(filePath, 'utf-8').split('\n');
}

/** Return all import/require targets in a file. */
function extractImports(filePath) {
  const lines = readLines(filePath);
  const targets = [];
  for (const line of lines) {
    const m =
      line.match(/^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/u) ??
      line.match(/^\s*(?:const|let|var)\s+.*?=\s*require\(['"]([^'"]+)['"]\)/u);
    if (m) targets.push(m[1]);
  }
  return targets;
}

function violation(file, target, reason) {
  const rel = relative(ROOT, file);
  console.error(`BOUNDARY VIOLATION: ${rel}\n  imports "${target}"\n  reason: ${reason}\n`);
  violations++;
}

/** Walk a directory and return all .ts files. */
function walkTs(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...walkTs(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) results.push(full);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

/**
 * Each rule: { files: glob-like selector, forbidden: string[] of import substrings }
 */
const RULES = [
  {
    label: 'core/policy.ts must not import runtime modules',
    files: [join(SRC, 'core', 'policy.ts')],
    forbidden: [
      'gateway',
      'session',
      'audit',
      'broker',
      'agent',
      '../workers',
      '../plugins',
      'policy-store',
      'artifacts',
      'replay',
      'memory',
      'approval',
    ],
  },
  {
    label: 'core/types.ts must have zero imports',
    files: [join(SRC, 'core', 'types.ts')],
    forbidden: ['.'], // any relative import is forbidden
  },
  {
    label: 'workers/* must not import gateway, session, audit, or policy',
    files: walkTs(join(SRC, 'workers')),
    forbidden: ['core/gateway', 'core/session', 'core/audit', 'core/policy'],
  },
  {
    label: 'channels/* must not import workers or invoke broker directly',
    files: walkTs(join(SRC, 'channels')),
    forbidden: ['../workers', '../core/broker'],
  },
  {
    label: 'plugins/* must not import core runtime packages',
    files: walkTs(join(SRC, 'plugins')),
    forbidden: ['core/broker', 'core/agent', 'core/gateway', 'core/audit', 'core/session'],
  },
];

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

for (const rule of RULES) {
  for (const filePath of rule.files) {
    let imports;
    try {
      imports = extractImports(filePath);
    } catch {
      continue; // file may not exist in all configs
    }

    for (const target of imports) {
      for (const forbidden of rule.forbidden) {
        if (target.includes(forbidden)) {
          violation(filePath, target, rule.label);
        }
      }
    }
  }
}

if (violations === 0) {
  console.log('✓ All import boundaries respected.');
  process.exit(0);
} else {
  console.error(`✗ ${violations} import boundary violation(s) found.`);
  process.exit(1);
}
