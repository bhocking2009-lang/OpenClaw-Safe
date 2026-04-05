"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskLevel = void 0;
exports.createCapabilityManifest = createCapabilityManifest;
exports.addCapability = addCapability;
exports.getCapability = getCapability;
exports.maxRiskLevel = maxRiskLevel;
var RiskLevel;
(function (RiskLevel) {
    RiskLevel["LOW"] = "low";
    RiskLevel["MEDIUM"] = "medium";
    RiskLevel["HIGH"] = "high";
    RiskLevel["CRITICAL"] = "critical";
})(RiskLevel || (exports.RiskLevel = RiskLevel = {}));
const RISK_ORDER = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];
function createCapabilityManifest(pluginName, version) {
    return { pluginName, version, capabilities: [] };
}
function addCapability(manifest, cap) {
    manifest.capabilities.push(cap);
}
function getCapability(manifest, name) {
    return manifest.capabilities.find((c) => c.name === name);
}
function maxRiskLevel(manifest) {
    if (manifest.capabilities.length === 0)
        return RiskLevel.LOW;
    const maxIdx = Math.max(...manifest.capabilities.map((c) => RISK_ORDER.indexOf(c.riskLevel)));
    return RISK_ORDER[maxIdx];
}
//# sourceMappingURL=capability_manifest.js.map