import "dotenv/config";
import app from "./app";
import { ensureReady } from "./serverless";
import { closeDb } from "./db/database";

const PORT = process.env.PORT || 4000;

ensureReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MCQ backend running on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

process.on("SIGINT", () => {
  void closeDb().finally(() => process.exit(0));
});
