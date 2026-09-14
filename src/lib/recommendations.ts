import type { WasteFinding } from "@prisma/client";

/**
 * Orders findings by financial impact: known `estimatedMonthlySavings` first
 * (highest first), then findings whose savings can't be estimated yet
 * (`null`), ordered among themselves by the resource's `estimatedMonthlyCost`
 * so nothing is hidden from the customer.
 */
export function sortByImpact<
  T extends Pick<WasteFinding, "estimatedMonthlyCost" | "estimatedMonthlySavings">,
>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    if (a.estimatedMonthlySavings != null && b.estimatedMonthlySavings != null) {
      return b.estimatedMonthlySavings - a.estimatedMonthlySavings;
    }
    if (a.estimatedMonthlySavings != null) {
      return -1;
    }
    if (b.estimatedMonthlySavings != null) {
      return 1;
    }
    return b.estimatedMonthlyCost - a.estimatedMonthlyCost;
  });
}
