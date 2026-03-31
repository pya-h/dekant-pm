const { writeFileSync, readFileSync, existsSync, appendFileSync } = require("fs");
const { resolve } = require("path");
const {
  createConnection,
  createProvider,
  loadProgram,
  loadKeypair,
  getProgramId,
  findProtocolConfig,
  Keypair,
  PublicKey,
} = require("./common");
const { RandomGenerator } = require("./random");

// Session file path (in scripts/.state/)
const SESSION_PATH = resolve(__dirname, "../../.state/operator-session.json");
const LOG_PATH = resolve(__dirname, "../../.state/operator-cli.log");

class SessionState {
  constructor() {
    this.users = [];
    this.markets = [];
    this.randomMode = false;
    this.rand = new RandomGenerator();
    this.connection = createConnection();
    const keypair = loadKeypair();
    this.superuser = { keypair, pubkey: keypair.publicKey };
    this.programId = getProgramId();
    const provider = createProvider(this.connection, keypair);
    this._superProgram = loadProgram(provider);
  }

  get superProgram() {
    return this._superProgram;
  }

  /** Create a Program instance that signs with the given keypair. */
  programForUser(keypair) {
    const provider = createProvider(this.connection, keypair);
    return loadProgram(provider);
  }

  /** Verify that the protocol is initialized. */
  async verifyProtocol() {
    const [protocolConfig] = findProtocolConfig(this.programId);
    try {
      await this._superProgram.account.protocolConfig.fetch(protocolConfig);
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      // Anchor throws "Account does not exist or has no data" when the PDA is absent.
      // Any other message is a connection/RPC problem — show it verbatim so it's diagnosable.
      if (
        msg.includes("Account does not exist") ||
        msg.includes("could not find account") ||
        msg.includes("has no data")
      ) {
        throw new Error(
          "Protocol not initialized. Run: cd devkit && npx ts-node src/setup.ts init"
        );
      }
      throw new Error(
        `RPC connection error (check that the validator is running and RPC_URL is correct): ${msg}`
      );
    }
  }

  nextUserLabel() {
    return `User ${this.users.length + 1}`;
  }

  findUser(pubkey) {
    return this.users.find((u) => u.pubkey.equals(pubkey));
  }

  saveSession() {
    const data = {
      users: this.users.map((u) => ({
        label: u.label,
        secretKey: Array.from(u.keypair.secretKey),
        roles: u.roles,
      })),
      markets: this.markets.map((m) => ({
        id: typeof m.id === "object" ? m.id.toString() : m.id,
        label: m.label,
        type: m.type,
        mint: m.mint.toBase58(),
        mintLabel: m.mintLabel || "",
        oracle: m.oracle.toBase58(),
        numOutcomes: m.numOutcomes,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      })),
    };
    try {
      writeFileSync(SESSION_PATH, JSON.stringify(data, null, 2));
    } catch {
      // Silently fail — non-critical
    }
  }

  loadSession() {
    if (!existsSync(SESSION_PATH)) return false;
    try {
      const raw = JSON.parse(readFileSync(SESSION_PATH, "utf-8"));
      this.users = (raw.users || []).map((u) => {
        const keypair = Keypair.fromSecretKey(Uint8Array.from(u.secretKey));
        return {
          label: u.label,
          keypair,
          pubkey: keypair.publicKey,
          roles: u.roles || [],
        };
      });
      this.markets = (raw.markets || []).map((m) => ({
        id: m.id,
        label: m.label,
        type: m.type,
        mint: new PublicKey(m.mint),
        mintLabel: m.mintLabel || "",
        oracle: new PublicKey(m.oracle),
        numOutcomes: m.numOutcomes,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      }));
      return true;
    } catch {
      return false;
    }
  }

  /** Log an error to the persistent log file. */
  logError(action, err) {
    const msg = err && err.message ? err.message : String(err);
    const line = `[${new Date().toISOString()}] [ERROR] ${action}: ${msg}\n`;
    try {
      appendFileSync(LOG_PATH, line);
    } catch {
      // non-critical
    }
  }

  /** Log an info entry to the persistent log file. */
  logInfo(action, detail) {
    const line = `[${new Date().toISOString()}] [INFO]  ${action}: ${detail}\n`;
    try {
      appendFileSync(LOG_PATH, line);
    } catch {
      // non-critical
    }
  }

  static hasSavedSession() {
    return existsSync(SESSION_PATH);
  }
}

module.exports = { SessionState };
