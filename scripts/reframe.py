#!/usr/bin/env python3
"""
Smart reframe planner v2: analyzes a clip range with YuNet face detection (CPU)
and outputs a scene/speaker-aware render plan as JSON.

The clip is segmented by scene cuts; each window gets its own layout:
  - track:  one subject on screen -> virtual camera follows the face
  - split:  two speakers -> top/bottom split, each half cropped on its face;
            if mouth-movement shows only ONE of them is talking in a window,
            that window becomes a full-screen track of the active speaker
  - center: no reliable faces -> static center crop

Output (times relative to --start):
  { width, height, cropW, cropH,
    units: [{t0, t1, layout, track?: [{t,x}], split?: {...}}] }

Usage:
  reframe.py --video in.mp4 --start 12.5 --end 45.0 --out plan.json [--fps 4]
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

YUNET_MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'models', 'face_detection_yunet_2023mar.onnx')

MIN_SCENE_SEC = 1.2       # merge shorter scenes into the previous one
SPEAKER_WIN_SEC = 3.0     # mouth-activity decision window inside 2-face scenes
ACTIVITY_RATIO = 2.2      # one speaker must be this much more active to win
ACTIVITY_MIN = 0.012      # minimum normalized mouth variance to count as talking


def make_detector(width, height):
    return cv2.FaceDetectorYN.create(YUNET_MODEL, '', (width, height),
                                     score_threshold=0.6, nms_threshold=0.3)


def detect_faces(detector, frame):
    """Returns list of dicts with center/size/score and mouth offset (talk signal)."""
    _, results = detector.detect(frame)
    faces = []
    if results is not None:
        for row in results:
            x, y, w, h = row[0], row[1], row[2], row[3]
            re_x, re_y, le_x, le_y = row[4], row[5], row[6], row[7]
            nose_y = row[9]
            rm_y, lm_y = row[11], row[13]
            eye_dist = max(1.0, np.hypot(re_x - le_x, re_y - le_y))
            mouth_rel = ((rm_y + lm_y) / 2 - nose_y) / eye_dist
            faces.append({
                'cx': float(x + w / 2), 'cy': float(y + h / 2),
                'w': float(w), 'h': float(h),
                'score': float(row[14]), 'mouth': float(mouth_rel),
            })
    return faces


def hist_for_scene(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist


def sample_video(path, start, end, fps):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f'Cannot open video: {path}', file=sys.stderr)
        sys.exit(1)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, 960.0 / width)
    det_w, det_h = int(width * scale), int(height * scale)
    detector = make_detector(det_w, det_h)

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, int(round(native_fps / fps)))
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)

    samples, cut_indices = [], set()
    prev_hist = None
    idx = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if t >= end:
            break
        if idx % frame_interval != 0:
            idx += 1
            continue
        idx += 1

        ok, frame = cap.retrieve()
        if not ok:
            break
        small = cv2.resize(frame, (det_w, det_h)) if scale < 1.0 else frame

        hist = hist_for_scene(small)
        if prev_hist is not None:
            corr = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
            if corr < 0.5:
                cut_indices.add(len(samples))
        prev_hist = hist

        faces = detect_faces(detector, small)
        for f in faces:
            f['cx'] /= scale
            f['cy'] /= scale
            f['w'] /= scale
            f['h'] /= scale
        # Ignore tiny faces (background people, photos on screen): they must not
        # drive layout decisions nor steal the camera
        if faces:
            max_h = max(f['h'] for f in faces)
            faces = [f for f in faces
                     if f['h'] >= height * 0.06 and f['h'] >= max_h * 0.45]
        samples.append({'t': max(0.0, t - start), 'faces': faces})

    cap.release()
    return width, height, samples, cut_indices


def split_scenes(samples, cut_indices, step):
    """Scene index ranges [i0, i1), merging scenes shorter than MIN_SCENE_SEC."""
    n = len(samples)
    bounds = sorted(i for i in cut_indices if 0 < i < n)
    scenes, prev = [], 0
    for b in bounds:
        scenes.append([prev, b])
        prev = b
    scenes.append([prev, n])

    min_samples = max(1, int(MIN_SCENE_SEC / step))
    merged = []
    for sc in scenes:
        if merged and (sc[1] - sc[0]) < min_samples:
            merged[-1][1] = sc[1]
        elif not merged and (sc[1] - sc[0]) < min_samples and len(scenes) > 1:
            sc_next = sc  # too-short first scene merges into the next one
            merged.append(sc_next)
        else:
            merged.append(sc)
    # Merge a too-short first scene forward
    if len(merged) >= 2 and (merged[0][1] - merged[0][0]) < min_samples:
        merged[1][0] = merged[0][0]
        merged.pop(0)
    return merged


def stable_face_count(scene_samples):
    counts = [min(2, len(s['faces'])) for s in scene_samples]
    if not counts:
        return 0
    if np.mean([c >= 2 for c in counts]) > 0.5:
        return 2
    if np.mean([c >= 1 for c in counts]) > 0.4:
        return 1
    return 0


def best_face(faces):
    return max(faces, key=lambda f: f['score'] * f['w'])


def lr_clusters(scene_samples, width):
    """Median left/right face centers + per-sample mouth signal per cluster."""
    lefts, rights = [], []
    l_mouth, r_mouth = [], []
    for s in scene_samples:
        if len(s['faces']) >= 2:
            two = sorted(sorted(s['faces'], key=lambda f: -f['score'])[:2], key=lambda f: f['cx'])
            lefts.append(two[0]['cx'])
            rights.append(two[1]['cx'])
            l_mouth.append(two[0]['mouth'])
            r_mouth.append(two[1]['mouth'])
        else:
            l_mouth.append(None)
            r_mouth.append(None)
    if not lefts:
        return None
    return {
        'leftX': float(np.median(lefts)), 'rightX': float(np.median(rights)),
        'lMouth': l_mouth, 'rMouth': r_mouth,
        'separated': (np.median(rights) - np.median(lefts)) > width * 0.18,
    }


def mouth_activity(vals):
    v = [x for x in vals if x is not None]
    if len(v) < 4:
        return 0.0
    return float(np.std(v))


def x_clusters(scene_samples, width):
    """
    Detect two stable left/right face groups inside a scene, even when the
    detector only catches one of them per frame (anti ping-pong: a panning
    virtual camera between two seats must become a split instead).
    Returns (leftX, rightX) medians or None.
    """
    xs = sorted(f['cx'] for s in scene_samples for f in s['faces'])
    if len(xs) < 6:
        return None
    gaps = [(xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)]
    gap, gi = max(gaps)
    if gap < width * 0.15:
        return None
    left, right = xs[:gi + 1], xs[gi + 1:]
    if len(left) < len(xs) * 0.2 or len(right) < len(xs) * 0.2:
        return None
    lx, rx = float(np.median(left)), float(np.median(right))
    if rx - lx < width * 0.18:
        return None
    return lx, rx


def is_oscillating(keyframes, width):
    """True when the smoothed camera path sweeps across a wide range (ping-pong)."""
    if len(keyframes) < 4:
        return False
    xs = [k['x'] for k in keyframes]
    return (max(xs) - min(xs)) > width * 0.28


OUTPUT_FPS = 30.0  # dense keyframes → pixel-smooth panning instead of 5fps steps


def smooth_track(scene_samples, width, crop_w, step):
    """
    Crop-x keyframes following the main face like a human camera operator.
    Two-stage smoothing (EMA at sample rate + moving average at 30fps after
    interpolation) removes both jitter and the stepping of sparse samples.
    """
    targets, last = [], width / 2
    for s in scene_samples:
        if s['faces']:
            last = best_face(s['faces'])['cx']
        targets.append(last)

    deadzone = crop_w * 0.04
    max_speed = width * 0.55 * step
    cur = targets[0]
    sample_t, sample_x = [], []
    for s, tgt in zip(scene_samples, targets):
        delta = tgt - cur
        if abs(delta) > crop_w * 0.7:
            # Fast subject (sprints, jumps): snap instead of lagging behind
            cur = tgt
        elif abs(delta) > deadzone:
            cur += float(np.clip(delta * 0.28, -max_speed, max_speed))
        sample_t.append(s['t'])
        sample_x.append(cur)

    if len(sample_t) == 1:
        x = int(round(max(0, min(width - crop_w, sample_x[0] - crop_w / 2))))
        return [{'t': round(sample_t[0], 3), 'x': x}]

    # Interpolate to output fps, then a light moving average to kill velocity
    # discontinuities (the "stop-start" feel of the deadzone)
    t0, t1 = sample_t[0], sample_t[-1]
    n_out = max(2, int(round((t1 - t0) * OUTPUT_FPS)))
    dense_t = np.linspace(t0, t1, n_out)
    dense_x = np.interp(dense_t, sample_t, sample_x)
    win = max(1, int(OUTPUT_FPS * 0.35))
    kernel = np.ones(win) / win
    dense_x = np.convolve(np.pad(dense_x, (win // 2, win - 1 - win // 2), mode='edge'), kernel, mode='valid')

    keyframes, prev_x = [], None
    for t, cx in zip(dense_t, dense_x):
        x = int(round(max(0, min(width - crop_w, cx - crop_w / 2))))
        if prev_x is None or abs(x - prev_x) >= 1:
            keyframes.append({'t': round(float(t), 3), 'x': x})
            prev_x = x
    return keyframes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--start', type=float, required=True)
    ap.add_argument('--end', type=float, required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--fps', type=float, default=5.0)
    args = ap.parse_args()

    step = 1.0 / args.fps
    width, height, samples, cut_indices = sample_video(args.video, args.start, args.end, args.fps)
    duration = args.end - args.start

    crop_h = height
    crop_w = min(width, int(round(height * 9 / 16 / 2) * 2))
    half_crop_h = height
    half_crop_w = min(width, int(round(height * 9 / 8 / 2) * 2))
    center_x = int(round((width - crop_w) / 2))

    plan = {'width': width, 'height': height, 'cropW': crop_w, 'cropH': crop_h, 'units': []}

    if not samples:
        plan['units'] = [{'t0': 0.0, 't1': round(duration, 3), 'layout': 'center'}]
        json.dump(plan, open(args.out, 'w'))
        return

    def clamp_half(cx):
        x = int(round(cx - half_crop_w / 2))
        return max(0, min(width - half_crop_w, x))

    units = []
    scenes = split_scenes(samples, cut_indices, step)

    for i0, i1 in scenes:
        sc = samples[i0:i1]
        t0 = sc[0]['t']
        t1 = samples[i1]['t'] if i1 < len(samples) else duration
        nfaces = stable_face_count(sc)

        if nfaces == 0:
            units.append({'t0': t0, 't1': t1, 'layout': 'center'})
            continue

        if nfaces == 1:
            kf = smooth_track(sc, width, crop_w, step)
            # Anti ping-pong: a camera sweeping between two seats → split instead
            if is_oscillating(kf, width):
                cl2 = x_clusters(sc, width)
                if cl2:
                    units.append({'t0': t0, 't1': t1, 'layout': 'split',
                                  'split': {'topX': clamp_half(cl2[0]), 'bottomX': clamp_half(cl2[1]),
                                            'halfCropW': half_crop_w, 'halfCropH': half_crop_h}})
                    continue
            units.append({'t0': t0, 't1': t1, 'layout': 'track', 'track': kf})
            continue

        # Two faces: split, but carve out windows where only one person talks
        cl = lr_clusters(sc, width)
        if not cl or not cl['separated']:
            cl2 = x_clusters(sc, width)
            if cl2:
                units.append({'t0': t0, 't1': t1, 'layout': 'split',
                              'split': {'topX': clamp_half(cl2[0]), 'bottomX': clamp_half(cl2[1]),
                                        'halfCropW': half_crop_w, 'halfCropH': half_crop_h}})
            else:
                units.append({'t0': t0, 't1': t1, 'layout': 'track',
                              'track': smooth_track(sc, width, crop_w, step)})
            continue

        split_params = {'topX': clamp_half(cl['leftX']), 'bottomX': clamp_half(cl['rightX']),
                        'halfCropW': half_crop_w, 'halfCropH': half_crop_h}

        win = max(2, int(SPEAKER_WIN_SEC / step))
        sub_units = []
        for w0 in range(0, len(sc), win):
            w1 = min(len(sc), w0 + win)
            la = mouth_activity(cl['lMouth'][w0:w1])
            ra = mouth_activity(cl['rMouth'][w0:w1])
            focus = None
            if la > ACTIVITY_MIN and la > ra * ACTIVITY_RATIO:
                focus = 'left'
            elif ra > ACTIVITY_MIN and ra > la * ACTIVITY_RATIO:
                focus = 'right'
            sub_units.append([w0, w1, focus])

        # Merge consecutive windows with the same decision
        merged = []
        for su in sub_units:
            if merged and merged[-1][2] == su[2]:
                merged[-1][1] = su[1]
            else:
                merged.append(su)

        for w0, w1, focus in merged:
            u_t0 = sc[w0]['t']
            u_t1 = sc[w1]['t'] if w1 < len(sc) else t1
            if focus is None:
                sub = {'t0': u_t0, 't1': u_t1, 'layout': 'split', 'split': split_params}
            else:
                cx = cl['leftX'] if focus == 'left' else cl['rightX']
                x = int(round(max(0, min(width - crop_w, cx - crop_w / 2))))
                sub = {'t0': u_t0, 't1': u_t1, 'layout': 'track',
                       'track': [{'t': round(u_t0, 3), 'x': x}]}
            sub_prev = units[-1] if units else None
            # Avoid flicker: merge with previous identical layout
            if (sub_prev and sub_prev['layout'] == sub['layout']
                    and sub['layout'] == 'split' and sub_prev.get('split') == sub.get('split')):
                sub_prev['t1'] = sub['t1']
            else:
                units.append(sub)

    # Merge too-short units into their neighbor (no layout flicker)
    MIN_UNIT_SEC = 2.0
    cleaned = []
    for u in units:
        if cleaned and (u['t1'] - u['t0']) < MIN_UNIT_SEC:
            cleaned[-1]['t1'] = u['t1']
        elif not cleaned and (u['t1'] - u['t0']) < MIN_UNIT_SEC and len(units) > 1:
            u_copy = dict(u)
            cleaned.append(u_copy)  # short first unit absorbs into the next below
        else:
            cleaned.append(u)
    if len(cleaned) >= 2 and (cleaned[0]['t1'] - cleaned[0]['t0']) < MIN_UNIT_SEC:
        cleaned[1]['t0'] = cleaned[0]['t0']
        cleaned.pop(0)
    units = cleaned

    # Merge consecutive units that share layout (fewer ffmpeg parts, no fake cuts):
    # center+center always; split+split with same params; track+track by joining keyframes
    merged_units = []
    for u in units:
        prev = merged_units[-1] if merged_units else None
        if prev and prev['layout'] == u['layout']:
            if u['layout'] == 'center':
                prev['t1'] = u['t1']
                continue
            if u['layout'] == 'split' and prev.get('split') == u.get('split'):
                prev['t1'] = u['t1']
                continue
            if u['layout'] == 'track':
                prev['t1'] = u['t1']
                prev['track'] = (prev.get('track') or []) + (u.get('track') or [])
                continue
        merged_units.append(u)
    units = merged_units

    # Normalize: ensure full coverage and rounded times
    if units:
        units[0]['t0'] = 0.0
        for i in range(1, len(units)):
            units[i]['t0'] = units[i - 1]['t1']
        units[-1]['t1'] = round(duration, 3)
        for u in units:
            u['t0'], u['t1'] = round(u['t0'], 3), round(u['t1'], 3)
        units = [u for u in units if u['t1'] - u['t0'] > 0.05]
    else:
        units = [{'t0': 0.0, 't1': round(duration, 3), 'layout': 'center'}]

    plan['units'] = units
    json.dump(plan, open(args.out, 'w'))


if __name__ == '__main__':
    main()
