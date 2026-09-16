import { useEffect } from "react";
import {
  dueSchedules,
  executeStartPlan,
  expiredSchedules,
  logSchedEvent,
  markSchedule,
  planContactCount,
  reclaimStaleFiring,
  writeHeartbeat,
} from "@/lib/campaign-schedules";

/** Headless ticker: fires due campaign schedules and retires ancient ones.
 *  Mounted once in App so it runs whenever the app is open. Scheduled starts
 *  need the app open by design — the start requests carry the user's live
 *  session, which only exists in the browser. */
export function CampaignScheduleEngine() {
  useEffect(() => {
    let alive = true;
    const sweep = async () => {
      writeHeartbeat();
      for (const stale of expiredSchedules()) {
        markSchedule(stale.id, { status: "missed" });
        logSchedEvent("missed", `${stale.campaignName}: scheduled time passed while the app was closed`);
      }
      for (const stuck of reclaimStaleFiring()) {
        markSchedule(stuck.id, { status: "pending", firedAt: undefined, error: undefined });
        logSchedEvent("missed", `${stuck.campaignName}: recovered an interrupted start, will retry`);
      }
      const due = dueSchedules();
      for (const item of due) {
        if (!alive) return;
        // Synchronous claim: a second tab sweeping the same second sees
        // "firing" instead of "pending" and stands down. No double starts.
        // firedAt doubles as the claim timestamp for crash recovery above.
        markSchedule(item.id, { status: "firing", firedAt: Date.now(), error: undefined });
        const recipients = planContactCount(item.plan);
        logSchedEvent("firing", `${item.campaignName}: starting now${recipients != null ? ` (${recipients} contact${recipients === 1 ? "" : "s"})` : ""}`);
        try {
          const summary = await executeStartPlan(item.plan);
          if (!alive) return;
          markSchedule(item.id, { status: "fired", firedAt: Date.now() });
          logSchedEvent("fired", `${item.campaignName}: started — ${summary}`);
        } catch (error) {
          if (!alive) return;
          const message = error instanceof Error ? error.message : String(error);
          markSchedule(item.id, { status: "failed", error: message });
          logSchedEvent("failed", `${item.campaignName}: ${message}`);
        }
      }
    };
    void sweep();
    const timer = window.setInterval(() => void sweep(), 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sweep();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
