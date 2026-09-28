"""Opt-in, spatially seeded design proposal; no case identity or hidden RGB.

Colour modes are hypotheses, not per-pixel votes. Only supported surfaces or
measured coherent details seed ownership; unseeded transition domains are
assigned together by edge-constrained flooding. Alpha is a separate contract.
This experimental path neither changes the legacy selector nor claims approval.
"""
from __future__ import annotations

import copy

import cv2
import numpy as np
from scipy import ndimage
from skimage.segmentation import watershed

from design_color_regions import CROSS, _lab, _visible_neighbourhood_rgb, digest
from layered_selection import _options, _palette
from quality_fragments import _components, _rgba, _summary

VERSION = 'practical-seeded-design/2'
PARAMETERS = {
    'surfaceDepthPx': 3.5,
    'surfacePaletteDistanceLab': 8.0,
    'surfaceLocalRangeRgb': 18.0,
    'surfaceMinimumColorSupportFraction': 0.5,
    'surfaceMaximumRelativeRunnerUpDistance': 0.6,
    'detailMinimumBoundaryStepLab': 5.0,
    'detailBoundaryFractionOfPaletteStep': 0.45,
    'detailStrongBoundaryFraction': 0.65,
    'detailInteriorDistancePx': 2.0,
    'detailExternalMinimumPaletteStepLab': 18.0,
    'detailMaximumRelativeColorResidual': 0.15,
    'detailMinimumSupportedFraction': 0.8,
    'transitionMaximumRgbResidual': 4.0,
    'transitionMinimumFraction': 0.08,
    'ownership': 'SUPPORTED_MARKERS_THEN_FOREGROUND_CONSTRAINED_WATERSHED',
    'transparentRgb': 'NEVER_OBSERVED; VISIBLE_EXTENSION_ONLY',
    'matte': 'NONE',
}


def _edge_steps(lab, active):
    gradient = np.zeros(active.shape, np.float32)
    for axis in (0, 1):
        left = (slice(None, -1), slice(None)) if axis == 0 else (slice(None), slice(None, -1))
        right = (slice(1, None), slice(None)) if axis == 0 else (slice(None), slice(1, None))
        step = np.linalg.norm(lab[left] - lab[right], axis=2)
        step *= active[left] & active[right]
        gradient[left] = np.maximum(gradient[left], step)
        gradient[right] = np.maximum(gradient[right], step)
    return gradient


