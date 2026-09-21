/** JSON stdin/stdout bridge to the actual shared M1 validators. */
import { canonicalPayloadJson, validateFabricationInput, validateFabricationResult, validateStructuralAssessment } from '../../../src/shared/contracts/fabrication-validation'
import type { FabricationResult } from '../../../src/shared/contracts/fabrication'
declare const require: (name: string) => any
declare const process: { stdout: { write(value: string): void }; exitCode: number }
const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'))
const response: Record<string, unknown> = {}
let result = request.result as FabricationResult | undefined
if (result && request.sign_result) {
  result.identity.sha256 = require('node:crypto').createHash('sha256').update(canonicalPayloadJson(result.payload), 'utf8').digest('hex')
  response.signedResult = result
}
if (request.input !== undefined) response.input = validateFabricationInput(request.input)
if (result !== undefined) response.result = validateFabricationResult(result)
if (request.assessment !== undefined) {
  if (!result || !(response.result as { ok: boolean }).ok) response.assessment = { ok: false, errors: [{ path: '$', message: 'Assessment requires a valid result' }] }
  else response.assessment = validateStructuralAssessment(request.assessment, result)
}
response.ok = ['input', 'result', 'assessment'].filter(key => key in response).every(key => (response[key] as { ok: boolean }).ok)
process.stdout.write(JSON.stringify(response) + '\n')
