export type AuthUser = {
  id: string
  pseudo: string
  email: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  oauthProvider: string | null
  oauthId: string | null
  totpEnabled: boolean
  isAdmin: boolean
  createdAt: string
  updatedAt: string
}

export type AuthSessionResponse = {
  accessToken: string
  user: AuthUser
}

export type RefreshSessionResponse = {
  accessToken: string
}

export type MeResponse = {
  user: AuthUser
}

export type TwoFactorRequiredResponse = {
  requires2FA: true
  tempToken: string
}

export type LoginResponse = AuthSessionResponse | TwoFactorRequiredResponse
