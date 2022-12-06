import { execa, execaNode } from 'execa';
import fs from 'node:fs';
import { oraPromise } from 'ora';

async function moveBinaries() {
  let extension = '';

  if (process.platform === 'win32') {
    extension = '.exe'
  }

  const rustInfo = (await execa('rustc', ['-vV'])).stdout;
  const targetTriple = /host: (\S+)/g.exec(rustInfo)[1];

  if (!targetTriple) {
    console.error('Failed to determine platform target triple')
  }

  fs.renameSync(
    `src-tauri/binaries/fc-core${extension}`,
    `src-tauri/binaries/fc-core-${targetTriple}${extension}`
  );
}

async function createBundle() {
  return execa('node_modules/.bin/esbuild', [
    './server/index.cjs', '--bundle', '--outfile=dist/server.js', '--platform=node'
  ]);
}


async function flattenBuild() {
  // return execa('node_modules/.bin/pkg', ['package.json', '--output', 'src-tauri/binaries/fc-core']);
  try {
    return execaNode('modules/flatten-directory/dist/index.js', [
        '--rootdir=../../Releases/Client/Windows',
        '--outputdir=client-flattened',
        '--seperator=@'
    ])
    } catch (e) {
        throw e;
    }
}

(async function main() {
    oraPromise({ 
        text: '[FC_SCRIPTS] Flattening Client Build...\n', 
        successText: '[FC_SCRIPTS] Done\n', 
        failText: '[FC_SCRIPTS] Cannot build server'
})
    await flattenBuild()

    // await createServerPackage();
    // await moveBinaries();
})();
// oraPromise(main(actionText), { text: `[FC_SCRIPTS] ${actionText}...\n`, successText: '[FC_SCRIPTS] Done\n', failText: '[FC_SCRIPTS] Cannot build server'});
