"""Validate the Android identity reported by `aapt dump badging`."""

import argparse
import re
import sys


APPLICATION_ID = 'com.remoteshieldx.browser'
LAUNCHER = f'{APPLICATION_ID}.MainActivity'
TARGET_SDK = '36'


def verify_badging(badging, version_name, version_code):
    def require(pattern, description):
        if not re.search(pattern, badging, re.MULTILINE):
            raise ValueError(f'Expected {description}')

    # aapt reports package identity and version together on a single line.
    require(
        rf"^package: name='{re.escape(APPLICATION_ID)}' versionCode='{version_code}' "
        rf"versionName='{re.escape(version_name)}'(?:[ \t]|\r?$)",
        f'package {APPLICATION_ID} version {version_name} ({version_code})',
    )
    require(
        rf"^launchable-activity: name='{re.escape(LAUNCHER)}'(?:[ \t]|\r?$)",
        f'launcher {LAUNCHER}',
    )
    require(rf"^targetSdkVersion:'{TARGET_SDK}'\r?$", f'target SDK {TARGET_SDK}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', help='APK filename used in diagnostics')
    parser.add_argument('version_name')
    parser.add_argument('version_code', type=int)
    args = parser.parse_args()
    try:
        verify_badging(sys.stdin.read(), args.version_name, args.version_code)
    except ValueError as error:
        parser.exit(1, f'{args.apk}: {error}\n')


if __name__ == '__main__':
    main()
