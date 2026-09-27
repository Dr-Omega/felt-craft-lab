"""Opt-in spatial design ownership for layered fabrication; no frozen mutation.

Palette, provisional-region support, and exact-colour veto are independent
ablation axes. Production uses spatially coherent palette modes, no provisional
majority, and evidence-qualified ink protection. Alpha/foreground are immutable.
Only source-visible RGB participates; reference palettes remain explicit.
"""
from __future__ import annotations

import copy

import cv2
import numpy as np
from scipy import ndimage

from design_color_regions import (
    CROSS, PARAMETERS as LEGACY_PARAMETERS, _lab, _visible_neighbourhood_rgb,
    digest, estimate_palette,
)
from quality_fragments import _components, _exterior, _rgba, _summary

VERSION = 'layered-spatial-design/1'
PARAMETERS = {
    'paletteMerging': True,
    'priorMajority': False,
    'exactColorProtection': False,
    'paletteMergePolicy': 'RETAIN_COHERENT_ABRUPT_MODES',
    'exactProtectionPolicy': 'VERBATIM_INK_OR_COHERENT_SPATIAL_CORE',
    'verbatimInkMaxChannelError': 2.0,
    'corePaletteLabDistance': 8.0,
    'coreDistancePx': 1.5,
    'localCoreRadiusPx': 8.0,
    'exteriorBandPx': 4.0,
    'mixtureMaxChannelResidual': 12.0,
    'minimumMixtureFraction': 0.04,
    'maximumMixtureFraction': 0.96,
    'surroundOwnerFraction': 0.6,
    'weakBoundaryContrastFraction': 0.5,
    'priorMinimumOwnerFraction': 0.6,
    'restoredModeCoreFraction': 0.5,
    'restoredModeMinimumCorePixels': 4,
    'restoredModeBoundaryContrastFraction': 0.6,
    'restoredPlateauMinimumForegroundFraction': 0.002,
    'restoredPlateauMinimumModeDensity': 0.1,
    'minorGradualModeMaximumCoreRatio': 0.02,
    'matteHypothesisRgb': [255, 255, 255],
    'matteStatus': 'UNCONFIRMED_HYPOTHESIS_NOT_HIDDEN_RGB',
    'foregroundPolicy': 'IMMUTABLE_ALPHA_AND_STRUCTURAL_SUPPORT',
}


def _options(palette_merging, prior_majority, exact_color_protection):
    options = copy.deepcopy(PARAMETERS)
    for name, value in (('paletteMerging', palette_merging),
                        ('priorMajority', prior_majority),
                        ('exactColorProtection', exact_color_protection)):
        if value is not None:
            if type(value) is not bool:
                raise ValueError(f'{name} ablation must be boolean')
            options[name] = value
    return options


