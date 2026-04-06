#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function findTsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

const srcDir = path.join(__dirname, "..", "src");
const files = findTsFiles(srcDir);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf-8");
  const relPath = path.relative(srcDir, file).replace(/\\/g, "/");

  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  let match;

  if (relPath.startsWith("core/")) {
    importPattern.lastIndex = 0;
    while ((match = importPattern.exec(content)) !== null) {
      const imp = match[1];
      if (imp.includes("../brokers") || imp.includes("../runtime")) {
        violations.push(
          `${relPath}: imports '${imp}' (core must not depend on brokers/runtime)`
        );
      }
    }
  }

  if (relPath.startsWith("models/")) {
    importPattern.lastIndex = 0;
    while ((match = importPattern.exec(content)) !== null) {
      const imp = match[1];
      if (imp.includes("../core") || imp === "./core") {
        violations.push(
          `${relPath}: imports '${imp}' (models must not depend on core)`
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Boundary violations found:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
} else {
  console.log("No boundary violations found.");
  process.exit(0);
}
