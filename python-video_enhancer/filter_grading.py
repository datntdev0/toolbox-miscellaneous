import argparse
import os
import shutil
import subprocess
import sys
import threading
from os import path as osp

from tqdm import tqdm

try:
    import ffmpeg
except ImportError:
    import pip
    pip.main(['install', '--user', 'ffmpeg-python'])
    import ffmpeg


# ---------------------------------------------------------------------------- #
#  NVIDIA hardware acceleration helpers
# ---------------------------------------------------------------------------- #
# Maps a software codec name (as reported by ffprobe) to the matching NVIDIA
# CUVID/NVDEC decoder. Anything not listed falls back to the generic `-hwaccel
# cuda` path, which still decodes on the GPU but lets ffmpeg pick the decoder.
NVDEC_DECODERS = {
    'h264': 'h264_cuvid',
    'hevc': 'hevc_cuvid',
    'h265': 'hevc_cuvid',
    'mpeg1video': 'mpeg1_cuvid',
    'mpeg2video': 'mpeg2_cuvid',
    'mpeg4': 'mpeg4_cuvid',
    'vc1': 'vc1_cuvid',
    'vp8': 'vp8_cuvid',
    'vp9': 'vp9_cuvid',
    'av1': 'av1_cuvid',
}

# Supported NVENC encoders.
NVENC_ENCODERS = {
    'h264': 'h264_nvenc',
    'hevc': 'hevc_nvenc',
    'h265': 'hevc_nvenc',
    'av1': 'av1_nvenc',
}


def get_video_meta_info(video_path, ffmpeg_bin='ffmpeg'):
    """Probe basic stream info so we can pick a matching NVDEC decoder."""
    ret = {}
    probe = ffmpeg.probe(video_path)
    video_streams = [s for s in probe['streams'] if s['codec_type'] == 'video']
    ret['has_audio'] = any(s['codec_type'] == 'audio' for s in probe['streams'])
    ret['codec_name'] = video_streams[0]['codec_name']
    ret['width'] = video_streams[0]['width']
    ret['height'] = video_streams[0]['height']
    # Duration in seconds, used to split the video into parallel segments.
    try:
        ret['duration'] = float(probe['format']['duration'])
    except (KeyError, ValueError):
        ret['duration'] = float(video_streams[0].get('duration', 0) or 0)
    # FPS and frame count, used to drive the progress bar.
    try:
        ret['fps'] = eval(video_streams[0]['avg_frame_rate'])
    except (KeyError, ZeroDivisionError, SyntaxError):
        ret['fps'] = 0
    nb_frames = video_streams[0].get('nb_frames')
    if nb_frames and str(nb_frames).isdigit():
        ret['nb_frames'] = int(nb_frames)
    else:
        ret['nb_frames'] = int(ret['duration'] * ret['fps']) if ret['fps'] else 0
    return ret


def count_gpus():
    """Count NVIDIA GPUs via nvidia-smi. Falls back to 1 if unavailable."""
    try:
        out = subprocess.run(
            ['nvidia-smi', '-L'], capture_output=True, text=True, check=False).stdout
        n = len([ln for ln in out.splitlines() if ln.strip().startswith('GPU ')])
        return max(n, 1)
    except FileNotFoundError:
        return 1


def detect_nvenc(ffmpeg_bin='ffmpeg'):
    """Return the set of NVENC encoders ffmpeg reports as available."""
    try:
        out = subprocess.run(
            [ffmpeg_bin, '-hide_banner', '-encoders'],
            capture_output=True, text=True, check=False).stdout
    except FileNotFoundError:
        print(f'Could not find ffmpeg binary: {ffmpeg_bin}')
        sys.exit(1)
    return {enc for enc in NVENC_ENCODERS.values() if enc in out}


# ---------------------------------------------------------------------------- #
#  Color grading
# ---------------------------------------------------------------------------- #
def build_filter_chain(args):
    """Build the ordered list of (filter_name, kwargs) used for grading.

    `curves` and `eq` are CPU filters, so decoded frames are pulled from GPU
    memory into system memory before they run (handled automatically by ffmpeg
    when `-hwaccel_output_format cuda` is NOT set on the input).
    """
    filters = []

    # ------------------------- curves (color grading) ------------------------ #
    if args.acv_file:
        filters.append(('curves', {'psfile': args.acv_file}))
    elif args.preset:
        filters.append(('curves', {'preset': args.preset}))
    elif args.curve_m or args.curve_r or args.curve_g or args.curve_b:
        curve_kwargs = {}
        if args.curve_m:
            curve_kwargs['m'] = args.curve_m
        if args.curve_r:
            curve_kwargs['r'] = args.curve_r
        if args.curve_g:
            curve_kwargs['g'] = args.curve_g
        if args.curve_b:
            curve_kwargs['b'] = args.curve_b
        filters.append(('curves', curve_kwargs))
    else:
        # A gentle default cinematic look: lift shadows, lower blue highlights.
        filters.append(('curves', {
            'm': '0/0 0.5/0.4 1/1',
            'r': '0/0 0.2/0.25 1/1',
            'b': '0/0 0.8/0.75 1/1',
        }))

    # ------------------------- eq (optional fine tune) ----------------------- #
    eq_kwargs = {}
    if args.brightness is not None:
        eq_kwargs['brightness'] = args.brightness
    if args.contrast is not None:
        eq_kwargs['contrast'] = args.contrast
    if args.saturation is not None:
        eq_kwargs['saturation'] = args.saturation
    if args.gamma is not None:
        eq_kwargs['gamma'] = args.gamma
    if eq_kwargs:
        filters.append(('eq', eq_kwargs))

    return filters


