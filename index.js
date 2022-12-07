import { execa, execaNode } from 'execa';
import fs from 'node:fs';
import { oraPromise } from 'ora';

let clientDist = '../../Releases/Client/Windows'

async function writeMerkleTreeToStorage(data) {
    // Preserve newlines, etc. - use valid JSON
    // data = data.replace(/\\n/g, "\\n")
    // .replace(/\\'/g, "\\'")
    // .replace(/\\"/g, '\\"')
    // .replace(/\\&/g, "\\&")
    // .replace(/\\r/g, "\\r")
    // .replace(/\\t/g, "\\t")
    // .replace(/\\b/g, "\\b")
    // .replace(/\\f/g, "\\f")
    // // .replace(/\\n/g, "");
    // // Remove non-printable and other non-valid JSON characters
    // data = data.replace(/[\u0000-\u0019]+/g,"");
    console.log(data)
    fs.writeFileSync("merkle.json", JSON.stringify(data, null, 2) , 'utf-8');
    let tree = JSON.parse(fs.readFileSync("merkle.json", "utf8"))
    console.log(tree.name)

    // fs.writeFile("merkle.json", JSON.stringify(data, null, "\t"), (err) => {
    //     if (err)
    //         console.log(err);
    //     else {
    //         console.log("File written successfully\n");
    //         console.log("The written has the following contents:");
    //         // console.log(JSON.parse(fs.readFileSync("merkle.json", "utf8")));
    //     }
    // });
}

async function constructMerkleTree() {
    return execa('node_modules/.bin/folder-hash', [
        `${clientDist}`
    ]);
}


async function flattenBuild() {
  try {
    return execaNode('modules/flatten-directory/dist/index.js', [
        `--rootdir=${clientDist}`,
        '--outputdir=client-flattened',
        '--seperator=@'
    ])
    } catch (e) {
        throw e;
    }
}

async function main() {
    console.log('############################################')
    console.log('Constructing Merkle Tree..')
    console.log('############################################')
    let merkleTree = await constructMerkleTree()
    // console.log(merkleTree.stdout.toString())

    console.log('############################################')
    console.log('Writing Merkle Tree to File: [merkle.json].')
    console.log('############################################')
    await writeMerkleTreeToStorage(merkleTree)

    console.log('############################################')
    console.log('Flattening Client Build..')
    console.log('############################################')
    await flattenBuild()


    // await createServerPackage();
    // await moveBinaries();
}
oraPromise(main(), { text: `[FC_SCRIPTS] Integrating Build...\n`, successText: '[FC_SCRIPTS] Done\n', failText: '[FC_SCRIPTS] Cannot build server'});
