#!/usr/bin/env bun

import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { extract } from 'tar';

const PLATFORM_MAPPINGS = {
  'arm64-darwin': {
    assetPattern: 'aarch64-apple-darwin',
    format: 'tar.gz',
    executable: 'rg',
  },
  'x64-darwin': {
    assetPattern: 'x86_64-apple-darwin',
    format: 'tar.gz',
    executable: 'rg',
  },
  'arm64-linux': {
    assetPattern: 'aarch64-unknown-linux-gnu',
    format: 'tar.gz',
    executable: 'rg',
  },
  'x64-linux': {
    assetPattern: 'x86_64-unknown-linux-gnu',
    format: 'tar.gz',
    executable: 'rg',
  },
  'x64-win32': {
    assetPattern: 'x86_64-pc-windows-msvc',
    format: 'zip',
    executable: 'rg.exe',
  },
} as const;

async function fetchLatestVersion(): Promise<string> {
  console.log('→ Fetching latest ripgrep version...');
  const response = await fetch(
    'https://api.github.com/repos/BurntSushi/ripgrep/releases/latest',
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch latest version: ${response.statusText}`);
  }
  const data = await response.json();
  const version = data.tag_name.replace(/^v/, '');
  console.log(`✓ Latest version: ${version}`);
  return version;
}

async function downloadAndExtract(
  assetName: string,
  downloadUrl: string,
  platform: string,
  vendorDir: string,
): Promise<void> {
  const platformDir = path.join(vendorDir, platform);
  const config = PLATFORM_MAPPINGS[platform as keyof typeof PLATFORM_MAPPINGS];
  const tmpDir = path.join(vendorDir, '.tmp', platform);

  console.log(`\n→ Processing ${platform}...`);
  console.log(`  Asset: ${assetName}`);

  await mkdir(tmpDir, { recursive: true });

  try {
    // Download
    console.log(`  Downloading...`);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    const tmpFile = path.join(tmpDir, assetName);
    const fileStream = createWriteStream(tmpFile);
    // @ts-ignore
    await pipeline(response.body, fileStream);

    // Extract
    console.log(`  Extracting...`);
    if (config.format === 'zip') {
      const proc = Bun.spawn(['unzip', '-q', tmpFile, '-d', tmpDir]);
      await proc.exited;
    } else {
      await extract({ file: tmpFile, cwd: tmpDir });
    }

    // Find extracted directory
    const files = await Array.fromAsync(
      new Bun.Glob('*').scan({ cwd: tmpDir, onlyFiles: false }),
    );
    const extractedDir = files.find((f) => f !== path.basename(tmpFile));
    if (!extractedDir) throw new Error('Extract failed');

    const rgPath = path.join(tmpDir, extractedDir, config.executable);
    if (!existsSync(rgPath)) {
      throw new Error(`Executable not found: ${rgPath}`);
    }

    // Install
    if (existsSync(platformDir)) {
      await rm(platformDir, { recursive: true, force: true });
    }
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      path.join(platformDir, config.executable),
      Bun.file(rgPath),
    );

    // Make executable on Unix
    if (config.format !== 'zip') {
      await Bun.spawn([
        'chmod',
        '+x',
        path.join(platformDir, config.executable),
      ]);
    }

    console.log(`✓ Installed to ${platformDir}`);
  } finally {
    if (existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n🔧 Updating Ripgrep\n');

  const vendorDir = path.join(process.cwd(), 'vendor', 'ripgrep');
  const version = await fetchLatestVersion();

  // Fetch release
  const response = await fetch(
    `https://api.github.com/repos/BurntSushi/ripgrep/releases/tags/${version}`,
  );
  if (!response.ok) throw new Error('Failed to fetch release');
  const data = await response.json();

  // Download each platform
  for (const [platform, config] of Object.entries(PLATFORM_MAPPINGS)) {
    const asset = data.assets.find(
      (a: any) =>
        a.name.includes(config.assetPattern) &&
        a.name.endsWith(`.${config.format}`),
    );
    if (!asset) {
      console.log(`⚠ No asset found for ${platform}`);
      continue;
    }
    await downloadAndExtract(
      asset.name,
      asset.browser_download_url,
      platform,
      vendorDir,
    );
  }

  // Update COPYING file
  console.log('\n→ Updating COPYING file...');
  const copyingRes = await fetch(
    `https://raw.githubusercontent.com/BurntSushi/ripgrep/${version}/COPYING`,
  );
  if (copyingRes.ok) {
    await Bun.write(path.join(vendorDir, 'COPYING'), await copyingRes.text());
    console.log('✓ Updated COPYING');
  }

  // Cleanup
  const tmpDir = path.join(vendorDir, '.tmp');
  if (existsSync(tmpDir)) {
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n✅ Successfully updated ripgrep to ${version}\n`);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
