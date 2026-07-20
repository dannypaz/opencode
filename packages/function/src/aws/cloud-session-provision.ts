import { randomBytes } from "node:crypto"
import { Resource } from "sst"
import * as MicrovmClient from "./microvm-client"
import type { CloudSession } from "./types"

const HEALTH_PATH = "/global/health"
const HEALTH_POLL_INTERVAL_MS = 500
const HEALTH_POLL_TIMEOUT_MS = 20_000
const USERNAME = "opencode"

interface LambdaFunctionUrlEvent {
  headers?: Record<string, string | undefined>
}

function isAuthorized(event: LambdaFunctionUrlEvent) {
  const header = event.headers?.authorization ?? event.headers?.Authorization
  return header === `Bearer ${Resource.CloudControlPlaneApiKey.value}`
}

async function waitForHealth(url: string, password: string) {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS
  const authorization = `Basic ${Buffer.from(`${USERNAME}:${password}`).toString("base64")}`
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL(HEALTH_PATH, url), { headers: { Authorization: authorization } })
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS))
  }
  throw new Error(`opencode server never became healthy on ${url}${lastError ? `: ${lastError}` : ""}`)
}

export async function handler(event: LambdaFunctionUrlEvent) {
  if (!isAuthorized(event)) return { statusCode: 401, body: "Unauthorized" }

  const snapshotId = process.env.MICROVM_SNAPSHOT_ID
  if (!snapshotId) {
    return { statusCode: 500, body: "MICROVM_SNAPSHOT_ID is not configured" }
  }

  const credentials = MicrovmClient.credentialsFromLambdaEnvironment()
  const password = randomBytes(24).toString("base64url")

  const { microvmId, url } = await MicrovmClient.runMicrovm({
    credentials,
    snapshotId,
    environment: {
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: USERNAME,
    },
  })

  await waitForHealth(url, password)

  const session: CloudSession = { id: microvmId, url, username: USERNAME, password }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session),
  }
}
