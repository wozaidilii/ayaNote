/**
 * One-off / ops script: assign a 10-question level sample quiz to every active student.
 * Usage: npx tsx scripts/seed-sample-quizzes.ts
 */
import { ensureSampleLevelHomeworkForAllStudents } from "../src/lib/ensure-sample-homework";

async function main() {
  const results = await ensureSampleLevelHomeworkForAllStudents();
  console.log(`Sample quizzes ready for ${results.length} students:`);
  for (const r of results) {
    const action = r.created ? "created" : r.refreshed ? "refreshed" : "kept";
    console.log(`  - ${r.name} (${r.jlpt}): ${action}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
