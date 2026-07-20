import { AwsV4Signer } from "aws4fetch"

/**
 * Adapter for the AWS Lambda MicroVMs control API
 * (https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html).
 *
 * UNVERIFIED: as of writing, this service is new enough that its request/response
 * shapes could not be confirmed against AWS's authoritative API reference (fetching
 * docs.aws.amazon.com from this environment returned 403). The operation names below
 * (RunMicrovm, CreateMicrovmAuthToken, TerminateMicrovm) are inferred from the boto3
 * method names (`run_microvm`, `create_microvm_auth_token`, `terminate_microvm`)
 * surfaced in public write-ups, translated to the PascalCase AWS normally uses for
 * the wire-level action name. The JSON field names, endpoint host, and signing
 * service name are best-effort guesses and MUST be confirmed — open
 * https://docs.aws.amazon.com/lambda/latest/dg/microvms-launching.html directly
 * (not blocked in a normal browser) and update the constants/shapes below before
 * relying on this against a real AWS account.
 */

const SERVICE = "lambda" // UNVERIFIED signing service name for lambda-microvms
const API_VERSION = "2015-03-31" // UNVERIFIED

function endpoint(region: string) {
  return `https://lambda-microvms.${region}.amazonaws.com` // UNVERIFIED host
}

interface Credentials {
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

/** Lambda's execution environment injects the function's IAM role credentials into these env vars. */
export function credentialsFromLambdaEnvironment(): Credentials {
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing AWS Lambda execution credentials (AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)")
  }
  return { region, accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN }
}

async function call(action: string, credentials: Credentials, body: Record<string, unknown>) {
  const url = endpoint(credentials.region)
  const payload = JSON.stringify(body)
  const request = await new AwsV4Signer({
    url,
    method: "POST",
    headers: [
      ["content-type", "application/x-amz-json-1.1"],
      ["x-amz-target", `AWSLambdaMicrovms.${action}`], // UNVERIFIED target header format
    ],
    body: payload,
    region: credentials.region,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service: SERVICE,
  }).sign()

  const response = await fetch(request)
  if (!response.ok) {
    throw new Error(`lambda-microvms ${action} failed: ${response.status} ${await response.text()}`)
  }
  return response.json() as Promise<Record<string, unknown>>
}

export interface RunMicrovmInput {
  readonly credentials: Credentials
  /** ID of a pre-baked snapshot with opencode installed. Set up per AWS's MicroVMs setup guide. */
  readonly snapshotId: string
  readonly environment: Record<string, string>
}

export interface MicrovmHandle {
  readonly microvmId: string
  readonly url: string
}

export async function runMicrovm(input: RunMicrovmInput): Promise<MicrovmHandle> {
  const result = await call("RunMicrovm", input.credentials, {
    SnapshotId: input.snapshotId,
    Environment: input.environment,
    ApiVersion: API_VERSION,
  })
  const microvmId = result.MicrovmId ?? result.microvmId
  const url = result.Url ?? result.url
  if (typeof microvmId !== "string" || typeof url !== "string") {
    throw new Error(`Unexpected RunMicrovm response shape: ${JSON.stringify(result)}`)
  }
  return { microvmId, url }
}

export async function createMicrovmAuthToken(credentials: Credentials, microvmId: string): Promise<string> {
  const result = await call("CreateMicrovmAuthToken", credentials, { MicrovmId: microvmId })
  const token = result.Token ?? result.token
  if (typeof token !== "string") {
    throw new Error(`Unexpected CreateMicrovmAuthToken response shape: ${JSON.stringify(result)}`)
  }
  return token
}

export async function terminateMicrovm(credentials: Credentials, microvmId: string): Promise<void> {
  await call("TerminateMicrovm", credentials, { MicrovmId: microvmId })
}
