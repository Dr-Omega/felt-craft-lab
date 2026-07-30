/**
 * Secure AI gateway entry placeholder.
 * TSH owns routes/providers; do not put real model keys or providers here.
 */
export interface ServerBootstrapInfo {
  name: string
  ready: boolean
  note: string
}

export function getServerBootstrapInfo(): ServerBootstrapInfo {
  return {
    name: 'felt-craft-lab-server',
    ready: false,
    note: 'Server shell only. Real AI gateway routes will be added by TSH.'
  }
}
