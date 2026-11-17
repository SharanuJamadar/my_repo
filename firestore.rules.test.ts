// Security Test Suite Specification for KWIK TRADE SHASHANK Firestore Rules
// Verifies the Dirty Dozen adversarial payloads against DRAFT_firestore.rules / firestore.rules

export interface AdversarialPayloadTest {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list';
  expectedResult: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_TESTS: AdversarialPayloadTest[] = [
  {
    id: 1,
    name: 'Unauthenticated Signal Create',
    collection: 'signals',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { userId: 'anon', instrument: 'NIFTY 50', status: 'ACTIVE' },
  },
  {
    id: 2,
    name: 'Unverified Email Trade Write',
    collection: 'trades',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { userId: 'user1', instrument: 'NIFTY 50', emailVerified: false },
  },
  {
    id: 3,
    name: 'Self-Assigned Admin Role on User Create',
    collection: 'users',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { uid: 'user1', role: 'admin', email: 'attacker@example.com' },
  },
  {
    id: 4,
    name: 'Role Escalation on User Update',
    collection: 'users',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { role: 'admin' },
  },
  {
    id: 5,
    name: 'Cross-Tenant Identity Spoofing',
    collection: 'signals',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { userId: 'victim_uid', instrument: 'CRUDEOIL' },
  },
  {
    id: 6,
    name: 'Shadow Ghost Field Injection',
    collection: 'trades',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { userId: 'user1', isVerified: true, instrument: 'GOLD' },
  },
  {
    id: 7,
    name: 'Path ID Poisoning',
    collection: 'signals',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { docId: '../../../etc/passwd' },
  },
  {
    id: 8,
    name: 'Oversized Value Poisoning',
    collection: 'signals',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { confirmationText: 'A'.repeat(5000) },
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collection: 'trades',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
  },
  {
    id: 10,
    name: 'Immortal Field Mutation',
    collection: 'trades',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { userId: 'other_user', createdAt: '2025-01-01T00:00:00Z' },
  },
  {
    id: 11,
    name: 'Terminal Closed Trade Reopening',
    collection: 'trades',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { status: 'OPEN', pnl: 999999 },
  },
  {
    id: 12,
    name: 'Blanket Collection List Scraping',
    collection: 'trades',
    operation: 'list',
    expectedResult: 'PERMISSION_DENIED',
    payload: { queryWithoutOwnerFilter: true },
  },
];
