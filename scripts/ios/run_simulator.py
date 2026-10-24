#!/usr/bin/env python3
"""Build an unsigned simulator app and launch it in the selected Xcode's UI."""

import argparse
import json
import platform
import re
import shlex
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APPLE = ROOT / "src-tauri/gen/apple"

# `make ios` removes this phase because it builds Rust before invoking Xcode.
# Restore the Tauri-generated phase before using `tauri ios build` again.
RUST_PHASE = '''    preBuildScripts:
      - script: npm run -- tauri ios xcode-script -v --platform ${PLATFORM_DISPLAY_NAME:?} --sdk-root ${SDKROOT:?} --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" --header-search-paths "${HEADER_SEARCH_PATHS:?}" --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" --configuration ${CONFIGURATION:?} ${FORCE_COLOR} ${ARCHS:?}
        name: Build Rust Code
        basedOnDependencyAnalysis: false
        outputFiles:
          - $(SRCROOT)/Externals/x86_64/${CONFIGURATION}/libapp.a
          - $(SRCROOT)/Externals/arm64/${CONFIGURATION}/libapp.a
'''


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def output(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def select_device(selector: str) -> dict:
    runtimes = json.loads(output("xcrun", "simctl", "list", "devices", "available", "--json"))["devices"]
    # A device name may exist in more than one runtime; use the newest iOS.
    for runtime in sorted(runtimes, key=lambda key: tuple(map(int, re.findall(r"\d+", key))), reverse=True):
        if ".iOS-" not in runtime:
            continue
        for device in runtimes[runtime]:
            if selector in (device["name"], device["udid"]):
                return device
    raise SystemExit(f"No available iOS simulator matches {selector!r}. Run: xcrun simctl list devices available")


def prepare_project(npm: list[str]) -> None:
    project = APPLE / "project.yml"
    if not project.exists():
        run(*npm, "run", "tauri", "--", "ios", "init", "--ci")

    config = json.loads((ROOT / "src-tauri/tauri.ios.conf.json").read_text())
    minimum = config["bundle"]["iOS"]["minimumSystemVersion"]
    text = project.read_text()
    text = re.sub(r"(?m)^    iOS: .+$", f"    iOS: {minimum}", text, count=1)
    # Static libraries are linked via dependencies, not bundled as resources.
    # Otherwise debug and release libapp.a both copy to the same app path.
    text = re.sub(
        r"(?m)^(      - path: Externals)\n(?:        buildPhase: [^\n]+\n)?",
        r"\1\n        buildPhase: none\n", text, count=1,
    )
    if "ios xcode-script" not in text:
        if "    preBuildScripts:" in text:
            raise SystemExit(f"Restore the Tauri Build Rust Code phase in {project} before building.")
        text = text.rstrip() + "\n" + RUST_PHASE
    if text != project.read_text():
        project.write_text(text)
    run("xcodegen", "generate", cwd=APPLE)
    run("python3", "scripts/ios/ensure_scene_manifest.py", str(APPLE / "horadric-loot-box_iOS/Info.plist"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="iPhone 18 Pro", help="Simulator name or UUID")
    parser.add_argument("--npm", default="npm")
    parser.add_argument("--open", default="open")
    args = parser.parse_args()
    if platform.system() != "Darwin":
        raise SystemExit("The iOS simulator requires macOS and Xcode.")

    developer = Path(output("xcode-select", "-p"))
    ui = next((path for path in (
        developer.parent / "Applications/DeviceHub.app",
        developer / "Applications/Simulator.app",
    ) if path.is_dir()), None)
    if ui is None:
        raise SystemExit(f"Device Hub / Simulator was not found in the selected Xcode: {developer}")

    device = select_device(args.device)
    udid = device["udid"]
    print(f"==> Opening {ui.stem}: {device['name']} ({udid})", flush=True)
    if device["state"] == "Shutdown":
        run("xcrun", "simctl", "boot", udid)
    run(*shlex.split(args.open), str(ui))
    run("xcrun", "simctl", "bootstatus", udid, "-b")

    npm = shlex.split(args.npm)
    prepare_project(npm)
    target, folder = ("aarch64-sim", "arm64-sim") if platform.machine() == "arm64" else ("x86_64", "x86_64")
    rust_target = "aarch64-apple-ios-sim" if target == "aarch64-sim" else "x86_64-apple-ios"
    if rust_target not in output("rustup", "target", "list", "--installed").splitlines():
        run("rustup", "target", "add", rust_target)
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    app = APPLE / "build" / folder / f"{config['productName']}.app"
    # Tauri moves the archived simulator app here without replacing an existing
    # bundle. Remove only the generated bundle so repeated builds can finish.
    if app.is_dir():
        shutil.rmtree(app)
    print("==> Building the simulator app (bundled frontend, no signing)", flush=True)
    run(*npm, "run", "tauri", "--", "ios", "build", "--debug", "--target", target, "--no-sign")

    if not app.is_dir():
        raise SystemExit(f"Simulator app not found: {app}")
    print(f"==> Installing and launching {config['productName']}", flush=True)
    run("xcrun", "simctl", "install", udid, str(app))
    run("xcrun", "simctl", "launch", "--terminate-running-process", udid, config["identifier"])
    print(f"==> Running on {device['name']} in {ui.stem}.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode) from error