def _palette(rgba, config, request, options):
    """Reuse existing non-frozen inference, undo only evidenced texture merging.

    The OFF ablation restores all recorded pre-texture-merge modes. Production
    restores only a coherent core separated by an abrupt visible colour step.
    No expected count or reference answer enters automatic mode.
    """
    proposed = copy.deepcopy(estimate_palette(rgba, config, request))
    structural_pixels = int(np.count_nonzero(rgba[..., 3] >= config['structuralAlphaThreshold']))
    if request['mode'] == 'REFERENCE':
        return proposed, []
    restored = []
    palette = []
    for parent in proposed:
        children = parent.pop('absorbedTextureModes', [])
        palette.append(parent)
        for child in children:
            difference = float(np.linalg.norm(_lab(child['rgb']) - _lab(parent['rgb'])))
            step = child.get('sharedBoundaryMedianLabStep')
            coherent = (child.get('largestCoherentCoreFraction', 0) >= options['restoredModeCoreFraction']
                        and child.get('largestCoherentCorePixels', 0) >= options['restoredModeMinimumCorePixels'])
            abrupt = step is not None and step >= difference * options['restoredModeBoundaryContrastFraction']
            # A substantial spatially coherent plateau remains a design
            # hypothesis even when its border is antialiased or a short ramp.
            # Requiring a hard single-pixel jump alone erased real near-colour
            # layers. Diffuse histogram modes cannot satisfy both spatial
            # coherence and measured sample density.
            plateau = (coherent and child.get('largestCoherentCorePixels', 0) >=
                       structural_pixels * options['restoredPlateauMinimumForegroundFraction'] and
                       child.get('supportPixels', 0) >= child.get('assignedCorePixels', 0) *
                       options['restoredPlateauMinimumModeDensity'])
            keep = not options['paletteMerging'] or (coherent and abrupt) or plateau
            restored.append({'rgb': child['rgb'], 'parentRgb': parent['rgb'],
                             'coherentCore': bool(coherent), 'abruptBoundary': bool(abrupt),
                             'coherentPlateau': bool(plateau),
                             'action': 'RESTORED' if keep else 'TEXTURE_MERGE_RETAINED'})
            if keep:
                child['evidence'] = (('COHERENT_VISIBLE_PLATEAU' if plateau else 'COHERENT_ABRUPT_VISIBLE_MODE') if options['paletteMerging']
                                     else 'PALETTE_MERGE_OFF_ABLATION')
                palette.append(child)
    # A mode can have a high within-mode coherence ratio yet represent only a
    # small stretch of a gradual edge. Coherence alone must not turn it into a
    # second material. Require the measured inter-mode boundary step as well
    # as substantial competing support; neither pixel area nor colour distance
    # by itself is permission to merge.
    if options['paletteMerging']:
        retained = []
        for item in sorted(palette, key=lambda p: (-p.get('assignedCorePixels', 0), tuple(p['rgb']))):
            near = min(((float(np.linalg.norm(_lab(item['rgb']) - _lab(p['rgb']))), p)
                        for p in retained), default=(float('inf'), None), key=lambda p: p[0])
            distance, parent = near
            step = item.get('sharedBoundaryMedianLabStep')
            minor = parent is not None and item.get('assignedCorePixels', 0) < (
                options['minorGradualModeMaximumCoreRatio'] * parent.get('assignedCorePixels', 0))
            gradual = step is not None and step < distance * options['restoredModeBoundaryContrastFraction']
            merge = (minor and gradual and distance <= LEGACY_PARAMETERS['textureModeLabRadius']
                     and item.get('evidence') != 'COHERENT_VISIBLE_PLATEAU')
            if merge:
                restored.append({'rgb': item['rgb'], 'parentRgb': parent['rgb'],
                                 'action': 'GRADUAL_MINOR_MODE_MERGED',
                                 'boundaryStepLab': float(step), 'modeDistanceLab': distance,
                                 'assignedCorePixels': item.get('assignedCorePixels', 0),
                                 'parentCorePixels': parent.get('assignedCorePixels', 0)})
            else:
                retained.append(item)
        palette = retained
    unique = {tuple(item['rgb']): item for item in palette}
    if len(unique) > LEGACY_PARAMETERS['maximumPaletteColors']:
        raise ValueError('spatial palette exceeds bounded capacity; no truncation')
    return [unique[key] for key in sorted(unique)], restored


def _mix_error(samples, base, other):
    vector = np.asarray(other, float) - np.asarray(base, float)
    denominator = float(vector @ vector)
    if denominator == 0:
        return np.full(len(samples), np.inf), np.full(len(samples), -1.0)
    fractions = ((samples.astype(float) - base) @ vector) / denominator
    residual = np.max(np.abs(samples - (base + fractions[:, None] * vector)), axis=1)
    return residual, fractions


