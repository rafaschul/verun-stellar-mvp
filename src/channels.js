/**
 * Stellar channel-account manager for high-throughput anchoring.
 *
 * Channel accounts pattern: pre-create N sub-wallets, spread anchor
 * submissions across them so each wallet has its own sequence number.
 * This eliminates `tx_bad_seq` collisions when many users hit the
 * endpoint concurrently.
 *
 * Loading priority:
 *   1. STELLAR_CHANNELS env var (comma-separated secrets) — preferred
 *   2. Fallback to STELLAR_SECRET (single-account mode — legacy)
 *
 * Selection strategy:
 *   - Random pick per request (uniform distribution → very low collision)
 *   - In-process round-robin index as secondary tiebreaker
 *
 * Capacity (rough):
 *   - 1 channel  → ~3 concurrent before tx_bad_seq starts
 *   - 10 channels → ~30 concurrent comfortably
 *   - 20 channels → ~60 concurrent comfortably
 *   - 30 channels → ~100 concurrent comfortably
 */

require('dotenv').config();
const { StellarSdk, normalizeSecret } = require('./stellar');

function parseChannelsEnv() {
  const raw = (process.env.STELLAR_CHANNELS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => normalizeSecret(s))
    .filter((s) => s && s.startsWith('S'))
    .map((secret) => {
      try {
        return StellarSdk.Keypair.fromSecret(secret);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const channels = parseChannelsEnv();
let nextIndex = 0;

/**
 * Get a Keypair for the next anchor submission.
 * Uses random selection to spread load + reduces same-instance collisions.
 * Falls back to the legacy single STELLAR_SECRET keypair if no channels set.
 */
function pickChannel() {
  if (channels.length === 0) {
    // Legacy: fall back to the master operator keypair (single-account mode)
    const secret = normalizeSecret(process.env.STELLAR_SECRET);
    if (!secret) throw new Error('STELLAR_CHANNELS or STELLAR_SECRET env var required');
    return StellarSdk.Keypair.fromSecret(secret);
  }
  if (channels.length === 1) return channels[0];

  // Random selection + round-robin tiebreaker
  const i = Math.floor(Math.random() * channels.length);
  const kp = channels[i];
  nextIndex = (nextIndex + 1) % channels.length;
  return kp;
}

function getChannelCount() {
  return channels.length || 1;
}

function getChannelPublicKeys() {
  return channels.map((c) => c.publicKey());
}

module.exports = {
  pickChannel,
  getChannelCount,
  getChannelPublicKeys,
};
