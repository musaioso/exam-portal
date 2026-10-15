import "dotenv/config";
import { getDb } from "./db/database";
import { migrate } from "./db/migrate";
import { createApp } from "./app";

const app = createApp();
const PORT = process.env.PORT || 4000;

const start = async () => {
  await getDb();
  await migrate();
  app.listen(PORT, () => {
    console.log(`MCQ backend running on http://localhost:${PORT}`);
  });
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});

process.on("SIGINT", () => {
  const { closeDb } = require("./db/database");
  closeDb();
  process.exit(0);
});