def rebuild_regions(rgba, old_labels, old_pixels, config, request):
    from color_purification import assign_fringe_pixels

    _rgba(rgba)
    active = rgba[..., 3] >= config['structuralAlphaThreshold']
    if old_labels.dtype != np.int32 or old_labels.shape != active.shape:
        raise ValueError('expected full-resolution int32 baseline labels')
    if not np.array_equal(active, old_labels > 0):
        raise ValueError('baseline support differs from structural alpha')
    expected, _ = assign_fringe_pixels(rgba, old_labels, config)
    if not np.array_equal(expected, old_pixels):
        raise ValueError('baseline fringe differs from actual foreground')
    palette, palette_decisions = _palette(rgba, config, request, _options(None, None, None))
    rgb = _visible_neighbourhood_rgb(rgba)
    from practical_candidates import compare_ownership, propose_missing_inks
    missing_ink_proposals = []
    if request['mode'] == 'AUTO':
        palette, missing_ink_proposals = propose_missing_inks(rgb, active, palette)
    colors = np.asarray([item['rgb'] for item in palette], np.float32)
    lab = _lab(rgb)
    color_labs = _lab(colors)
    distances = np.stack([np.linalg.norm(lab - color, axis=2) for color in color_labs])
    nearest = distances.argmin(axis=0).astype(np.int32)
    runner_up = (np.partition(distances, 1, axis=0)[1] if len(colors) > 1
                 else np.full(active.shape, np.inf))
    local_range = (cv2.dilate(rgb, np.ones((3, 3), np.uint8)).astype(np.int16)
                   - cv2.erode(rgb, np.ones((3, 3), np.uint8))).max(axis=2)
    foreground_depth = ndimage.distance_transform_edt(np.pad(active, 1))[1:-1, 1:-1]
    markers = np.zeros(active.shape, np.int32)
    decisions = []
    for index in range(len(colors)):
        domain = active & (nearest == index)
        depth = ndimage.distance_transform_edt(np.pad(domain, 1))[1:-1, 1:-1]
        core = (domain & (depth >= PARAMETERS['surfaceDepthPx'])
                & (distances[index] <= PARAMETERS['surfacePaletteDistanceLab'])
                & (local_range <= PARAMETERS['surfaceLocalRangeRgb']))
        count, components, stats, _ = _components(domain)
        for cid in range(1, count):
            x, y, width, height, area = map(int, stats[cid])
            section = (slice(max(0, y-1), min(active.shape[0], y+height+1)),
                       slice(max(0, x-1), min(active.shape[1], x+width+1)))
            part = components[section] == cid
            ring = ndimage.binary_dilation(part, structure=CROSS) & active[section] & ~part
            steps, expected_steps = [], []
            for axis in (0, 1):
                first = (slice(None, -1), slice(None)) if axis == 0 else (slice(None), slice(None, -1))
                second = (slice(1, None), slice(None)) if axis == 0 else (slice(None), slice(1, None))
                for a, b in ((first, second), (second, first)):
                    border = part[a] & ring[b]
                    if border.any():
                        steps.extend(np.linalg.norm(lab[section][a] - lab[section][b], axis=2)[border].tolist())
                        expected_steps.extend(np.linalg.norm(color_labs[index] - color_labs[nearest[section][b]], axis=2)[border].tolist())
            thresholds = np.maximum(PARAMETERS['detailMinimumBoundaryStepLab'],
                                    np.asarray(expected_steps) * PARAMETERS['detailBoundaryFractionOfPaletteStep'])
            strong_fraction = float(np.mean(np.asarray(steps) >= thresholds)) if steps else 0.0
            palette_step = float(np.median(expected_steps)) if expected_steps else 0.0
            # A large raw edge step is not an authored thin mark when its
            # samples are still mixtures far from either surface colour.
            # Conversely exact colour alone supplies no protection: measured
            # boundary contrast and spatial context are required as well.
            supported_fraction = float(np.mean(distances[index][section][part] <=
                max(2.0, palette_step * PARAMETERS['detailMaximumRelativeColorResidual'])))
            # A long texture ramp can contain a few locally flat samples.
            # That is not an independent surface: support must occupy a
            # substantial fraction of this connected colour hypothesis.
            # Small sharp details have their own contrast/context test below.
            # Relative confidence tolerates a textured/shifted true surface
            # whose estimated representative is not an exact source sample.
            # It does not protect uncertain midpoints between two close inks.
            surface_fraction = float(np.mean(distances[index][section][part] <=
                np.maximum(2.0, runner_up[section][part] *
                           PARAMETERS['surfaceMaximumRelativeRunnerUpDistance'])))
            surface = (bool(core[section][part].any()) and
                       surface_fraction >= PARAMETERS['surfaceMinimumColorSupportFraction'])
            interior = float(foreground_depth[section][part].max()) > PARAMETERS['detailInteriorDistancePx']
            # A coherent thin black rim can be real; a weak narrow colour ramp
            # alongside transparency cannot qualify just because it is long.
            detail = (strong_fraction >= PARAMETERS['detailStrongBoundaryFraction']
                      and supported_fraction >= PARAMETERS['detailMinimumSupportedFraction']
                      and (interior or palette_step >= PARAMETERS['detailExternalMinimumPaletteStepLab']))
            # At a junction of two other observed inks, an antialias sample
            # may coincidentally match a third palette ink exactly. Test the
            # local two-ink explanation, not a global colour veto or a matte.
            # A resolved surface or continuous stroke remains a hypothesis;
            # only unresolved point transitions use this explanation.
            mixture = False
            neighbours = np.unique(nearest[section][ring])
            if not surface and width <= 2 and height <= 2 and len(neighbours) == 2:
                # Use the actual locally observed inks; a global representative
                # can be shifted by texture elsewhere in the same colour face.
                a, b = [np.median(rgb[section][ring & (nearest[section] == n)], axis=0)
                        for n in neighbours]
                vector = b-a
                norm = float(vector @ vector)
                if norm:
                    samples = rgb[section][part].astype(float)
                    fractions = (samples-a) @ vector / norm
                    residuals = np.abs(samples-(a+fractions[:, None]*vector)).max(axis=1)
                    low = PARAMETERS['transitionMinimumFraction']
                    mixture = bool(np.all(residuals <= PARAMETERS['transitionMaximumRgbResidual'])
                                   and np.all((fractions >= low) & (fractions <= 1-low)))
            detail = detail and not mixture
            detached = not ring.any()
            seed = surface or detail or detached
            if seed:
                # Seed the stable interior plus observed strongly-supported
                # fine features. No independent smoothing of piece boundaries.
                seed_mask = part if detail or detached else core[section] & part
                markers[section][seed_mask] = index + 1
            decisions.append({'designLabel': index+1, 'bbox': [x, y, width, height],
                              'areaPixels': area, 'maximumHalfWidthPx': float(depth[section][part].max()),
                              'surfaceCore': surface, 'coherentDetail': bool(detail),
                              'independentForeground': detached,
                              'boundaryStrongFraction': strong_fraction,
                              'colorSupportedFraction': supported_fraction,
                              'surfaceConfidenceFraction': surface_fraction,
                              'twoAdjacentInkPointTransition': mixture,
                              'paletteBoundaryStepLab': palette_step,
                              'action': 'SEED' if seed else 'SPATIAL_REASSIGNMENT_CANDIDATE'})
    # Every disconnected foreground has its own seed; no filling across alpha
    # holes and no implicit connecting of separate motifs is possible.
    count, bodies, _, _ = _components(active)
    for cid in range(1, count):
        body = bodies == cid
        if not markers[body].any():
            points = np.argwhere(body)
            point = points[np.argmax(foreground_depth[body])]
            markers[tuple(point)] = nearest[tuple(point)] + 1
    smoothed = cv2.medianBlur(rgb, 3)
    gradient = _edge_steps(_lab(smoothed), active)
    labels, markers, comparison = compare_ownership(rgb, active, colors, nearest, markers, gradient)
    comparison['missingInkProposals'] = missing_ink_proposals
    if not np.array_equal(labels > 0, active):
        raise ValueError('seeded ownership lost foreground support')
    pixels, fringe = assign_fringe_pixels(rgba, labels, config)
    changed = active & (labels != nearest + 1)
    return labels, pixels, {
        'strategyVersion': VERSION, 'effectiveParameters': copy.deepcopy(PARAMETERS),
        'request': copy.deepcopy(request), 'paletteProposal': palette,
        'paletteModeDecisions': palette_decisions, 'componentEvidence': decisions,
        'candidateComparison': comparison,
        'automaticUsesReferenceAnswer': False,
        'paletteColorCount': len(palette), 'actualUsedColorCount': len(np.unique(labels[active])),
        'before': _summary(old_labels), 'after': _summary(labels),
        'seedPixelCount': int(np.count_nonzero(markers)),
        'reownedPixelCount': int(changed.sum()),
        'initialNearestOwnershipSha256': digest(np.where(active, nearest+1, 0).astype(np.int32)),
        'seedMarkersSha256': digest(markers), 'outputStructuralSha256': digest(labels),
        'outputPixelSha256': digest(pixels), 'sourceAlphaModified': False,
        'fringeAssignment': fringe, 'manualQualityStatus': 'PENDING_MANUAL_REVIEW',
        'representativeColorPolicy': 'RC-A_RECOMPUTED_PER_SELECTED_COLOR_IDENTITY',
    }
