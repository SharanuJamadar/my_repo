# Security Specification — SHARAN

## Data Invariants
1. Every document in `strategyConfigs`, `demoWallets`, `signals`, `trades`, `chatMessages`, `telegramLogs`, and `executionOrders` MUST belong to an authenticated, email-verified user (`userId == request.auth.uid`) or be accessed by the verified bootstrapped admin (`sharanu12131415@gmail.com`).
2. Users cannot self-assign `role: "admin"` during `users/{userId}` creation or escalate `role` during updates.
3. Document IDs (`{userId}`, `{signalId}`, `{tradeId}`, `{messageId}`, `{logId}`, `{orderId}`) MUST match `^[a-zA-Z0-9_\-]+$` with length <= 128.
4. All `createdAt` and `updatedAt` timestamps MUST equal `request.time`; `createdAt` and `userId` are immutable on updates.
5. Terminal state locking: Closed trades (`status == 'CLOSED'`) and invalidated/hit signals (`status in ['INVALIDATED', 'TARGET_HIT', 'SL_HIT']`) and terminal execution orders (`status in ['REJECTED', 'KILLED']`) cannot be reopened or mutated by non-admin users.
6. Every `allow list` rule MUST enforce `resource.data.userId == request.auth.uid || isBootstrappedAdmin()` without any `get()` or `exists()` reads.

## The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Signal Create**: `request.auth == null` creating `/signals/sig1` -> PERMISSION_DENIED.
2. **Unverified Email Write**: `request.auth.token.email_verified == false` creating `/trades/tr1` -> PERMISSION_DENIED.
3. **Self-Assigned Admin Privilege Escalation**: User creating `/users/{uid}` with `role: "admin"` -> PERMISSION_DENIED.
4. **Role Escalation Update**: User updating `/users/{uid}` to change `role` from `"trader"` to `"admin"` -> PERMISSION_DENIED.
5. **Cross-Tenant Identity Spoofing**: User A creating `/signals/sig2` with `userId: "userB"` -> PERMISSION_DENIED.
6. **Shadow Ghost Field Injection**: User creating `/trades/tr2` with unexpected extra key `isVerified: true` -> PERMISSION_DENIED.
7. **ID Poisoning**: Creating `/signals/../../../etc/passwd` or a 300-char ID -> PERMISSION_DENIED.
8. **Value Poisoning (1MB String)**: Updating `confirmationText` on `/signals/sig1` with a 5,000-character string -> PERMISSION_DENIED.
9. **Client Timestamp Forgery**: Creating `/trades/tr3` with a backdated `createdAt` not equal to `request.time` -> PERMISSION_DENIED.
10. **Immortal Field Mutation**: Updating `/trades/tr1` and changing `userId` or `createdAt` -> PERMISSION_DENIED.
11. **Terminal State Reopening**: Updating a `CLOSED` trade back to `OPEN` or changing `pnl` after close -> PERMISSION_DENIED.
12. **Blanket List Query Scraping**: User A querying `collection('trades')` without `where('userId', '==', uid)` -> PERMISSION_DENIED.
