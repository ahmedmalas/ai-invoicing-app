import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BANK_FEEDS_RETIRED_CODE,
  BANK_FEEDS_RETIRED_MESSAGE,
  retiredBankFeedStatus,
} from '../../src/domain/banking/retired.js';

describe('bank feeds provider retirement', () => {
  it('exposes a stable not-connected status without mobile or consent fields', () => {
    const status = retiredBankFeedStatus();
    expect(status.connected).toBe(false);
    expect(status.configured).toBe(false);
    expect(status.status).toBe('not_connected');
    expect(status.authLinkMobileMasked).toBeNull();
    expect(status.retired).toBe(true);
    expect(status.code).toBe(BANK_FEEDS_RETIRED_CODE);
    expect(status.nextAction).toContain('not connected');
    expect(BANK_FEEDS_RETIRED_MESSAGE.length).toBeGreaterThan(20);
  });

  it('keeps a neutral Bank Feeds UI with a disabled Connect bank account action', () => {
    const bankingUi = readFileSync(join(process.cwd(), 'public/banking-ui.js'), 'utf8');
    expect(bankingUi).toContain('Bank feeds are not connected yet.');
    expect(bankingUi).toContain('Connect bank account');
    expect(bankingUi).toContain('disabled');
    expect(bankingUi).not.toContain('/api/banking/basiq/connect');
    expect(bankingUi).not.toMatch(/AuthLink/);
  });

  it('removes obsolete Basiq client and connect flow modules', () => {
    const root = process.cwd();
    for (const relative of [
      'src/services/basiq-client.ts',
      'src/domain/banking/connection-service.ts',
      'src/domain/banking/sync-service.ts',
      'src/domain/banking/phone.ts',
      'src/domain/banking/basiq-errors.ts',
      'src/domain/banking/hosted-failure.ts',
      'src/domain/banking/status.ts',
    ]) {
      expect(() => readFileSync(join(root, relative))).toThrow();
    }
  });
});
