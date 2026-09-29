import { trendRecorder } from "../tests/performance/utils/TrendRecorder";

/**
 * Script to load latest performance benchmark report and output trend summary
 */
export async function recordResults() {
  const report = trendRecorder.loadReport("latest.json");
  if (!report) {
    console.log("No latest benchmark report found in reports directory.");
    return;
  }

  const markdown = trendRecorder.generateTrendMarkdown(report, null);
  console.log("\n" + markdown);
  return { report, markdown };
}

if (require.main === module) {
  recordResults().catch((err) => {
    console.error("Error reading performance results:", err);
    process.exit(1);
  });
}
