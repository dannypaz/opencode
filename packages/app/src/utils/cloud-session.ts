// Client for the single-tenant AWS control plane defined in infra/cloud-sessions.ts.
// Not yet wired into any UI -- see the plan doc for why (touches the settings/dialog
// UI and Electron-side secret storage, deliberately scoped separately). Call
// provisionCloudSession() to get back a connection to add via useServer().add(), and
// deprovisionCloudSession() with its cloudSessionId when removing that connection.

export interface CloudSession {
  id: string
  url: string
  username: string
  password: string
}

export interface CloudControlPlaneConfig {
  provisionUrl: string
  deprovisionUrl: string
  apiKey: string
}

async function readError(response: Response) {
  try {
    return await response.text()
  } catch {
    return response.statusText
  }
}

export async function provisionCloudSession(config: CloudControlPlaneConfig): Promise<CloudSession> {
  const response = await fetch(config.provisionUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to provision cloud session: ${response.status} ${await readError(response)}`)
  }
  return response.json()
}

export async function deprovisionCloudSession(config: CloudControlPlaneConfig, id: string): Promise<void> {
  const response = await fetch(config.deprovisionUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ id }),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to deprovision cloud session: ${response.status} ${await readError(response)}`)
  }
}
