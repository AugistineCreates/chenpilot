import AppDataSource from "../config/Datasource";
import { EncryptionKeyRotationService } from "../Security/encryptionKeyRotation.service";

function usage(): never {
  throw new Error(
    "Usage: keys:rotate <rotate|status|retire-check> <source-key-id> [target-key-id] [batch-size]"
  );
}

async function main(): Promise<void> {
  const [command, sourceKeyId, targetKeyId, batchValue] = process.argv.slice(2);
  if (!command || !sourceKeyId) usage();

  await AppDataSource.initialize();
  const service = new EncryptionKeyRotationService(AppDataSource);

  if (command === "retire-check") {
    await service.assertKeyCanBeRetired(sourceKeyId);
    console.log(JSON.stringify({ keyId: sourceKeyId, safeToRetire: true }));
    return;
  }
  if (!targetKeyId) usage();
  if (command === "status") {
    console.log(
      JSON.stringify(
        await service.getCheckpoint(sourceKeyId, targetKeyId),
        null,
        2
      )
    );
    return;
  }
  if (command !== "rotate") usage();

  const batchSize = batchValue === undefined ? 100 : Number(batchValue);
  let result;
  do {
    result = await service.rotateBatch(sourceKeyId, targetKeyId, batchSize);
    console.log(
      JSON.stringify({
        rotationId: result.id,
        status: result.status,
        processed: result.processedCount,
        rotated: result.rotatedCount,
        skipped: result.skippedCount,
        remainingReferences: result.remainingReferences,
      })
    );
  } while (result.status !== "completed");
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Key rotation failed"
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });
