import { Resource } from "sst"
import * as MicrovmClient from "./microvm-client"

interface LambdaFunctionUrlEvent {
  headers?: Record<string, string | undefined>
  body?: string
}

function isAuthorized(event: LambdaFunctionUrlEvent) {
  const header = event.headers?.authorization ?? event.headers?.Authorization
  return header === `Bearer ${Resource.CloudControlPlaneApiKey.value}`
}

export async function handler(event: LambdaFunctionUrlEvent) {
  if (!isAuthorized(event)) return { statusCode: 401, body: "Unauthorized" }

  const body = event.body ? (JSON.parse(event.body) as { id?: string }) : {}
  if (!body.id) return { statusCode: 400, body: "Missing id" }

  const credentials = MicrovmClient.credentialsFromLambdaEnvironment()
  await MicrovmClient.terminateMicrovm(credentials, body.id)

  return { statusCode: 204, body: "" }
}