def resolve_output_path(args):
    """Resolve --output into a concrete file path.

    Accepts either a full file path (e.g. ``output/clip.mp4``) or a directory,
    in which case the filename is derived from the input name + suffix.
    """
    out = args.output
    video_name = osp.splitext(os.path.basename(args.input))[0]
    # Treat as a directory if it has no extension or already exists as a dir.
    is_dir = osp.isdir(out) or osp.splitext(out)[1] == ''
    if is_dir:
        os.makedirs(out, exist_ok=True)
        return osp.join(out, f'{video_name}_{args.suffix}.mp4')
    parent = osp.dirname(out)
    if parent:
        os.makedirs(parent, exist_ok=True)
    return out


def build_grade_command(args, output_path, meta, use_hwaccel, target_encoder,
                        gpu_id=None, ss=None, to=None):
    """Compile the ffmpeg command for grading (a whole video or one segment).

    When ``ss``/``to`` are given the worker only decodes that time range; when
    ``gpu_id`` is given decode + encode are pinned to that GPU.
    """
    # ----------------------------- input stream ----------------------------- #
    input_kwargs = {}
    if ss is not None:
        input_kwargs['ss'] = ss
    if to is not None:
        input_kwargs['to'] = to
    if use_hwaccel:
        # `-hwaccel cuda` decodes on the GPU. We deliberately do NOT set
        # `hwaccel_output_format=cuda` so frames land in system memory where the
        # CPU `curves`/`eq` filters can operate on them.
        input_kwargs['hwaccel'] = 'cuda'
        if gpu_id is not None:
            input_kwargs['hwaccel_device'] = gpu_id
        decoder = NVDEC_DECODERS.get(meta['codec_name'])
        if decoder and decoder in _list_decoders(args.ffmpeg_bin):
            input_kwargs['vcodec'] = decoder

    stream = ffmpeg.input(args.input, **input_kwargs)
    audio = stream.audio if meta['has_audio'] else None
    video = stream.video

    # ------------------------------ grading ---------------------------------- #
    for name, kwargs in build_filter_chain(args):
        video = ffmpeg.filter(video, name, **kwargs)

    # ----------------------------- output stream ---------------------------- #
    output_kwargs = {
        'pix_fmt': 'yuv420p',
        'loglevel': args.loglevel,
    }
    if use_hwaccel:
        output_kwargs['vcodec'] = target_encoder
        output_kwargs['preset'] = args.nvenc_preset    # p1 (fastest) .. p7 (slowest/best)
        output_kwargs['rc'] = 'vbr'
        output_kwargs['cq'] = args.cq                  # constant quality, lower = better
        output_kwargs['b:v'] = '0'                     # let CQ drive the bitrate
        if gpu_id is not None:
            output_kwargs['gpu'] = gpu_id
    else:
        output_kwargs['vcodec'] = 'libx264'
        output_kwargs['crf'] = args.cq

    if audio is not None:
        output_kwargs['acodec'] = 'copy'
        out = ffmpeg.output(video, audio, output_path, **output_kwargs)
    else:
        out = ffmpeg.output(video, output_path, **output_kwargs)

    # Emit machine-readable progress on stdout and suppress ffmpeg's own stats
    # line; the verbose config dump is kept out of the console (loglevel=error).
    out = out.global_args('-nostats', '-progress', 'pipe:1')
    return ffmpeg.compile(out, cmd=args.ffmpeg_bin, overwrite_output=True)


