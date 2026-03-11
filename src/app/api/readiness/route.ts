import { getReadinessReport } from "lib/ops/readiness";

export async function GET() {
  const report = await getReadinessReport();

  return Response.json(report, {
    status: report.ok ? 200 : 503,
  });
}
