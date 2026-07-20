import { describe, expect, it } from 'vitest';

import {
  parseBankStatement,
  transactionFingerprint,
} from '../../src/domain/reconciliation/statement-import.js';

describe('bank statement import parsers', () => {
  it('parses CSV with date, amount, description, reference and balance', () => {
    const csv = [
      'Date,Amount,Description,Reference,Name,Balance,BSB,Account',
      '18/07/2026,150.00,Payment INV-1001,INV-1001,Acme Plumbing,1200.50,062-000,12345678',
      '17/07/2026,-20.00,Fee,,Bank,1050.50,,',
    ].join('\n');

    const result = parseBankStatement('csv', csv);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      bookedDate: '2026-07-18',
      amount: 150,
      description: 'Payment INV-1001',
      reference: 'INV-1001',
      counterpartyName: 'Acme Plumbing',
      balanceAfter: 1200.5,
      bsb: '062-000',
      accountNumber: '12345678',
    });
  });

  it('parses OFX STMTTRN blocks', () => {
    const ofx = `
OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260718
<TRNAMT>275.50
<FITID>ABC123
<NAME>Jane Builder
<MEMO>Invoice INV-2044
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const result = parseBankStatement('ofx', ofx);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      bookedDate: '2026-07-18',
      amount: 275.5,
      reference: 'ABC123',
      counterpartyName: 'Jane Builder',
      description: 'Invoice INV-2044',
    });
  });

  it('parses QIF records', () => {
    const qif = [
      '!Type:Bank',
      'D18/07/2026',
      'T95.00',
      'PSmith Electrical',
      'MINV-3002 deposit',
      'NREF-9',
      '^',
    ].join('\n');

    const result = parseBankStatement('qif', qif);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.bookedDate).toBe('2026-07-18');
    expect(result.transactions[0]?.amount).toBe(95);
    expect(result.transactions[0]?.counterpartyName).toBe('Smith Electrical');
  });

  it('builds stable fingerprints for duplicate detection', () => {
    const txn = {
      bookedDate: '2026-07-18',
      amount: 10,
      description: 'Payment',
      reference: 'INV-1',
      counterpartyName: null,
      balanceAfter: null,
      bsb: null,
      accountNumber: null,
      raw: {},
    };
    const accountId = '11111111-1111-1111-1111-111111111111';
    expect(transactionFingerprint(accountId, txn)).toBe(transactionFingerprint(accountId, txn));
    expect(transactionFingerprint(accountId, txn)).not.toBe(
      transactionFingerprint(accountId, { ...txn, amount: 11 }),
    );
  });
});
