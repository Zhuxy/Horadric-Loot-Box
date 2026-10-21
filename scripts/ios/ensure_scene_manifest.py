#!/usr/bin/env python3
"""Enable Tao's scene lifecycle in the generated iOS Info.plist."""

import plistlib
import sys
from pathlib import Path


SCENE_MANIFEST = {
    "UIApplicationSupportsMultipleScenes": True,
    "UISceneConfigurations": {
        "UIWindowSceneSessionRoleApplication": [
            {
                "UISceneConfigurationName": "Default Configuration",
                "UISceneDelegateClassName": "TaoSceneDelegate",
            }
        ]
    },
}


def main() -> None:
    path = Path(sys.argv[1])
    with path.open("rb") as source:
        info = plistlib.load(source)
    if (
        info.get("UIApplicationSceneManifest") == SCENE_MANIFEST
        and info.get("UIFileSharingEnabled") is True
        and info.get("LSSupportsOpeningDocumentsInPlace") is True
    ):
        return
    info["UIApplicationSceneManifest"] = SCENE_MANIFEST
    info["UIFileSharingEnabled"] = True
    info["LSSupportsOpeningDocumentsInPlace"] = True
    with path.open("wb") as destination:
        plistlib.dump(info, destination)


if __name__ == "__main__":
    main()
