import { getDb } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { seedDatabase } from "../src/db/seed";

async function main() {
  await getDb();
  await migrate();
  await seedDatabase();
  console.log("Seed complete.");
  console.log("Admin: admin@mcq.local / admin123");
  console.log("Teacher: teacher@mcq.local / teacher123");
  console.log("Student: student@mcq.local / student123");
}

main().catch((e) => { console.error(e); process.exit(1); });
