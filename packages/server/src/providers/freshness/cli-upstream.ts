/**
 * CI entry: npx tsx src/providers/freshness/cli-upstream.ts
 * Exit 1 when a pinned npm/GitHub version no longer matches latest.
 */
import { formatUpstreamReport, probeUpstream, upstreamHasDrift } from "./upstream.js";

const rows = await probeUpstream();
console.log(formatUpstreamReport(rows));
process.exit(upstreamHasDrift(rows) ? 1 : 0);
