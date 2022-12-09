import * as dotenv from 'dotenv'
dotenv.config()
import { execa, execaNode } from 'execa';
import fs from 'node:fs';
import https from 'node:https'
import { oraPromise } from 'ora';
import { traverse } from 'object-traversal';
import { Octokit } from "@octokit/rest"

let clientDist = '../../Releases/Client/Windows'
let basePath = 'space/'
const octokit = new Octokit({ auth: process.env.PAT })

// Get Release Assets IDs 
let releaseAssets = await getClientReleaseAssets()
let assetsMapping = {}
for (let asset in releaseAssets) {
    assetsMapping[`${releaseAssets[asset].name}`] = releaseAssets[asset].id
}

async function writeMerkleTreeToStorage(data) {
    fs.writeFileSync(`${basePath}merkle.json`, data, "utf-8");
}

function traverseTree(tree) {
    let mapping = {}
    let hashes = []
    function getMapping({ parent, key, value, meta }) {
        if (value.name && value.name.includes('.')) {
            let ancestors = meta.nodePath.split('.')
            ancestors = ancestors
            .filter(v => {
                if(!/^\d+$/.test(v)) return v
            })
            .map((v) => {
                return v.split('@')[0]
            })
            .filter(val => val !== 'Windows')
            .join('@')

            mapping[`${value.hash}`] = ancestors ? ancestors + '@' + value.name : value.name
            hashes.push(value.hash)
        }
    }
    traverse(tree, getMapping, { traversalType: 'breadth-first' });
    return {mapping, hashes}
}

async function constructMerkleTree() {
    return execa('modules/node-folder-hash/bin/folder-hash', [
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

async function getRemoteMerkleTree() {
    return (await octokit.rest.repos.getReleaseAsset({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        asset_id: assetsMapping['merkle.json']
    }))
}

async function getClientReleaseAssets() {
    return (await octokit.rest.repos.getLatestRelease({
        owner: 'station0x',
        repo: 'FC-Client-Binaries'
    }))
}

async function updateReleaseNotes() {
    return (await octokit.rest.repos.updateRelease({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        release_id
    }))
}

async function updateRelease(id) {
    return (await octokit.rest.repos.updateReleaseAsset({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        asset_id: id,
    }))
}


async function uploadReleaseAsset(id) {
    return (await octokit.rest.repos.updateRelease({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        release_id: id,
    }))
}

function getFlattenedName(path) {
    return path.replaceAll('/', '@')
}


/**
 * Download a resource from `url` to `dest`.
 * @param {string} url - Valid URL to attempt download of resource
 * @param {string} dest - Valid path to save the file.
 * @returns {Promise<void>} - Returns asynchronously when successfully completed download
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    // Check file does not exist yet before hitting network
    fs.access(dest, fs.constants.F_OK, (err) => {
        // if (err === null) reject('File already exists');

        const request = https.get(url, response => {
            if (response.statusCode === 200) {
                const file = fs.createWriteStream(dest, { flags: 'w' });

                file.on('finish', () => resolve());
                file.on('error', err => {
                        file.close();
                        if (err.code === 'EEXIST') reject('File already exists');
                        else fs.unlink(dest, () => reject(err.message)); // Delete temp file
                });
                response.pipe(file);
                } else if (response.statusCode === 302 || response.statusCode === 301) {
                //Recursively follow redirects, only a 200 will resolve.
                download(response.headers.location, dest).then(() => resolve());
            } else {
                reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
            }
          });
      
          request.on('error', err => {
            reject(err.message);
          });
    });
  });
}

async function main() {
    // Constructing Local Merkle Tree
    let merkleTree = await constructMerkleTree()

    // Writing Merkle Tree to File: [merkle.json]
    await writeMerkleTreeToStorage(merkleTree.stdout)
    let localTree = JSON.parse(merkleTree.stdout)

    // Downloading Remote Merkle Tree  and Read to memory
    let remoteMerkleTreeURL = (await getRemoteMerkleTree()).data.browser_download_url
    await download(remoteMerkleTreeURL, `${basePath}remoteMerkle.json`)
    let remoteTree = JSON.parse(fs.readFileSync(`${basePath}remoteMerkle.json`, "utf8"))

    // Comparing Local with Remote master hashes
    let remoteMasterHash = remoteTree.hash
    let localMasterHash = localTree.hash

    if(remoteMasterHash === localMasterHash) throw new Error('Client already synced with remote!')

    let { mapping: remoteMapping, hashes: remoteHashes } = traverseTree(localTree)
    let { mapping: localMapping, hashes: localHashes } = traverseTree(remoteTree)
    
    let diffs = localHashes
    .filter(val => !remoteHashes.includes(val))
    
    for(let diff in diffs) {
        let diffPath = localMapping[diffs[diff]]
        let diffId = assetsMapping[diffPath]
        console.log(diffPath, diffId)

        const le = await updateRelease(diffId)
        console.log(le)
    }

    
    // flatten client build
    await flattenBuild()
    console.log('Client flattened')
    

    console.log("####")
}
oraPromise(main(), { text: `[FC_SCRIPTS] Integrating Build...\n`, successText: '[FC_SCRIPTS] Done\n', failText: '[FC_SCRIPTS] Cannot build server'});
