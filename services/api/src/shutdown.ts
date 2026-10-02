export interface ShutdownOperations {
  closeHttp: () => Promise<unknown>;
  disconnectDatabase: () => Promise<unknown>;
  logError: (error: unknown) => void;
}

export async function drainAndDisconnect(operations: ShutdownOperations): Promise<boolean> {
  let failed = false;
  try {
    await operations.closeHttp();
  } catch (error) {
    failed = true;
    operations.logError(error);
  }
  try {
    await operations.disconnectDatabase();
  } catch (error) {
    failed = true;
    operations.logError(error);
  }
  return !failed;
}
