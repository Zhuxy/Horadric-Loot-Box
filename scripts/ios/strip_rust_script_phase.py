#!/usr/bin/env python3
"""Remove the "Build Rust Code" pre-build script phase from gen/apple/project.yml.

The generated Xcode project compiles the Rust library through a script phase
that calls back into the Tauri CLI (`tauri ios xcode-script`). That callback
needs the CLI's options WebSocket server, which only exists while
`tauri ios build/dev` is running — a bare xcodebuild build panics there
(read_options ends in .expect("failed to read CLI options")).
`make ios` pre-builds libapp.a itself, so the script phase must go.
Idempotent: does nothing when the phase is already absent.
"""
import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines(keepends=True)

start = None
for i, line in enumerate(lines):
    if line.strip() == "preBuildScripts:":
        start = i
        break
if start is None:
    sys.exit(0)

# In the generated template the block runs to EOF (last block of the last
# target). Refuse to guess if anything unexpected follows it.
for line in lines[start + 1:]:
    if line.strip() and not line.startswith("      "):
        sys.exit(f"unexpected content after preBuildScripts block: {line!r}")

del lines[start:]
open(path, "w", encoding="utf-8").write("".join(lines))
print(f"stripped preBuildScripts block from {path}")
