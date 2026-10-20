import { app } from "./app.js";
import { env } from "./config/env.js";
import { recoverInterruptedJobs } from "./modules/evidenceIntelligence/evidence-review-jobs.service.js";
import { sweepStaleWorkDirs } from "./modules/evidenceIntelligence/worker-client.js";

app.listen(env.PORT, () => {
  void sweepStaleWorkDirs().catch(() => undefined); // temp dirs orphaned by a previously killed process
  void recoverInterruptedJobs().catch(() => undefined); // interrupted review jobs become explicit failures; queued ones resume
  console.log(`Pramaan backend listening on http://localhost:${env.PORT}`);
});
