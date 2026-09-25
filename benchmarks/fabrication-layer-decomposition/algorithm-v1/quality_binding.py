"""Independent persisted experimental-design binding, never a cached PASS."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from m1_adapter import canonical_bytes


def verify_quality_design(root):
    root = Path(root)
    def read(name):
        return json.loads((root / name).read_text('utf-8'))
    def sha(value):
        return hashlib.sha256(value).hexdigest()
    def rgba(name):
        with Image.open(root / name) as image:
            return np.asarray(image.convert('RGBA')).copy()
    report = read('report.json')
    record = read('experimental-design.json')
    if sha((root / 'experimental-design.json').read_bytes()) != report['experimentalDesign']['sha256']:
        raise ValueError('experimental design artifact identity mismatch')
    if record.get('frozenEvidence') is not False or record.get('humanConfirmation') != 'PENDING_REVIEW':
        raise ValueError('experimental design cannot claim frozen evidence or human approval')
    descriptor = {'artifact': 'experimental-design.json',
                  'sha256': sha((root / 'experimental-design.json').read_bytes()),
                  'mode': record['mode'], 'foregroundCleanupEnabled': record['foregroundCleanupEnabled'],
                  'frozenEvidence': False, 'humanConfirmation': 'PENDING_REVIEW'}
    design_mode = record['mode'] in {'design-colors','design-cleanup'}
    if design_mode:
        descriptor['designColorRequest'] = record['designColorRequest']
    if any(canonical_bytes(value) != canonical_bytes(descriptor) for value in
           (report.get('experimentalDesign'), report['configuration'].get('experimentalDesign'))):
        raise ValueError('experimental design descriptor/approval differs from persisted design')
    if sha((root / 'source-snapshot.png').read_bytes()) != record['sourceSha256']:
        raise ValueError('original source differs from design provenance')
    original, effective, purified = (rgba(n) for n in ('original-effective-foreground.png','input-foreground.png','purified.png'))
    if original.shape != effective.shape or effective.shape != purified.shape:
        raise ValueError('experimental design frame mismatch')
    if not np.array_equal(effective[...,3], purified[...,3]):
        raise ValueError('design purification changed effective alpha')
    if not record['foregroundCleanupEnabled'] and not np.array_equal(original[...,3], effective[...,3]):
        raise ValueError('unrequested experimental foreground removal')
    with np.load(root / 'structural_label_map.npz') as arrays:
        labels = arrays['labels']
    with np.load(root / 'pixel_label_map.npz') as arrays:
        pixels = arrays['labels']
    with np.load(root / 'baseline-analysis.npz') as arrays:
        baseline = arrays['structural']
    expected = {'originalEffectiveRgbaSha256': sha(original.tobytes()),
                'derivedEffectiveRgbaSha256': sha(effective.tobytes()),
                'newPurifiedRgbaSha256': sha(purified.tobytes()),
                'baselineStructuralSha256': sha(baseline.astype('<i4').tobytes()),
                'newStructuralSha256': sha(labels.astype('<i4').tobytes()),
                'newPixelLabelsSha256': sha(pixels.astype('<i4').tobytes()),
                'selectedGeometrySha256': sha(canonical_bytes(read('vector-result.json')['geometry']))}
    for field, measured in expected.items():
        if record[field] != measured:
            raise ValueError('experimental design persisted data mismatch: '+field)
    if record['originalRegionMetadata'] != read('baseline-regions.json'):
        raise ValueError('original analysis metadata changed')
    regions = read('regions.json')
    # Region Core adds Components/perimeter; compare representative metadata
    # against the freshly recomputed design labels, not original Region IDs.
    by_id = {r['regionId']: r for r in regions}
    for r in record['newRegionMetadata']:
        if r['regionId'] not in by_id or any(by_id[r['regionId']].get(k) != v for k,v in r.items() if k != 'componentCount'):
            raise ValueError('new design representative/Region mapping mismatch')
    # Replay from persisted inputs, not a plan-ID, generation PASS or merely
    # mutually consistent hashes. Coherently rehashed metadata must still agree
    # with the declared experiment and the actual source. This extra work is
    # intentional and timed separately by the orchestration layer.
    import m4_runtime as kernel
    from quality_fragments import propose_foreground_cleanup, refine_selection
    from quality_contours import refine_contours
    config = report['configuration']
    color, vector_config = kernel.load_profile(config['profile'])
    if color != config['effectiveColorConfig'] or vector_config != config['effectiveVectorConfig']:
        raise ValueError('experimental effective profile differs from declared configuration')
    if record['mode'] not in {'selection','contour','combined','design-colors','design-cleanup'} or type(record['foregroundCleanupEnabled']) is not bool:
        raise ValueError('invalid persisted experimental mode')
    if any(report['experimentalDesign'][k] != record[k] for k in ('mode','foregroundCleanupEnabled')):
        raise ValueError('experimental mode declaration mismatch')
    origin = report['input']
    restored = kernel.load_foreground(root/'source-snapshot.png', mode=origin['foregroundMode'],
        mask_path=root/'external-mask-snapshot.png' if origin['externalMask'] else None,
        foreground_source=origin['foregroundSource'], manual_confirmation=origin['manualConfirmation'],
        whole_image_foreground=origin['wholeImageForegroundDeclared'])
    if not np.array_equal(restored.rgba,original):
        raise ValueError('original effective foreground differs from source/mask snapshots')
    proposal = kernel.get_candidate('CP-B').propose(original,color)
    old_purified, old_metadata = kernel.apply_representatives(original,proposal.structural_label_map,'RC-A',color,proposal.pixel_label_map)
    with np.load(root/'baseline-analysis.npz') as arrays:
        if not np.array_equal(arrays['structural'],proposal.structural_label_map) or not np.array_equal(arrays['pixels'],proposal.pixel_label_map):
            raise ValueError('baseline analysis is not original CP-B result')
    if not np.array_equal(old_purified,rgba('baseline-purified.png')) or old_metadata != record['originalRegionMetadata']:
        raise ValueError('baseline representative analysis differs')
    if design_mode:
        from design_color_regions import validate_request, cleanup_foreground, rebuild_regions
        request = record['designColorRequest']
        validated = validate_request(request['referencePalette'], request['referenceProvenance'])
        if canonical_bytes(validated) != canonical_bytes(request) or canonical_bytes(config.get('designColorRequest')) != canonical_bytes(request):
            raise ValueError('design colour request/reference provenance mismatch')
        replay_effective,cleanup = cleanup_foreground(original,color,request,enabled=record['foregroundCleanupEnabled'])
    else:
        replay_effective, cleanup = propose_foreground_cleanup(original,enabled=record['foregroundCleanupEnabled'])
    if cleanup != record['cleanup'] or not np.array_equal(replay_effective,effective):
        raise ValueError('foreground cleanup mapping/proposal differs from actual change')
    if not np.array_equal(original,effective):
        proposal = kernel.get_candidate('CP-B').propose(effective,color)
    if record['mode'] == 'design-colors':
        new_labels,new_pixels,selection = rebuild_regions(effective,proposal.structural_label_map,proposal.pixel_label_map,color,request)
    else:
        new_labels,new_pixels,selection = refine_selection(effective,proposal.structural_label_map,proposal.pixel_label_map,color,
                                                         enabled=record['mode'] in {'selection','combined'})
    if selection != record['selection'] or not np.array_equal(new_labels,labels) or not np.array_equal(new_pixels,pixels):
        raise ValueError('experimental selection mapping differs from actual labels')
    if design_mode:
        alpha_change=original[...,3]!=effective[...,3]
        label_change=baseline!=labels
        with np.load(root/'design-change-maps.npz') as arrays:
            for key,expected_map in (('alpha_changed',alpha_change),('labels_changed',label_change)):
                if arrays[key].dtype!=np.bool_ or not np.array_equal(arrays[key],expected_map):
                    raise ValueError('design change map differs from actual source and labels')
        preview=np.zeros_like(original)
        preview[label_change]=[255,180,0,255];preview[alpha_change]=[255,0,255,255]
        if not np.array_equal(preview,rgba('design-changes.png')):
            raise ValueError('design change preview differs from actual changes')
    replay_purified, metadata = kernel.apply_representatives(effective,labels,'RC-A',color,pixels)
    if not np.array_equal(replay_purified,purified) or metadata != record['newRegionMetadata']:
        raise ValueError('experimental RC-A palette/purified RGB mismatch')
    kernel.validate_labels(effective,purified,labels,pixels,metadata,color)
    replay_regions,_ = kernel._runtime_regions(labels,metadata)
    if replay_regions != regions:
        raise ValueError('experimental Region/Component derivation mismatch')
    graph, baseline_vector,_ = kernel._vectorize(labels,effective[...,3],report['runtimeId'],config['runtimeProfileId'],vector_config)
    selected,contours = refine_contours(graph,baseline_vector,labels,vector_config,
        enabled=record['mode'] in {'contour','combined','design-colors'},
        point_touch_cycles=record['mode']=='design-colors')
    public_graph = {k:v for k,v in graph.items() if not k.startswith('_')}
    # The frozen result contains numeric Region-map keys in memory. JSON turns
    # these into strings; sorting 1,2,10 is not sorting "1","10","2". Normalize
    # the live JSON object once, without changing frozen serialization/bytes.
    if any(json.loads(canonical_bytes(a)) != b for a,b in ((public_graph,read('boundary-graph.json')),
            (selected,read('vector-result.json')),(contours,record['contours']))):
        raise ValueError('experimental shared contour geometry/mapping/budget mismatch')
    if record['mode']=='design-colors':
        candidates=kernel._observed_candidates(report['runtimeId'],graph,selected,replay_regions,[selected['route']])
        objects=kernel.candidate_polygons(candidates,graph,selected,
            float(vector_config['bezier']['validationFlatnessPx']),point_touch_cycles=True)
        materialized=[{'candidateId':item['id'],**item['boundaryProvenance']['pointTouchMaterialization']}
                      for item in objects if 'pointTouchMaterialization' in item['boundaryProvenance']]
        if materialized!=record.get('pointTouchMaterialization'):
            raise ValueError('experimental point-touch materialization declaration mismatch')
    return {'status':'PASS','designSha256':report['experimentalDesign']['sha256'],'freshPersistedRead':True,
            'validation':'SOURCE_SNAPSHOT_CP_B_RC_A_SELECTION_SHARED_GEOMETRY_REPLAY_NO_PASS_CACHE'}
