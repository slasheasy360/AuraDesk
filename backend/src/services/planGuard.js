/**
 * Plan enforcement service.
 *
 * Every assert* function works in two modes depending on
 * `process.env.PLAN_ENFORCEMENT_MODE`:
 *
 *   'log'     → violations are logged via console.warn and the function
 *               RETURNS { ok: false, violation } without throwing. Callers
 *               should ignore the result and continue normal flow.
 *               ⚠️ This is the Phase 1 default — no user-visible change.
 *
 *   'enforce' → violations throw a `PlanLimitError` (HTTP 403). Use after
 *               the log-only rollout has confirmed no false positives.
 *
 *   'off'     → asserts are no-ops. Useful for scripts/tests.
 *
 * Default mode if the env var is unset: 'log'.
 *
 * Separation of concerns:
 *   - Platform rules  → allowedPlatforms + exclusivePlatforms
 *   - Count rules     → maxConnections
 *   - Team rules      → teamSeats (counting accepted members + pending invites)
 *   - AI quota        → aiRepliesPerCycle (atomic check-and-increment)
 *
 * All DB reads here are defensive: if a lookup fails we DO NOT block the
 * user's action. Phase 1 prioritizes not breaking existing flows.
 */

import prisma from '../utils/prisma.js';
import {
  getPlanLimits,
  suggestUpgradeForPlatform,
  nextPlanAbove,
  UNLIMITED,
} from '../config/plans.js';

// ─────────────────────────────────────────────────────────────────────────
// Mode
// ─────────────────────────────────────────────────────────────────────────

export const ENFORCEMENT_MODES = Object.freeze({
  OFF: 'off',
  LOG: 'log',
  ENFORCE: 'enforce',
});

export function getEnforcementMode() {
  const raw = (process.env.PLAN_ENFORCEMENT_MODE || 'enforce').toLowerCase();
  if (raw === 'enforce' || raw === 'on' || raw === 'strict') return ENFORCEMENT_MODES.ENFORCE;
  if (raw === 'off' || raw === 'disabled') return ENFORCEMENT_MODES.OFF;
  return ENFORCEMENT_MODES.LOG;
}

// ─────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────

