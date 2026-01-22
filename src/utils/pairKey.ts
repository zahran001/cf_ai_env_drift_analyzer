/**
 * Compute deterministic pairKey from two URLs using SHA-256.
 *
 * Same URL pair always produces same pairKey (used to route to stable DO instance).
 * Deterministic: sort URLs first so (A, B) and (B, A) → same hash.
 * SHA-256 avoids collisions even for similar URLs.
 */
export async function computePairKeySHA256(
  leftUrl: string,
  rightUrl: string
): Promise<string> {
  // Normalize: sort URLs so pair order doesn't matter
  const sorted = [leftUrl, rightUrl].sort();
  const input = sorted.join("|");

  // Use SubtleCrypto API available in Workers
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}
