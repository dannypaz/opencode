/**
 * Single-tenant "dynamic cloud mode" control plane: two Lambda function URLs that
 * provision/deprovision an AWS Lambda MicroVM running `opencode serve`, so opencode
 * desktop never needs a manually-run server or a URL pasted in by hand. Deploys only
 * to the dev's own AWS account (single-tenant, no multi-user auth/isolation).
 *
 * UNVERIFIED: the `lambda-microvms:*` IAM action names below are inferred from the
 * boto3 operation names (run_microvm, create_microvm_auth_token, terminate_microvm)
 * and AWS's usual IAM naming convention -- not confirmed against the service's
 * actual IAM action list (docs.aws.amazon.com returned 403 from this environment).
 * Confirm the exact action names against AWS's MicroVMs guide before deploying; see
 * also the header comment in packages/function/src/aws/microvm-client.ts.
 *
 * Prerequisite not automated here: a pre-baked MicroVM snapshot with opencode
 * installed, per AWS's MicroVMs setup guide. Set its id via the
 * OPENCODE_MICROVM_SNAPSHOT_ID env var when running `sst deploy`.
 */

export const CLOUD_CONTROL_PLANE_API_KEY = new sst.Secret("CloudControlPlaneApiKey")

const microvmPermissions = [
  {
    actions: ["lambda-microvms:RunMicrovm", "lambda-microvms:CreateMicrovmAuthToken", "lambda-microvms:TerminateMicrovm"],
    resources: ["*"],
  },
]

// CORS is open (desktop app has no fixed origin -- Electron renderers commonly send
// "null"/a custom scheme as Origin) since the real access control is the bearer API key
// checked inside each handler, not the browser-enforced CORS check.
const corsFromAnyOrigin = { allowOrigins: ["*"], allowMethods: ["POST"], allowHeaders: ["authorization", "content-type"] }

export const provisionFn = new sst.aws.Function("CloudSessionsProvision", {
  handler: "packages/function/src/aws/cloud-session-provision.handler",
  timeout: "30 seconds",
  url: { cors: corsFromAnyOrigin },
  link: [CLOUD_CONTROL_PLANE_API_KEY],
  permissions: microvmPermissions,
  environment: {
    MICROVM_SNAPSHOT_ID: process.env.OPENCODE_MICROVM_SNAPSHOT_ID ?? "",
  },
})

export const deprovisionFn = new sst.aws.Function("CloudSessionsDeprovision", {
  handler: "packages/function/src/aws/cloud-session-deprovision.handler",
  timeout: "10 seconds",
  url: { cors: corsFromAnyOrigin },
  link: [CLOUD_CONTROL_PLANE_API_KEY],
  permissions: microvmPermissions,
})
