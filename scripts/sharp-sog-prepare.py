"""Run SHARP for one image and write local publisher scene intermediates.

This is intentionally a local workstation script. It reuses the SHARP
environment from ImmersiveMemories but writes output into ImmersiveGallery.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--memory-root", default=os.environ.get("MEMORIES_ROOT", r"E:\git\ImmersiveMemories"))
    ap.add_argument("--image", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--focal", type=float, default=None)
    ap.add_argument("--max-gaussians", type=int, default=None)
    args = ap.parse_args()

    memory_root = Path(args.memory_root).resolve()
    sys.path.insert(0, str(memory_root / "pipeline"))

    # Keep model/checkpoint caches on E: with the local workstation setup.
    os.environ.setdefault("TORCH_HOME", str(memory_root / "models" / "torch"))
    os.environ.setdefault("HF_HOME", str(memory_root / "models" / "huggingface"))

    from sharp_runner import SharpRunner  # noqa: PLC0415
    from plytools import normalize_ply  # noqa: PLC0415
    from PIL import Image, ImageOps  # noqa: PLC0415

    image = Path(args.image).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    thumb = out_dir / "thumb.jpg"
    with Image.open(image) as im:
      im = ImageOps.exif_transpose(im).convert("RGB")
      im.thumbnail((900, 900))
      im.save(thumb, "JPEG", quality=86)

    runner = SharpRunner(device="cuda")
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.ply"
        runner.predict(image, raw, focal_mm=args.focal)
        count = normalize_ply(raw, out_dir / "scene.ply", max_gaussians=args.max_gaussians)

    print(json.dumps({
        "ok": True,
        "splatCount": count,
        "ply": str(out_dir / "scene.ply"),
        "thumb": str(thumb),
    }))


if __name__ == "__main__":
    main()
