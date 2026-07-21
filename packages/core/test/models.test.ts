import { describe, expect, beforeAll, beforeEach, afterAll } from "bun:test"
import { Chunk, Effect, Fiber, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { it } from "./lib/effect"
import { rm, writeFile, mkdir } from "fs/promises"
import path from "path"

// test/preload.ts pins OPENCODE_MODELS_PATH to a fixture so other tests can
// resolve providers without touching disk/network. These tests need to drive
// the on-disk cache themselves. Save/restore around the suite — never leak
// the mutation to subsequent test files in the same bun process.
const ORIGINAL_MODELS_PATH = Flag.OPENCODE_MODELS_PATH
beforeAll(() => {
  Flag.OPENCODE_MODELS_PATH = undefined
})
afterAll(() => {
  Flag.OPENCODE_MODELS_PATH = ORIGINAL_MODELS_PATH
})

const cacheFile = path.join(Global.Path.cache, "models.json")

const fixture: Record<string, ModelsDev.Provider> = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {
      "acme-1": {
        id: "acme-1",
        name: "Acme One",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 8192 },
      },
    },
  },
}

const fixture2: Record<string, ModelsDev.Provider> = {
  beta: {
    id: "beta",
    name: "Beta",
    env: ["BETA_API_KEY"],
    models: {
      "beta-1": {
        id: "beta-1",
        name: "Beta One",
        release_date: "2026-02-01",
        attachment: false,
        reasoning: true,
        temperature: false,
        tool_call: false,
        limit: { context: 64000, output: 4096 },
      },
    },
  },
}

const writeCacheText = (text: string) =>
  Effect.promise(async () => {
    await mkdir(Global.Path.cache, { recursive: true })
    await writeFile(cacheFile, text)
  })

const writeCache = (data: object) => writeCacheText(JSON.stringify(data))

// Layer.fresh (via AppNodeBuilder.build -> LayerNode.compile) is required because the
// ModelsDev implementation is a module-level Layer constant, and Effect.provide uses a
// process-global MemoMap by default — without fresh, every test would reuse the
// cachedInvalidateWithTTL state from the first run.
const provided = <A, E>(eff: Effect.Effect<A, E, ModelsDev.Service>) =>
  eff.pipe(Effect.provide(AppNodeBuilder.build(ModelsDev.node)))

beforeEach(async () => {
  await rm(cacheFile, { force: true })
})

afterAll(async () => {
  await rm(cacheFile, { force: true })
})

describe("ModelsDev Service", () => {
  it.live("get() returns providers from disk when cache file exists", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const result = yield* provided(ModelsDev.Service.use((s) => s.get()))
      expect(result).toEqual(fixture)
    }),
  )

  it.live("get() returns empty catalog when neither disk cache nor bundled snapshot is present", () =>
    Effect.gen(function* () {
      const result = yield* provided(ModelsDev.Service.use((s) => s.get()))
      expect(result).toEqual({})
    }),
  )

  it.live("get() falls back to the build-time-embedded snapshot when no disk cache exists", () =>
    Effect.gen(function* () {
      // OPENCODE_MODELS_DEV is normally substituted at build time via an esbuild `define`
      // (see packages/opencode/script/build.ts / build-node.ts). Under bun test there's no
      // build step, so we simulate it by stubbing the global the module's `typeof` check reads.
      const globalWithSnapshot = globalThis as { OPENCODE_MODELS_DEV?: Record<string, ModelsDev.Provider> }
      globalWithSnapshot.OPENCODE_MODELS_DEV = fixture2
      const result = yield* provided(ModelsDev.Service.use((s) => s.get())).pipe(
        Effect.ensuring(Effect.sync(() => delete globalWithSnapshot.OPENCODE_MODELS_DEV)),
      )
      expect(result).toEqual(fixture2)
    }),
  )

  it.live("get() is single-flight under concurrent calls", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const results = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          return yield* Effect.all([svc.get(), svc.get(), svc.get(), svc.get(), svc.get()], {
            concurrency: "unbounded",
          })
        }),
      )
      for (const result of results) expect(result).toEqual(fixture)
    }),
  )

  it.live("get() caches across calls (later disk writes are ignored until invalidate)", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const first = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const a = yield* svc.get()
          // mutate disk between calls — cache should mask the change
          yield* writeCache(fixture2)
          const b = yield* svc.get()
          return { a, b }
        }),
      )
      expect(first.a).toEqual(fixture)
      expect(first.b).toEqual(fixture)
    }),
  )

  it.live("refresh(false) re-reads disk and invalidates the cache only when the content changed", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const result = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const before = yield* svc.get()
          // refresh with no on-disk change: cache should remain untouched
          yield* svc.refresh(false)
          const stillCached = yield* svc.get()
          // now actually change the disk contents and refresh again
          yield* writeCache(fixture2)
          yield* svc.refresh(false)
          const after = yield* svc.get()
          return { before, stillCached, after }
        }),
      )
      expect(result.before).toEqual(fixture)
      expect(result.stillCached).toEqual(fixture)
      expect(result.after).toEqual(fixture2)
    }),
  )

  it.live("refresh(true) always invalidates the cache, even when local content is unchanged", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const result = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const before = yield* svc.get()
          // no disk change, but force=true should still re-populate the cache
          yield* svc.refresh(true)
          const after = yield* svc.get()
          return { before, after }
        }),
      )
      expect(result.before).toEqual(fixture)
      expect(result.after).toEqual(fixture)
    }),
  )

  it.live("refresh() publishes Event.Refreshed when local content changes", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const received = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const events = yield* EventV2.Service
          yield* svc.get()
          const fiber = yield* events
            .subscribe(ModelsDev.Event.Refreshed)
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
          yield* Effect.yieldNow
          yield* writeCache(fixture2)
          yield* svc.refresh(false)
          return yield* Fiber.join(fiber)
        }),
      )
      expect(Chunk.size(received)).toBe(1)
    }),
  )

  it.live("refresh() does not publish Event.Refreshed when local content is unchanged", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const received = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const events = yield* EventV2.Service
          yield* svc.get()
          const fiber = yield* events
            .subscribe(ModelsDev.Event.Refreshed)
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
          yield* Effect.yieldNow
          yield* svc.refresh(false)
          // give the subscriber a beat, then confirm nothing arrived
          yield* Effect.sleep("20 millis")
          const status = yield* Fiber.poll(fiber)
          return status
        }),
      )
      expect(received._tag).toBe("None")
    }),
  )
})
