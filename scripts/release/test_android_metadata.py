import unittest

from android_metadata import verify_badging


class AndroidMetadataTests(unittest.TestCase):
    valid = """\
package: name='com.remoteshieldx.browser' versionCode='12345' versionName='2.5.0-rc.1' compileSdkVersion='36'
sdkVersion:'26'
targetSdkVersion:'36'
application-label:'RemoteShield X'
launchable-activity: name='com.remoteshieldx.browser.MainActivity'  label='' icon=''
"""

    def test_accepts_expected_android_build(self):
        verify_badging(self.valid, '2.5.0-rc.1', 12345)

    def test_rejects_wrong_package_launcher_sdk_and_version(self):
        mismatches = [
            ("name='com.remoteshieldx.browser'", "name='com.example.android'", 'package'),
            ('com.remoteshieldx.browser.MainActivity', 'io.flutter.embedding.android.FlutterActivity', 'launcher'),
            ('com.remoteshieldx.browser.MainActivity', 'com.example.MainActivity', 'launcher'),
            ("targetSdkVersion:'36'", "targetSdkVersion:'34'", 'target SDK'),
            ("versionCode='12345'", "versionCode='12346'", 'version'),
            ("versionName='2.5.0-rc.1'", "versionName='1.0.0'", 'version'),
        ]
        for expected, wrong, message in mismatches:
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, message):
                verify_badging(self.valid.replace(expected, wrong), '2.5.0-rc.1', 12345)


if __name__ == '__main__':
    unittest.main()
