export interface PlazaUser {
  userId: string
  username: string
}

export interface PlazaPost {
  postId: string
  projectId: string
  title: string
  authorName: string
  previewMediaPath: string
  createdAt: string
  userId: string
}

export interface PlazaAuthResult {
  token: string
  user: PlazaUser
}
