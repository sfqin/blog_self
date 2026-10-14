#!/usr/bin/env python3
"""Exercise the real macOS binary selectors without starting the user's blog."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MacBinarySelectionTest(unittest.TestCase):
    def select(self, launcher, machine, available, inside_app=False):
        source = (ROOT / launcher).read_text()
        start = source.index('ARCH="')
        end = source.index('\n[ -n "$BIN" ]' if inside_app else '\nif [ -z "$BIN" ]', start)
        selector = source[start:end]
        # Replace only the host query; run the selector from the shipped script.
        selector = selector.replace('$(/usr/bin/uname -m)', '${TEST_MACHINE}')
        selector = selector.replace('$(uname -m)', '${TEST_MACHINE}')
        with tempfile.TemporaryDirectory(prefix='blog-launcher-test-') as temp:
            root = Path(temp)
            resources = root / 'Start-Blog.app/Contents/Resources'
            binary_dir = resources if inside_app else root / 'bin'
            binary_dir.mkdir(parents=True)
            for arch in available:
                binary = binary_dir / ('blog-macos-' + arch)
                binary.touch()
                binary.chmod(0o755)
            result = subprocess.run(
                ['bash', '-eu', '-c', selector + '\nprintf "%s" "$BIN"'],
                cwd=root,
                env={**os.environ, 'TEST_MACHINE': machine, 'RES': str(resources)},
                text=True, capture_output=True, check=True,
            )
            return Path(result.stdout).name if result.stdout else ''

    def test_matching_binary_with_both_architectures_present(self):
        for launcher, inside_app in [('packaging/mac/launch', True), ('Start-Blog.command', False)]:
            for machine, arch in [('arm64', 'arm64'), ('x86_64', 'amd64')]:
                with self.subTest(launcher=launcher, machine=machine):
                    self.assertEqual(self.select(launcher, machine, ['arm64', 'amd64'], inside_app),
                                     'blog-macos-' + arch)

    def test_missing_native_binary_does_not_select_wrong_architecture(self):
        for launcher, inside_app in [('packaging/mac/launch', True), ('Start-Blog.command', False)]:
            for machine, available in [('arm64', ['amd64']), ('x86_64', ['arm64'])]:
                with self.subTest(launcher=launcher, machine=machine):
                    self.assertEqual(self.select(launcher, machine, available, inside_app), '')


if __name__ == '__main__':
    unittest.main()
