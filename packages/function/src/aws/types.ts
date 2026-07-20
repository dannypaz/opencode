export interface CloudSession {
  readonly id: string
  readonly url: string
  readonly username: string
  readonly password: string
}

export interface ProvisionRequest {
  readonly ttlSeconds?: number
}
