/** M2 review records are separate from algorithm proposals and immutable canonical artifacts. */
export type TruthDomain = 'raw_authoring_truth' | 'reviewed_fabrication_truth' | 'algorithm_prediction'
export type ReviewState = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'STALE'
export type ReviewerRole = 'PROJECT_FABRICATION_REVIEWER' | 'PRODUCTION_USER_DECISION' | 'ALGORITHM_PROPOSAL'
export interface ReviewBinding { targetId: string; targetVersion: string; targetSha256: string; recipeIdentity: string; endpointIdentity: string }
export interface ReviewRecord { schemaVersion: 'b2.review/1'; reviewId: string; domain: TruthDomain; binding: ReviewBinding; reviewType: 'RELATION' | 'MAPPING' | 'COLOR' | 'SKIN' | 'LAYERED' | 'BASE' | 'SPLIT' | 'MANUFACTURING'; reviewerRole: ReviewerRole; question: string; options: string[]; answer: string | null; evidenceArtifactIds: string[]; note: string | null; state: ReviewState; signoff: 'NOT_SIGNED' | 'SIGNED_OFF'; recordedAt: string }
export interface EndpointMapping { mappingId: string; semanticLabel: string; sourceRegionRef: string | null; componentRefs: string[]; observedCandidateRefs: string[]; fabricationPieceRefs: string[]; evidenceArtifactIds: string[]; state: 'PROPOSED' | 'REVIEWED' | 'APPROVED' | 'REJECTED'; approvalReviewId: string | null }
export interface DatasetItem { itemId: string; sourceLineageId: string; split: 'development' | 'calibration' | 'holdout'; runtimeInputs: string[]; forbiddenFlatBenchmarkFields: string[] }
