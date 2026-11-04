// Only the optional remote-to-remote replication scheduler runs on the server.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV !== "test"
  ) {
    const { ensureFullBackupSchedulerStarted } = await import("./lib/full-backup");
    ensureFullBackupSchedulerStarted();
  }
}