export class PlanLimitError extends Error {
  /**
   * @param {string} code    Machine-readable violation code
   * @param {string} message Human-readable explanation
   * @param {object} meta    Structured metadata the frontend can use
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'PlanLimitError';
    this.code = code;
    this.statusCode = 403;
    this.meta = meta;
  }

  toJSON() {
    return { error: this.code, message: this.message, meta: this.meta };
  }
}

export const VIOLATION_CODES = Object.freeze({
  PLATFORM_NOT_ALLOWED: 'PLATFORM_NOT_ALLOWED',
  EXCLUSIVE_PLATFORM: 'EXCLUSIVE_PLATFORM',
  CONNECTION_LIMIT: 'CONNECTION_LIMIT',
  TEAM_LIMIT: 'TEAM_LIMIT',
  AI_LIMIT: 'AI_LIMIT',
});

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function logViolation(context, violation) {
  // Single-line structured log so it's easy to grep / ship to a log aggregator.
  console.warn(
    `[planGuard] VIOLATION mode=${getEnforcementMode()} context=${context} ` +
      `code=${violation.code} userId=${violation.meta?.userId || '?'} ` +
      `plan=${violation.meta?.plan || '?'} details=${JSON.stringify(violation.meta || {})}`
  );
}

/**
 * Central result handler. In enforce mode, throws. In log mode, logs and
 * returns a descriptive object so callers *could* surface a soft warning
 * (e.g. to an analytics event) but DO NOT block.
 */
function handleViolation(context, code, message, meta) {
  const violation = { code, message, meta };
  logViolation(context, violation);
  if (getEnforcementMode() === ENFORCEMENT_MODES.ENFORCE) {
    throw new PlanLimitError(code, message, meta);
  }
  return { ok: false, violation };
}

const OK = Object.freeze({ ok: true });

// ─────────────────────────────────────────────────────────────────────────
// Workspace resolution
//
// In AuraDesk a "workspace" is the owner user plus everyone whose
// inviterUserId points to that owner. Team limits and (typically)
// connection limits apply to the WORKSPACE, not the individual user.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns the owner user record for whatever user is passed in.
 * If the passed user is the owner, returns them directly.
 */
export async function resolveWorkspaceOwner(user) {
  if (!user) return null;
  if (!user.inviterUserId) return user;
  try {
    return await prisma.user.findUnique({ where: { id: user.inviterUserId } });
  } catch (err) {
    console.error('[planGuard] resolveWorkspaceOwner failed:', err.message);
    return user; // fail open
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Connection / platform guard
// ─────────────────────────────────────────────────────────────────────────

/**
 * Checks whether `user` may connect a new account on `platform`. Enforces
 * BOTH the platform allowlist and the connection count. In exclusive mode
 * (trial), refuses if the user already has a DIFFERENT platform connected.
 *
 * Uses the workspace owner's plan — a member should not be able to bypass
 * limits by joining a Starter workspace and connecting new platforms.
 */
export async function assertCanConnectPlatform(user, platform, { context = 'oauth' } = {}) {
  if (getEnforcementMode() === ENFORCEMENT_MODES.OFF) return OK;
  if (!user || !platform) return OK;

  let owner;
  try {
    owner = await resolveWorkspaceOwner(user);
  } catch {
    return OK; // fail open on infra errors
  }
  if (!owner) return OK;

  const limits = getPlanLimits(owner);

  // 1a. Platform allowlist
  if (!limits.allowedPlatforms.includes(platform)) {
    return handleViolation(context, VIOLATION_CODES.PLATFORM_NOT_ALLOWED,
      `${platform} is not available on the ${limits.label} plan.`,
      {
        userId: user.id,
        workspaceOwnerId: owner.id,
        plan: owner.plan,
        platform,
        allowedPlatforms: limits.allowedPlatforms,
        upgradeTo: suggestUpgradeForPlatform(platform),
      });
  }

  // Need current active connections for the NEXT two checks.
  let active = [];
  try {
    active = await prisma.connectedAccount.findMany({
      where: { userId: owner.id, status: 'active' },
      select: { id: true, platform: true },
    });
  } catch (err) {
    console.error('[planGuard] connection count query failed:', err.message);
    return OK;
  }

  // 1b. Exclusive (trial): only ONE platform of the allowed set at a time.
  if (limits.exclusivePlatforms && active.length > 0) {
    const already = active[0].platform;
    if (already !== platform) {
      return handleViolation(context, VIOLATION_CODES.EXCLUSIVE_PLATFORM,
        `Your ${limits.label} allows only one platform at a time. ` +
        `Disconnect ${already} first, or upgrade to connect more.`,
        {
          userId: user.id,
          workspaceOwnerId: owner.id,
          plan: owner.plan,
          currentPlatform: already,
          attemptedPlatform: platform,
          upgradeTo: 'starter',
        });
    }
  }

  // 1b-bis. Reconnection escape hatch.
  // If this workspace already has an ACTIVE connection on the same
  // platform, treat this as a reconnect / token refresh — NOT a new
  // connection. Otherwise an expired Gmail token would lock a paying
  // Starter user out of their own inbox when the refresh flow re-enters
  // /auth/gmail/start. Only brand-new platforms hit the count check.
  const alreadyConnected = active.some((a) => a.platform === platform);
  if (alreadyConnected) return OK;

  // 1c. Connection count
  if (limits.maxConnections !== UNLIMITED && active.length >= limits.maxConnections) {
    return handleViolation(context, VIOLATION_CODES.CONNECTION_LIMIT,
      `You've reached your ${limits.maxConnections}-connection limit on ${limits.label}.`,
      {
        userId: user.id,
        workspaceOwnerId: owner.id,
        plan: owner.plan,
        platform,
        currentCount: active.length,
        limit: limits.maxConnections,
        upgradeTo: nextPlanAbove(owner.plan),
      });
  }

  return OK;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Team seat guard
// ─────────────────────────────────────────────────────────────────────────

/**
 * Called before creating a TeamInvite OR accepting one.
 *
 * Counts seats as:
 *   owner (1) + accepted members + pending invites (reserved)
 *
 * Accepting a pending invite is a no-op for the count because the pending
 * invite row is what reserved the seat in the first place. Pass
 * `{ acceptingInviteId }` so this function can exclude that specific invite
 * from the pending count.
 */
export async function assertCanInviteTeamMember(ownerUser, { context = 'team', acceptingInviteId = null } = {}) {
  if (getEnforcementMode() === ENFORCEMENT_MODES.OFF) return OK;
  if (!ownerUser) return OK;

  // Ensure we're looking at the actual workspace owner record.
  let owner;
  try {
    owner = await resolveWorkspaceOwner(ownerUser);
  } catch {
    return OK;
  }
  if (!owner) return OK;

  const limits = getPlanLimits(owner);
  if (limits.teamSeats === UNLIMITED) return OK;

  let members = 0;
  let pending = 0;
  try {
    [members, pending] = await Promise.all([
      // owner counts toward the seat total, plus all members they've invited
      prisma.user.count({
        where: { OR: [{ id: owner.id }, { inviterUserId: owner.id }] },
      }),
      prisma.teamInvite.count({
        where: {
          inviterId: owner.id,
          status: 'pending',
          expiresAt: { gt: new Date() },
          ...(acceptingInviteId ? { NOT: { id: acceptingInviteId } } : {}),
        },
      }),
    ]);
  } catch (err) {
    console.error('[planGuard] team count query failed:', err.message);
    return OK;
  }

  const used = members + pending;
  if (used >= limits.teamSeats) {
    return handleViolation(context, VIOLATION_CODES.TEAM_LIMIT,
      `Your ${limits.label} plan includes ${limits.teamSeats} seat${limits.teamSeats === 1 ? '' : 's'}. ` +
      `You're currently using ${used} (${members} member${members === 1 ? '' : 's'}${pending ? ` + ${pending} pending invite${pending === 1 ? '' : 's'}` : ''}).`,
      {
        userId: ownerUser.id,
        workspaceOwnerId: owner.id,
        plan: owner.plan,
        used,
        members,
        pending,
        limit: limits.teamSeats,
        upgradeTo: nextPlanAbove(owner.plan),
      });
  }

  return OK;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. AI reply guard (atomic check-and-increment)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Atomically verifies the user has AI quota remaining and consumes one
 * unit. On enforce mode, a violation throws. On log mode, the violation is
 * recorded but we STILL consume quota so usage telemetry is accurate.
 *
 * Returns { ok, used, limit, unlimited, violation? } so the caller can
 * display a "7/30 used" counter back to the client.
 *
 * The caller MUST refund (see `refundAiReply`) if the downstream AI call
 * fails — otherwise users are charged for replies they never received.
 */
export async function assertAndConsumeAiReply(user, { context = 'ai', meta = {} } = {}) {
  if (getEnforcementMode() === ENFORCEMENT_MODES.OFF) {
    return { ok: true, used: null, limit: null, unlimited: true };
  }
  if (!user) return { ok: true, used: null, limit: null, unlimited: true };

  // AI quota applies to the workspace owner (members share the quota).
  let owner;
  try {
    owner = await resolveWorkspaceOwner(user);
  } catch {
    return { ok: true, used: null, limit: null, unlimited: true };
  }
  if (!owner) return { ok: true, used: null, limit: null, unlimited: true };

  const limits = getPlanLimits(owner);

  // Unlimited plans: just log the usage, no quota.
  if (limits.aiRepliesPerCycle === UNLIMITED) {
    await recordAiUsage(owner.id, meta);
    return { ok: true, used: null, limit: null, unlimited: true };
  }

  // Determine the current cycle anchor. Prefer Stripe's currentPeriodStart
  // because it matches the billing window the user pays for. Fall back to
  // the local aiRepliesCycleStart (seeded at signup) or epoch.
  const cycleAnchor =
    owner.currentPeriodStart ||
    owner.aiRepliesCycleStart ||
    new Date(0);

  // If the cycle has rolled over since last increment, reset first.
  const lastReset = owner.aiRepliesCycleStart || new Date(0);
  if (new Date(cycleAnchor).getTime() > new Date(lastReset).getTime()) {
    try {
      await prisma.user.update({
        where: { id: owner.id },
        data: { aiRepliesUsed: 0, aiRepliesCycleStart: cycleAnchor },
      });
      owner.aiRepliesUsed = 0;
      owner.aiRepliesCycleStart = cycleAnchor;
    } catch (err) {
      console.error('[planGuard] AI cycle reset failed:', err.message);
    }
  }

  const enforcing = getEnforcementMode() === ENFORCEMENT_MODES.ENFORCE;

  // Atomic check-and-increment. The `aiRepliesUsed < limit` condition in
  // the WHERE clause gives Postgres-level safety against two simultaneous
  // requests both squeezing in a final decrement.
  let incremented = { count: 0 };
  try {
    incremented = await prisma.user.updateMany({
      where: {
        id: owner.id,
        ...(enforcing ? { aiRepliesUsed: { lt: limits.aiRepliesPerCycle } } : {}),
      },
      data: { aiRepliesUsed: { increment: 1 } },
    });
  } catch (err) {
    console.error('[planGuard] AI increment failed:', err.message);
    // Fail open in Phase 1 — don't block a real user on infra issues.
    return { ok: true, used: null, limit: limits.aiRepliesPerCycle, unlimited: false };
  }

  const overLimit = incremented.count === 0;

  // Always write an audit row (even on overage) so we can see real usage.
  await recordAiUsage(owner.id, meta);

  if (overLimit) {
    const violation = handleViolation(context, VIOLATION_CODES.AI_LIMIT,
      `You've used all ${limits.aiRepliesPerCycle} AI replies for this cycle.`,
      {
        userId: user.id,
        workspaceOwnerId: owner.id,
        plan: owner.plan,
        limit: limits.aiRepliesPerCycle,
        used: limits.aiRepliesPerCycle,
        resetsAt: owner.currentPeriodEnd,
        upgradeTo: nextPlanAbove(owner.plan),
      });
    return {
      ok: false,
      used: limits.aiRepliesPerCycle,
      limit: limits.aiRepliesPerCycle,
      unlimited: false,
      violation: violation.violation,
    };
  }

  // Fresh read of the counter so we can return it to the caller.
  let freshUsed = null;
  try {
    const fresh = await prisma.user.findUnique({
      where: { id: owner.id },
      select: { aiRepliesUsed: true },
    });
    freshUsed = fresh?.aiRepliesUsed ?? null;
  } catch { /* non-fatal */ }

  return {
    ok: true,
    used: freshUsed,
    limit: limits.aiRepliesPerCycle,
    unlimited: false,
  };
}

/**
 * Refund a consumed AI reply. Call this when the downstream AI provider
 * fails AFTER `assertAndConsumeAiReply` already incremented the counter.
 * Also removes the matching audit row.
 */
export async function refundAiReply(user, { meta = {} } = {}) {
  if (!user) return;
  let owner;
  try {
    owner = await resolveWorkspaceOwner(user);
  } catch { return; }
  if (!owner) return;

  try {
    // Only decrement if > 0 (don't let it go negative).
    await prisma.user.updateMany({
      where: { id: owner.id, aiRepliesUsed: { gt: 0 } },
      data: { aiRepliesUsed: { decrement: 1 } },
    });
  } catch (err) {
    console.error('[planGuard] refundAiReply decrement failed:', err.message);
  }

  // Best-effort delete of the most recent matching audit row.
  try {
    const recent = await prisma.aiReplyUsage.findFirst({
      where: {
        userId: owner.id,
        ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      await prisma.aiReplyUsage.delete({ where: { id: recent.id } });
    }
  } catch (err) {
    console.error('[planGuard] refundAiReply audit delete failed:', err.message);
  }
}

async function recordAiUsage(ownerId, meta) {
  try {
    await prisma.aiReplyUsage.create({
      data: {
        userId: ownerId,
        platform: meta.platform || null,
        conversationId: meta.conversationId || null,
        cost: meta.cost || 1,
      },
    });
  } catch (err) {
    // Never block an AI response on a telemetry write.
    console.error('[planGuard] recordAiUsage failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Usage snapshot helper (for /api/plan/usage and /auth/me)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns a serialized snapshot of the user's plan + limits + current usage.
 * Safe to send over the wire: Infinity is replaced with `null` to mean
 * "unlimited", and no sensitive internals are exposed.
 */
export async function getUsageSnapshot(user) {
  if (!user) return null;

  let owner;
  try {
    owner = await resolveWorkspaceOwner(user);
  } catch {
    owner = user;
  }
  if (!owner) owner = user;

  const limits = getPlanLimits(owner);

  let connectionCount = 0;
  let connections = [];
  let teamMembers = 0;
  let pendingInvites = 0;

  try {
    const [accounts, memberCount, pendingCount] = await Promise.all([
      prisma.connectedAccount.findMany({
        where: { userId: owner.id, status: 'active' },
        select: { id: true, platform: true, displayName: true, createdAt: true },
      }),
      prisma.user.count({
        where: { OR: [{ id: owner.id }, { inviterUserId: owner.id }] },
      }),
      prisma.teamInvite.count({
        where: { inviterId: owner.id, status: 'pending', expiresAt: { gt: new Date() } },
      }),
    ]);
    connections = accounts;
    connectionCount = accounts.length;
    teamMembers = memberCount;
    pendingInvites = pendingCount;
  } catch (err) {
    console.error('[planGuard] getUsageSnapshot read failed:', err.message);
  }

  const unlimited = (n) => n === UNLIMITED;

  return {
    plan: owner.plan,
    label: limits.label,
    limits: {
      maxConnections: unlimited(limits.maxConnections) ? null : limits.maxConnections,
      allowedPlatforms: limits.allowedPlatforms,
      exclusivePlatforms: limits.exclusivePlatforms,
      teamSeats: unlimited(limits.teamSeats) ? null : limits.teamSeats,
      aiRepliesPerCycle: unlimited(limits.aiRepliesPerCycle) ? null : limits.aiRepliesPerCycle,
      features: limits.features,
    },
    usage: {
      connections: {
        used: connectionCount,
        limit: unlimited(limits.maxConnections) ? null : limits.maxConnections,
        items: connections,
      },
      team: {
        used: teamMembers,
        pending: pendingInvites,
        limit: unlimited(limits.teamSeats) ? null : limits.teamSeats,
      },
      aiReplies: {
        used: owner.aiRepliesUsed || 0,
        limit: unlimited(limits.aiRepliesPerCycle) ? null : limits.aiRepliesPerCycle,
        resetsAt: owner.currentPeriodEnd || null,
      },
    },
  };
}

/**
 * Express error helper — turns a PlanLimitError into the standard JSON
 * response shape. Use with: `next(err)` or manually `res.status(...).json(...)`.
 */
export function planLimitErrorResponse(err) {
  if (!(err instanceof PlanLimitError)) return null;
  return {
    status: err.statusCode,
    body: err.toJSON(),
  };
}
