// Anomaly detection engine — pure function, no DB import (keeps modules acyclic).
// Real heuristics a finance team would actually want.

const DAY = 86400000;

export function detectAnomaly(tx, existing) {
  const amount = Number(tx.amount);
  const vendor = String(tx.vendor || '').trim().toLowerCase();
  const when = new Date(tx.occurred_at || Date.now()).getTime();

  // 1) Duplicate payment: same vendor + same amount within 7 days
  const dup = existing.find((e) =>
    String(e.vendor).trim().toLowerCase() === vendor &&
    Math.abs(Number(e.amount) - amount) < 0.01 &&
    Math.abs(new Date(e.occurred_at).getTime() - when) <= 7 * DAY
  );
  if (dup) {
    return { flagged: true, status: 'flagged', reason: `Possible duplicate of #${dup.id} (${vendor}, same amount within 7 days)` };
  }

  // 2) Statistical outlier: > 3× the median of prior amounts (needs a baseline)
  const amounts = existing.map((e) => Number(e.amount)).filter((n) => n > 0).sort((a, b) => a - b);
  if (amounts.length >= 4) {
    const median = amounts[Math.floor(amounts.length / 2)];
    if (median > 0 && amount > median * 3 && amount >= 10000) {
      return { flagged: true, status: 'flagged', reason: `Unusually large — ${(amount / median).toFixed(1)}× the median transaction` };
    }
  }

  // 3) Large round number to a new vendor (classic fraud signal)
  const knownVendor = existing.some((e) => String(e.vendor).trim().toLowerCase() === vendor);
  if (!knownVendor && amount >= 50000 && amount % 1000 === 0) {
    return { flagged: true, status: 'flagged', reason: 'Large round-number payment to a new vendor' };
  }

  return { flagged: false, status: 'cleared', reason: null };
}
