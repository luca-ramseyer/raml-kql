import { z } from 'zod';

/**
 * "Developer: Show Network Activity" (spec 10): every host the app contacted this session,
 * with counts, so the privacy claims can be checked. Hosts only: never paths or query strings.
 */
export const NetworkHostSchema = z.object({
  host: z.string(),
  /** `app` (Azure, identity, releases), `git`, or `extension:<id>`. */
  category: z.string(),
  count: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export type NetworkHost = z.infer<typeof NetworkHostSchema>;

export const NetworkActivitySchema = z.object({
  since: z.string(),
  hosts: z.array(NetworkHostSchema),
});
export type NetworkActivity = z.infer<typeof NetworkActivitySchema>;
