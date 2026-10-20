import { app } from "./app.js";
import { env } from "./config/env.js";
import { recoverInterruptedJobs } from "./modules/evidenceIntelligence/evidence-review-jobs.service.js";

app.listen(env.PORT, () => {
  void recoverInterruptedJobs().catch(() => undefined); // interrupted review jobs become explicit failures; queued ones resume
  console.log(`Pramaan backend listening on http://localhost:${env.PORT}`);
});
