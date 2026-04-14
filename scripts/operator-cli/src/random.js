const {
  MARKET_TYPE_BINARY,
  MARKET_TYPE_MULTI,
  MARKET_TYPE_CONTINUOUS,
  ROLE_ORACLE,
  ROLE_CREATOR,
} = require("./common");

class RandomGenerator {
  userLabel(index) {
    const adjectives = ["Swift", "Bold", "Lucky", "Sharp", "Clever", "Quick", "Wild", "Calm"];
    const nouns = ["Trader", "Whale", "Bull", "Bear", "Fox", "Hawk", "Wolf", "Lion"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj}${noun}${index}`;
  }

  liquidity() {
    return String(50 + Math.floor(Math.random() * 451)); // 50-500
  }

  fundAmount() {
    return String(50 + Math.floor(Math.random() * 451)); // 50-500
  }

  deadline() {
    const minutes = 30 + Math.floor(Math.random() * (24 * 60 - 30));
    if (minutes >= 60) return `+${Math.floor(minutes / 60)}h`;
    return `+${minutes}m`;
  }

  marketType() {
    const types = [MARKET_TYPE_BINARY, MARKET_TYPE_MULTI, MARKET_TYPE_CONTINUOUS];
    return types[Math.floor(Math.random() * types.length)];
  }

  numOutcomes(marketType) {
    if (marketType === MARKET_TYPE_BINARY) return "2";
    if (marketType === MARKET_TYPE_MULTI) return String(3 + Math.floor(Math.random() * 6)); // 3-8
    // continuous
    const bins = [16, 32, 64];
    return String(bins[Math.floor(Math.random() * bins.length)]);
  }

  rangeValues() {
    const min = 10 + Math.floor(Math.random() * 91); // 10-100
    const spread = 100 + Math.floor(Math.random() * 901); // 100-1000
    return { min: String(min), max: String(min + spread) };
  }

  tradeAmount() {
    return String(5 + Math.floor(Math.random() * 26)); // 5-30
  }

  outcome(numOutcomes) {
    return Math.floor(Math.random() * numOutcomes);
  }

  targetProbability() {
    const target = 10 + Math.floor(Math.random() * 81); // 10-90%
    return String(target);
  }

  mu(rangeMin, rangeMax) {
    const spread = rangeMax - rangeMin;
    const mu = rangeMin + spread * 0.2 + Math.floor(Math.random() * (spread * 0.6 + 1));
    return mu.toFixed(1);
  }

  sigma(rangeMin, rangeMax) {
    const spread = rangeMax - rangeMin;
    const pct = 5 + Math.floor(Math.random() * 26); // 5-30%
    const sigma = (spread * pct) / 100;
    return sigma.toFixed(1);
  }

  resolveOutcome(numOutcomes) {
    return Math.floor(Math.random() * numOutcomes);
  }

  resolveValue(rangeMin, rangeMax) {
    const spread = rangeMax - rangeMin;
    const value = rangeMin + spread * 0.1 + Math.floor(Math.random() * (spread * 0.8 + 1));
    return value.toFixed(1);
  }

  role() {
    const roles = [ROLE_ORACLE, ROLE_CREATOR];
    return roles[Math.floor(Math.random() * roles.length)];
  }
}

module.exports = { RandomGenerator };
