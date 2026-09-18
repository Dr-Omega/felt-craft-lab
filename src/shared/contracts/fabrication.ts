/** B2 M1 derived-artifact contract; it never replaces PersonalAsset source.png. */
export type EvidenceStatus = 'PASS' | 'FAIL' | 'REVIEW_REQUIRED' | 'NOT_EVALUATED' | 'MANUAL_REQUIRED'
export type ArtifactIdentityMode = 'EXACT_BYTES' | 'TEXT_LF_UTF8'
export interface ArtifactIdentity { id: string; sha256: string; identityMode: ArtifactIdentityMode; byteLength: number; mediaType: string }
export interface GeometryReference { artifactId: string; objectId: string; frameId: string }
export type AffineMatrix = readonly [number, number, number, number, number, number]
export type CoordinateSpace = 'source-native' | 'analysis-raster' | 'p0-04c' | 'fabrication-canonical'
export interface CoordinateFrame { id: string; space: CoordinateSpace; unit: 'native-unit' | 'px' | 'canonical-unit'; bounds: readonly [number, number, number, number]; xDirection: 'RIGHT'; yDirection: 'DOWN' | 'UP'; sampleConvention: 'CONTINUOUS' | 'PIXEL_CELL_BOUNDARY' | 'PIXEL_CENTER'; sourceArtifactId: string }
export interface CoordinateTransform { id: string; fromFrameId: string; toFrameId: string; matrix: AffineMatrix; evidenceArtifactIds: string[] }
export interface CoordinateContract { frames: CoordinateFrame[]; transforms: CoordinateTransform[]; sourceFrameId: string; analysisFrameId: string; p004cFrameId: string; canonicalFrameId: string }
/** MIME is open. A versioned adapter capability, rather than this wire contract, limits V1 support. */
export interface SourceDescriptor { mediaType: string; sourceKind: 'FLAT' | 'LAYERED'; artifactId: string; normalizedLayerEvidenceId: string | null; adapter: { id: string; version: string; status: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' } }
export interface ColorSlot { id: string; purificationArtifactId: string; paletteEntryId: string; rgb: readonly [number, number, number]; skinFamily: string | null }
export interface ObservedRegion { id: string; componentIds: string[]; colorSlotId: string; geometry: GeometryReference }
export interface FabricationInput { schemaVersion: 'b2.input/1'; assetVersionId: string; artifacts: ArtifactIdentity[]; source: SourceDescriptor; coordinates: CoordinateContract; frozenRegionArtifactId: string; frozenVectorArtifactId: string; colorSlots: ColorSlot[]; observedRegions: ObservedRegion[] }
export type RelationKind = 'VISUAL_OCCLUSION_RELATION' | 'ASSEMBLY_PRECEDENCE'
export type RelationStatus = 'RESOLVED' | 'NO_RELATION' | 'UNRESOLVED' | 'NOT_EVALUATED'
export interface RelationRecord { id: string; kind: RelationKind; a: string; b: string; status: RelationStatus; direction: 'A_TO_B' | 'B_TO_A' | null; fabricationImpact: 'BLOCKING' | 'NON_BLOCKING'; impactReason: string; evidenceArtifactIds: string[] }
/** Closed only for b2.result/1; later contract versions may add roles. */
export type V1PieceRole = 'BASE' | 'VISIBLE'
export interface FabricationPiece { id: string; role: V1PieceRole; colorSlotId: string; sourceRegionIds: string[]; geometry: GeometryReference; solid: true; splitGroupId: string | null }
export interface AddedSeam { id: string; pieceIds: readonly [string, string]; geometry: GeometryReference; lengthCanonical: number; measurementEvidenceId: string }
export interface SplitGroup { id: string; sourceRegionIds: string[]; pieceIds: string[]; seams: AddedSeam[]; partitionEvidenceIds: string[] }
/** SHA-256 is computed from canonicalPayloadJson(payload), not a runtime ID/timestamp. */
export interface CanonicalIdentity { contractVersion: 'b2.result/1'; algorithmRecipeId: string; algorithmRecipeVersion: string; identityMode: 'CANONICAL_JSON_LF_UTF8'; sha256: string }
export interface FabricationResultPayload { input: FabricationInput; pieces: FabricationPiece[]; baseExposures: { sourceRegionId: string; basePieceId: string; geometry: GeometryReference }[]; splitGroups: SplitGroup[]; relations: RelationRecord[]; relationCoverage: { kind: RelationKind; status: 'COMPLETE' | 'NOT_EVALUATED'; evidenceArtifactIds: string[] }[]; unspecifiedRelation: 'NOT_EVALUATED' }
/** Size independent: no millimetres, assessment, timestamp, runtime UUID or task ID. */
export interface FabricationResult { schemaVersion: 'b2.result/1'; identity: CanonicalIdentity; payload: FabricationResultPayload }
export interface GateEvidence { status: EvidenceStatus; evidenceArtifactIds: string[] }
export interface ResultReference { resultSha256: string; resultContractVersion: 'b2.result/1' }
export interface StructuralAssessment extends ResultReference { schemaVersion: 'b2.structure/1'; assessmentId: string; evidenceArtifacts: ArtifactIdentity[]; status: EvidenceStatus; checks: Record<'purification' | 'sourceSemantics' | 'solidGeometry' | 'frozenBoundaryAndVoids' | 'renderBack' | 'sourceCoverage' | 'splitConservation' | 'relations', GateEvidence> }
export interface ManufacturingTarget { widthMm: number; heightMm: number; aspectRule: 'PRESERVE'; profileId: string; profileVersion: string; calibrationSha256: string }
/** Target-specific physical coordinates are outside canonical result identity. */
export interface ManufacturingAssessment extends ResultReference { schemaVersion: 'b2.manufacturing/1'; assessmentId: string; target: ManufacturingTarget; evidenceArtifacts: ArtifactIdentity[]; calibrationArtifactId: string; physicalFrame: { id: string; space: 'physical-mm'; unit: 'mm'; bounds: readonly [number, number, number, number]; sourceArtifactId: string }; physicalTransform: { id: string; fromFrameId: string; toFrameId: string; matrix: AffineMatrix; evidenceArtifactIds: string[] }; status: EvidenceStatus; checks: Record<'minimumPieceSize' | 'thinFeatures' | 'cuttingDifficulty' | 'seamAcceptability', GateEvidence>; seamMetrics: { count: number; totalLengthMm: number; seams: { seamId: string; lengthMm: number; acceptance: GateEvidence }[] }; review: { reviewerId: string; role: 'USER' | 'TEACHER' | 'TEAM_REVIEWER'; recordArtifactId: string } | null }
export type FabricationLifecycle = 'NOT_PROCESSED' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'STRUCTURE_ACCEPTED' | 'FABRICATION_ACCEPTED' | 'FABRICATION_REJECTED' | 'MANUAL_REQUIRED'
/** V0 adapter output: observed candidates are expressly not final solid pieces. */
export interface ObservedCandidate { schemaVersion: 'b2.observed-candidate/1'; input: FabricationInput; status: 'NOT_EVALUATED'; unspecifiedRelation: 'NOT_EVALUATED'; regions: ObservedRegion[] }
