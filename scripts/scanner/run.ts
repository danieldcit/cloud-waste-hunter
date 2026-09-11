import { prisma } from "@/lib/prisma";
import { runScan } from "@/lib/scanner/runScan";

async function main() {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "CONNECTED" },
  });

  for (const subscription of subscriptions) {
    try {
      await runScan(subscription.id);
      console.log(`Scan succeeded for subscription ${subscription.azureSubscriptionId}`);
    } catch (error) {
      console.error(`Scan failed for subscription ${subscription.azureSubscriptionId}`, error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
