const {
  createConnection,
  createProvider,
  loadProgram,
  loadKeypair,
  getProgramId,
  findProtocolConfig,
} = require("./common");
const { RandomGenerator } = require("./random");

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
}

module.exports = { SessionState };
