import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260720000000_remove_session_share",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` DROP COLUMN \`share_url\`;`)
      yield* tx.run(`DROP TABLE \`session_share\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
