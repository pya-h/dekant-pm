import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  deriveProtocolConfig,
  deriveUserRole,
  deriveMarket,
  deriveVaultAuthority,
  deriveUserPosition,
  deriveLpPosition,
} from './pda';

const PROGRAM_ID = new PublicKey('Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf');
const DUMMY_USER = PublicKey.unique();
const DUMMY_MARKET = PublicKey.unique();

describe('PDA derivation helpers', () => {
  describe('deriveProtocolConfig', () => {
    it('should return a valid PublicKey and bump', () => {
      const [pda, bump] = deriveProtocolConfig(PROGRAM_ID);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should use "protocol_config" seed', () => {
      const [pda] = deriveProtocolConfig(PROGRAM_ID);
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol_config')],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it('should be deterministic', () => {
      const [pda1] = deriveProtocolConfig(PROGRAM_ID);
      const [pda2] = deriveProtocolConfig(PROGRAM_ID);
      expect(pda1.equals(pda2)).toBe(true);
    });
  });

  describe('deriveUserRole', () => {
    it('should return a valid PublicKey and bump', () => {
      const [pda, bump] = deriveUserRole(PROGRAM_ID, DUMMY_USER, 1);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should use "user_role", user pubkey, and role byte as seeds', () => {
      const role = 2;
      const [pda] = deriveUserRole(PROGRAM_ID, DUMMY_USER, role);
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_role'), DUMMY_USER.toBuffer(), Buffer.from([role])],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it('should produce different PDAs for different roles', () => {
      const [pda1] = deriveUserRole(PROGRAM_ID, DUMMY_USER, 0);
      const [pda2] = deriveUserRole(PROGRAM_ID, DUMMY_USER, 1);
      expect(pda1.equals(pda2)).toBe(false);
    });

    it('should produce different PDAs for different users', () => {
      const otherUser = PublicKey.unique();
      const [pda1] = deriveUserRole(PROGRAM_ID, DUMMY_USER, 1);
      const [pda2] = deriveUserRole(PROGRAM_ID, otherUser, 1);
      expect(pda1.equals(pda2)).toBe(false);
    });
  });

  describe('deriveMarket', () => {
    it('should return a valid PublicKey and bump', () => {
      const [pda, bump] = deriveMarket(PROGRAM_ID, 0);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should use "market" and LE u64 market count as seeds', () => {
      const count = 42;
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(count));
      const [pda] = deriveMarket(PROGRAM_ID, count);
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('market'), buf],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it('should produce different PDAs for different market counts', () => {
      const [pda1] = deriveMarket(PROGRAM_ID, 0);
      const [pda2] = deriveMarket(PROGRAM_ID, 1);
      expect(pda1.equals(pda2)).toBe(false);
    });
  });

  describe('deriveVaultAuthority', () => {
    it('should return a valid PublicKey and bump', () => {
      const [pda, bump] = deriveVaultAuthority(PROGRAM_ID, DUMMY_MARKET);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should use "vault_authority" and market pubkey as seeds', () => {
      const [pda] = deriveVaultAuthority(PROGRAM_ID, DUMMY_MARKET);
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault_authority'), DUMMY_MARKET.toBuffer()],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });
  });

  describe('deriveUserPosition', () => {
    it('should return a valid PublicKey and bump', () => {
      const [pda, bump] = deriveUserPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should use "user_position", market pubkey, and user pubkey as seeds', () => {
      const [pda] = deriveUserPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('user_position'),
          DUMMY_MARKET.toBuffer(),
          DUMMY_USER.toBuffer(),
        ],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it('should produce different PDAs for different users on same market', () => {
      const otherUser = PublicKey.unique();
      const [pda1] = deriveUserPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      const [pda2] = deriveUserPosition(PROGRAM_ID, DUMMY_MARKET, otherUser);
      expect(pda1.equals(pda2)).toBe(false);
    });
  });

  describe('deriveLpPosition', () => {
    it('should return a valid PublicKey and bump', () => {
      const [pda, bump] = deriveLpPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should use "lp_position", market pubkey, and user pubkey as seeds', () => {
      const [pda] = deriveLpPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('lp_position'), DUMMY_MARKET.toBuffer(), DUMMY_USER.toBuffer()],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it('should differ from deriveUserPosition with same inputs', () => {
      const [lpPda] = deriveLpPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      const [userPda] = deriveUserPosition(PROGRAM_ID, DUMMY_MARKET, DUMMY_USER);
      expect(lpPda.equals(userPda)).toBe(false);
    });
  });
});