def run_ffmpeg_with_progress(cmd, pbar, lock, log_path):
    """Run an ffmpeg command, parsing `-progress` output to advance `pbar`.

    stderr (errors / the config dump) is redirected to `log_path` so the
    console only shows the frame progress bar. Returns the exit code.
    """
    last = 0
    with open(log_path, 'w', encoding='utf-8') as logf:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=logf, text=True)
        for line in proc.stdout:
            line = line.strip()
            if line.startswith('frame='):
                try:
                    cur = int(line.split('=', 1)[1])
                except ValueError:
                    continue
                with lock:
                    pbar.update(max(0, cur - last))
                last = cur
        proc.wait()
    return proc.returncode


def run(args):
    video_save_path = resolve_output_path(args)
    meta = get_video_meta_info(args.input, args.ffmpeg_bin)

    # -------------------------- decide acceleration -------------------------- #
    use_hwaccel = not args.no_hwaccel
    available_nvenc = detect_nvenc(args.ffmpeg_bin) if use_hwaccel else set()

    target_encoder = NVENC_ENCODERS.get(args.encoder, 'h264_nvenc')
    if use_hwaccel and target_encoder not in available_nvenc:
        print(f'NVENC encoder "{target_encoder}" not available in this ffmpeg build. '
              'Falling back to CPU (libx264). Re-run with --no_hwaccel to silence this.')
        use_hwaccel = False

    # ------------------------- decide parallelism ---------------------------- #
    num_gpus = count_gpus() if use_hwaccel else 1
    num_process = max(1, num_gpus * args.num_process_per_gpu)
    if num_process > 1 and meta['duration'] <= 0:
        print('Could not determine video duration; falling back to single process.')
        num_process = 1

    # ----------------------------- single process ---------------------------- #
    if num_process == 1:
        out_dir = osp.dirname(video_save_path) or '.'
        os.makedirs(out_dir, exist_ok=True)
        log_path = osp.join(out_dir, osp.splitext(os.path.basename(video_save_path))[0] + '.log')
        cmd = build_grade_command(args, video_save_path, meta, use_hwaccel, target_encoder)
        pbar = tqdm(total=meta['nb_frames'] or None, unit='frame', desc='grading')
        code = run_ffmpeg_with_progress(cmd, pbar, threading.Lock(), log_path)
        pbar.close()
        if code != 0:
            raise RuntimeError(f'Grading failed (exit {code}). See log: {log_path}')
        print(f'Done. Saved to {video_save_path}')
        return

    # ----------------------------- multi process ----------------------------- #
    # The video is split into time segments graded concurrently, then
    # concatenated. The temp segment dir is KEPT (not deleted) so failed runs
    # can be inspected and reruns resume only the missing segments.
    print(f'GPUs: {num_gpus}, processes: {num_process}, duration: {meta["duration"]:.1f}s')
    out_dir = osp.dirname(video_save_path) or '.'
    video_name = osp.splitext(os.path.basename(video_save_path))[0]
    tmp_dir = osp.join(out_dir, f'{video_name}_tmp_segments')
    os.makedirs(tmp_dir, exist_ok=True)

    part = meta['duration'] / num_process
    seg_paths = [osp.join(tmp_dir, f'{i:03d}.mp4') for i in range(num_process)]

    pbar = tqdm(total=meta['nb_frames'] or None, unit='frame', desc='grading')
    lock = threading.Lock()
    results = {}

    def worker(i):
        seg_path = seg_paths[i]
        # Resume: a completed (renamed) segment already exists -> skip it.
        if osp.isfile(seg_path) and not args.force:
            results[i] = 0
            return
        ss = part * i
        to = None if i == num_process - 1 else part * (i + 1)
        gpu_id = (i % num_gpus) if use_hwaccel else None
        # Write to a .partial.mp4 file (keeping a real extension so ffmpeg can
        # pick the muxer); rename to the final name only on success so an
        # interrupted segment is never mistaken for a completed one.
        partial = osp.join(tmp_dir, f'{i:03d}.partial.mp4')
        log_path = osp.join(tmp_dir, f'{i:03d}.log')
        cmd = build_grade_command(
            args, partial, meta, use_hwaccel, target_encoder, gpu_id=gpu_id, ss=ss, to=to)
        code = run_ffmpeg_with_progress(cmd, pbar, lock, log_path)
        if code == 0:
            os.replace(partial, seg_path)
        results[i] = code

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_process)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    pbar.close()

    failed = [i for i in range(num_process) if results.get(i) != 0]
    if failed:
        logs = ', '.join(osp.join(tmp_dir, f'{i:03d}.log') for i in failed)
        raise RuntimeError(
            f'Grading failed for segment(s): {failed}. Logs: {logs}. '
            f'Fix the issue and rerun the same command to resume the missing segments.')

    # ------------------------------- concat ---------------------------------- #
    list_path = osp.join(tmp_dir, 'segments.txt')
    with open(list_path, 'w') as f:
        for seg in seg_paths:
            f.write(f"file '{osp.abspath(seg)}'\n")

    concat_cmd = [
        args.ffmpeg_bin, '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', list_path, '-c', 'copy', video_save_path,
    ]
    subprocess.run(concat_cmd, check=True)
    print(f'Done. Saved to {video_save_path}')

    if args.cleanup:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    else:
        print(f'Temp segments kept in: {tmp_dir} (pass --cleanup to remove)')