def rebuild_regions(rgba, old_labels, old_pixels, config, request, *,
                    palette_merging=None, prior_majority=None, exact_color_protection=None):
    """Return full-resolution labels, fringe labels, and replayable diagnostics.

    This is design selection, not hidden piece completion. It cannot remove
    foreground, fill alpha holes, bridge disconnected geometry or consult M7.
    Optional keyword switches exist only for explicit development ablations;
    the public runtime invokes the fixed default configuration.
    """
    from color_purification import assign_fringe_pixels

    _rgba(rgba)
    if old_labels.dtype != np.int32 or old_labels.shape != rgba.shape[:2]:
        raise ValueError('old labels must be int32 at full source resolution')
    active = rgba[..., 3] >= config['structuralAlphaThreshold']
    if not np.array_equal(active, old_labels > 0):
        raise ValueError('old structural coverage mismatch')
    expected, _ = assign_fringe_pixels(rgba, old_labels, config)
    if not np.array_equal(expected, old_pixels):
        raise ValueError('old fringe mismatch')
    options = _options(palette_merging, prior_majority, exact_color_protection)
    palette, palette_records = _palette(rgba, config, request, options)
    colors = np.asarray([item['rgb'] for item in palette], np.float32)
    rgb = _visible_neighbourhood_rgb(rgba)
    lab = _lab(rgb)
    distances = np.stack([np.linalg.norm(lab - _lab(color), axis=2) for color in colors])
    chosen = distances.argmin(axis=0).astype(np.int32)
    initial = chosen.copy()
    color_error = np.max(np.abs(rgb.astype(float) - colors[chosen]), axis=2)
    literal_ink = active & (color_error <= options['verbatimInkMaxChannelError'])
    legacy_exact = active & (distances.min(axis=0) <= LEGACY_PARAMETERS['paletteLabRadius'])
    protected_ink = legacy_exact if options['exactColorProtection'] else literal_ink
    foreground = rgba[..., 3] > 0
    exterior = _exterior(foreground)
    # Exterior distance, not distance to any transparency: true interior holes
    # are never treated as evidence for an exterior matte transition.
    exterior_distance = (ndimage.distance_transform_edt(~exterior)
                         if exterior.any() else np.full(active.shape, np.inf))
    edge = active & (exterior_distance <= options['exteriorBandPx'])
    core_masks = []
    core_distances = []
    for index in range(len(colors)):
        owner_mask = active & (chosen == index)
        own_depth = ndimage.distance_transform_edt(np.pad(owner_mask, 1))[1:-1, 1:-1]
        core = owner_mask & (own_depth >= options['coreDistancePx']) & (
            distances[index] <= options['corePaletteLabDistance'])
        core_masks.append(core)
        core_distances.append(ndimage.distance_transform_edt(~core) if core.any()
                              else np.full(active.shape, np.inf))
    changes = []
    decisions = []
    # All decisions read the original assignment. No iterative absorption and
    # no order-dependent self-seeding by earlier ownership changes.
    result = chosen.copy()
    for index in range(len(colors)):
        count, components, stats, _ = _components(active & (chosen == index))
        for cid in range(1, count):
            x, y, width, height, area = (int(v) for v in stats[cid])
            section = (slice(max(0, y-1), min(active.shape[0], y+height+1)),
                       slice(max(0, x-1), min(active.shape[1], x+width+1)))
            mask = components[section] == cid
            ring = ndimage.binary_dilation(mask, structure=CROSS) & active[section] & ~mask
            own_core = bool(core_masks[index][section][mask].any())
            exact = bool(protected_ink[section][mask].any())
            reasons = []
            if own_core:
                reasons.append('COHERENT_SPATIAL_CORE')
            if exact:
                reasons.append('PROTECTED_INK_SAMPLE')
            if not ring.any():
                reasons.append('INDEPENDENT_FOREGROUND_DECORATION')
            if reasons:
                decisions.append({'designLabel': index+1, 'bbox': [x, y, width, height],
                                  'pixels': area, 'action': 'KEEP', 'reasons': reasons})
                continue
            neighbors, counts = np.unique(chosen[section][ring], return_counts=True)
            ranked = sorted(zip(neighbors.tolist(), counts.tolist()), key=lambda p: (-p[1], p[0]))
            owner = int(ranked[0][0])
            surround_fraction = ranked[0][1] / int(ring.sum())
            if owner == index or surround_fraction < options['surroundOwnerFraction']:
                continue
            supported = np.all(core_distances[owner][section][mask] <= options['localCoreRadiusPx'])
            if not supported:
                continue
            samples = rgb[section][mask].astype(float)
            evidence = None
            max_residual = None
            measured_boundary_steps = []
            local_lab = lab[section]
            local_owners = chosen[section]
            for axis in (0, 1):
                first = (slice(None, -1), slice(None)) if axis == 0 else (slice(None), slice(None, -1))
                second = (slice(1, None), slice(None)) if axis == 0 else (slice(None), slice(1, None))
                adjacent = ((mask[first] & (local_owners[second] == owner) & active[section][second]) |
                            (mask[second] & (local_owners[first] == owner) & active[section][first]))
                measured_boundary_steps.extend(np.linalg.norm(local_lab[first] - local_lab[second], axis=2)[adjacent].tolist())
            median_boundary_step = float(np.median(measured_boundary_steps)) if measured_boundary_steps else None
            palette_step = float(np.linalg.norm(_lab(colors[index]) - _lab(colors[owner])))
            # A matte explanation needs actual exterior adjacency, local owner
            # support and a non-verbatim transition. It is never confirmation.
            if np.all(edge[section][mask]):
                errors, fractions = _mix_error(samples, colors[owner], options['matteHypothesisRgb'])
                if np.all(errors <= options['mixtureMaxChannelResidual']) and np.all(
                    (fractions >= options['minimumMixtureFraction']) &
                    (fractions <= options['maximumMixtureFraction'])):
                    evidence = 'SUPPORTED_EXTERIOR_MIXTURE_HYPOTHESIS'
                    max_residual = float(errors.max())
            # An internal transition must be explained by two *adjacent* real
            # colours, not simply by proximity to a global palette colour.
            if evidence is None and len(ranked) == 2:
                other = int(ranked[1][0])
                if other != index and np.all(core_distances[other][section][mask] <= options['localCoreRadiusPx']):
                    errors, fractions = _mix_error(samples, colors[owner], colors[other])
                    if np.all(errors <= options['mixtureMaxChannelResidual']) and np.all(
                        (fractions >= options['minimumMixtureFraction']) &
                        (fractions <= options['maximumMixtureFraction'])):
                        evidence = 'TWO_ADJACENT_SUPPORTED_INKS_EXPLAIN_TRANSITION'
                        max_residual = float(errors.max())
            # A nearest-colour Voronoi boundary can bisect smooth texture and
            # create unsupported thread-like islands even far from alpha.
            # Here the actual adjacent source samples have no corresponding
            # material-colour step. Sharp small marks and thin strokes retain
            # their measured step and therefore cannot satisfy this rule.
            if (evidence is None and median_boundary_step is not None and
                    median_boundary_step < palette_step * options['weakBoundaryContrastFraction']):
                evidence = 'ADJACENT_SUPPORTED_OWNER_WITH_GRADUAL_RAW_BOUNDARY'
            if evidence is None:
                continue
            result[section][mask] = owner
            points = np.argwhere(mask) + [section[0].start, section[1].start]
            changes.append({'fromDesignLabel': index+1, 'toDesignLabel': owner+1,
                            'bbox': [x, y, width, height], 'pixels': area,
                            'changedPixelsXY': points[:, ::-1].tolist(),
                            'reason': evidence, 'maximumMixtureResidualRgb': max_residual,
                            'medianRawBoundaryStepLab': median_boundary_step,
                            'paletteStepLab': palette_step,
                            'surroundOwnerFraction': surround_fraction,
                            'ownCoherentCore': False, 'protectedInkSample': False,
                            'alphaChanged': False, 'manualConfirmation': 'NOT_CONFIRMED'})
    majority_changes = []
    if options['priorMajority']:
        # Provisional support is a proposal, not a truth veto. Actual competing
        # cores, exact ink and sharp source-colour steps all override it. This
        # confines its useful denoising role to unsupported gradual samples.
        all_core = np.logical_or.reduce(core_masks)
        maximum_raw_step = np.zeros(active.shape, np.float32)
        for axis in (0, 1):
            first = (slice(None, -1), slice(None)) if axis == 0 else (slice(None), slice(None, -1))
            second = (slice(1, None), slice(None)) if axis == 0 else (slice(None), slice(1, None))
            steps = np.linalg.norm(lab[first] - lab[second], axis=2)
            steps *= active[first] & active[second]
            maximum_raw_step[first] = np.maximum(maximum_raw_step[first], steps)
            maximum_raw_step[second] = np.maximum(maximum_raw_step[second], steps)
        for rid in np.unique(old_labels[active]):
            count, components, _, _ = _components(old_labels == rid)
            for cid in range(1, count):
                mask = components == cid
                values, counts = np.unique(initial[mask], return_counts=True)
                owner = int(values[counts.argmax()])
                owner_fraction = float(counts.max() / counts.sum())
                if owner_fraction < options['priorMinimumOwnerFraction']:
                    continue
                palette_difference = np.linalg.norm(_lab(colors[initial]) - _lab(colors[owner]), axis=2)
                gradual = maximum_raw_step < palette_difference * options['weakBoundaryContrastFraction']
                supported = core_distances[owner] <= options['localCoreRadiusPx']
                uncertain = mask & ~protected_ink & ~all_core & gradual & supported
                changed = uncertain & (result != owner)
                result[changed] = owner
                if changed.any():
                    majority_changes.append({'oldRegionId': int(rid), 'componentOrdinal': cid,
                                             'pixels': int(changed.sum()), 'toDesignLabel': owner+1,
                                             'ownerFraction': owner_fraction,
                                             'reason': 'PROVISIONAL_SUPPORT_WITH_NO_COMPETING_CORE_OR_ABRUPT_RAW_STEP'})
    labels = np.where(active, result+1, 0).astype(np.int32)
    pixels, fringe = assign_fringe_pixels(rgba, labels, config)
    changed = active & (initial != result)
    return labels, pixels, {
        'strategyVersion': VERSION, 'request': copy.deepcopy(request),
        'effectiveParameters': options, 'paletteProposal': palette,
        'paletteModeDecisions': palette_records, 'automaticUsesReferenceAnswer': False,
        'paletteColorCount': len(palette), 'actualUsedColorCount': len(np.unique(labels[active])),
        'before': _summary(old_labels), 'after': _summary(labels),
        'spatialReownership': changes, 'priorMajorityAblationChanges': majority_changes,
        'protectedComponentDecisions': decisions,
        'reownedPixelCount': int(changed.sum()),
        'completeChangeMap': 'persisted CP-B and new structural maps; palette-nearest ownership tracked separately',
        'initialNearestOwnershipSha256': digest(np.where(active, initial+1, 0).astype(np.int32)),
        'outputStructuralSha256': digest(labels), 'outputPixelSha256': digest(pixels),
        'sourceAlphaModified': False, 'fringeAssignment': fringe,
        'manualQualityStatus': 'PENDING_MANUAL_REVIEW',
        'representativeColorPolicy': 'RC-A_RECOMPUTED_GLOBALLY_PER_NEW_DESIGN_COLOR_IDENTITY',
    }
