import type { AbstractPowerSyncDatabase } from "@powersync/web";

/**
 * Runs `task` while PowerSync uploads nothing, then connects again through
 * `resume`, whether `task` succeeded or not.
 *
 * disconnect() returns only once PowerSync's upload loop has stopped, so an
 * upload already in flight has finished (or failed) before `task` starts,
 * and none starts again until `resume`. Discarding a failed transaction runs
 * this way: otherwise a retry of that same transaction could reach the
 * server after the device reported it discarded.
 */
export async function withUploadsPaused<T>(
  db: Pick<AbstractPowerSyncDatabase, "disconnect">,
  resume: () => Promise<void>,
  task: () => Promise<T>
): Promise<T> {
  try {
    await db.disconnect();
    return await task();
  } finally {
    await resume();
  }
}
