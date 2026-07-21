export * as Observability from "./observability"

import { NodeFileSystem } from "@effect/platform-node"
import { LayerNode } from "./effect/layer-node"
import { Layer, Logger, References } from "effect"
import { Logging } from "./observability/logging"

export const layer = Logger.layer(Logging.loggers(), { mergeWithExisting: false }).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.orDie,
  Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
)

export const node = LayerNode.make({ name: "observability", layer, deps: [] })