def _list_decoders(ffmpeg_bin='ffmpeg'):
    out = subprocess.run(
        [ffmpeg_bin, '-hide_banner', '-decoders'],
        capture_output=True, text=True, check=False).stdout
    return out


def main():
    """Color grading for video using ffmpeg, accelerated with the NVIDIA
    encoder/decoder (NVDEC for decode, NVENC for encode).

    The grade itself (curves / eq) runs on the CPU, but decode and encode — the
    expensive parts — run on the GPU.
    """
    parser = argparse.ArgumentParser(description='GPU-accelerated video color grading.')
    parser.add_argument('-i', '--input', type=str, default='input.mp4', help='Input video file')
    parser.add_argument(
        '-o', '--output', type=str, default='output',
        help='Output file path (e.g. output/clip.mp4). If a folder is given, the '
             'filename is derived from the input name + --suffix.')
    parser.add_argument('--suffix', type=str, default='graded',
                        help='Suffix used only when --output is a folder')

    # --------------------------- grading options ---------------------------- #
    parser.add_argument(
        '-p', '--preset', type=str, default=None,
        choices=['none', 'color_negative', 'cross_process', 'darker', 'increase_contrast',
                 'lighter', 'linear_contrast', 'medium_contrast', 'negative',
                 'strong_contrast', 'vintage'],
        help='Built-in ffmpeg curves preset. One of: none, color_negative, cross_process, '
             'darker, increase_contrast, lighter, linear_contrast, medium_contrast, '
             'negative, strong_contrast, vintage')
    parser.add_argument('--acv_file', type=str, default=None, help='Path to a Photoshop .acv curves file')
    parser.add_argument('--curve_m', type=str, default=None, help="Master curve points, e.g. '0/0 0.5/0.4 1/1'")
    parser.add_argument('--curve_r', type=str, default=None, help='Red channel curve points')
    parser.add_argument('--curve_g', type=str, default=None, help='Green channel curve points')
    parser.add_argument('--curve_b', type=str, default=None, help='Blue channel curve points')

    # --------------------------- eq fine tuning ----------------------------- #
    parser.add_argument('--brightness', type=float, default=None, help='eq brightness (-1.0 .. 1.0)')
    parser.add_argument('--contrast', type=float, default=None, help='eq contrast (-2.0 .. 2.0, 1.0 = none)')
    parser.add_argument('--saturation', type=float, default=None, help='eq saturation (0.0 .. 3.0, 1.0 = none)')
    parser.add_argument('--gamma', type=float, default=None, help='eq gamma (0.1 .. 10.0, 1.0 = none)')

    # --------------------------- encode / hwaccel ---------------------------- #
    parser.add_argument(
        '--encoder', type=str, default='h264', choices=['h264', 'hevc', 'h265', 'av1'],
        help='Target codec. Maps to the matching NVENC encoder (h264_nvenc / hevc_nvenc / av1_nvenc).')
    parser.add_argument(
        '--nvenc_preset', type=str, default='p5',
        help='NVENC preset p1 (fastest) .. p7 (slowest/best quality). Default: p5')
    parser.add_argument(
        '--cq', type=int, default=23,
        help='Quality level. For NVENC this is -cq, for libx264 it is -crf. Lower = better. Default: 23')
    parser.add_argument('--no_hwaccel', action='store_true', help='Disable NVIDIA acceleration, use CPU libx264')
    parser.add_argument(
        '--num_process_per_gpu', type=int, default=1,
        help='Number of parallel grading processes per GPU. The video is split into '
             '(num_gpus * this) time segments, graded concurrently, then concatenated. '
             'Increase to better saturate CPU filtering + NVENC sessions. Default: 1')
    parser.add_argument(
        '--force', action='store_true',
        help='Reprocess all segments even if completed ones already exist (disables resume)')
    parser.add_argument(
        '--cleanup', action='store_true',
        help='Delete the temp segment dir after a successful run. Default: keep it for '
             'debugging / resuming failed segments.')
    parser.add_argument('--ffmpeg_bin', type=str, default='ffmpeg', help='Path to ffmpeg')
    parser.add_argument('--loglevel', type=str, default='error', help='ffmpeg log level (error | warning | info)')

    args = parser.parse_args()
    args.input = args.input.rstrip('/').rstrip('\\')
    run(args)


if __name__ == '__main__':
    main()
