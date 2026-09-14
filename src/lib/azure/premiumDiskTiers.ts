interface PremiumDiskTierBand {
  maxSizeGb: number;
  maxIops: number;
}

/**
 * Premium SSD size -> maximum IOPS capacity per tier, from Microsoft's published Managed Disks
 * documentation. Not live-validated (would require provisioning a disk at every tier just to
 * read its capability — real cost beyond the single live validation already done for this
 * category, see the Category 4 spec §1). Revisit if Azure changes these published limits.
 *
 * Deliberately independent from `diskSkuMeterName` in `retailPrices.ts`, even though both use
 * the same underlying Microsoft-documented size breakpoints — one answers "what does this cost"
 * (a pricing-tier name), the other "what can this do" (an IOPS ceiling). They're different facts
 * that happen to share size boundaries; coupling the two modules together isn't warranted.
 */
const PREMIUM_DISK_TIER_LADDER: PremiumDiskTierBand[] = [
  { maxSizeGb: 32, maxIops: 120 },
  { maxSizeGb: 64, maxIops: 240 },
  { maxSizeGb: 128, maxIops: 500 },
  { maxSizeGb: 256, maxIops: 1100 },
  { maxSizeGb: 512, maxIops: 2300 },
  { maxSizeGb: 1024, maxIops: 5000 },
  { maxSizeGb: 2048, maxIops: 7500 },
  { maxSizeGb: 4096, maxIops: 7500 },
  { maxSizeGb: 8192, maxIops: 16000 },
  { maxSizeGb: 16384, maxIops: 18000 },
  { maxSizeGb: 32767, maxIops: 20000 },
];

/** Smallest band whose capacity covers `sizeGb` (disks always round up to the next tier); clamps to the largest published tier for anything beyond it. */
export function maxIopsForPremiumDiskSize(sizeGb: number): number {
  const band = PREMIUM_DISK_TIER_LADDER.find((b) => sizeGb <= b.maxSizeGb);
  return (band ?? PREMIUM_DISK_TIER_LADDER[PREMIUM_DISK_TIER_LADDER.length - 1]).maxIops;
}

/**
 * Smallest published tier whose maxIops covers `peakIops` with the same 70% safety ceiling used
 * for VM/VMSS sizing (src/lib/waste-rules/vmSkuSuggestion.ts) — never suggests a size whose
 * capacity the measured peak would exceed.
 */
export function smallestPremiumDiskSizeForIops(peakIops: number): number {
  const target = peakIops / 0.7;
  const band = PREMIUM_DISK_TIER_LADDER.find((b) => target <= b.maxIops);
  return (band ?? PREMIUM_DISK_TIER_LADDER[PREMIUM_DISK_TIER_LADDER.length - 1]).maxSizeGb;
}
