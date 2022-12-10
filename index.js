import * as dotenv from 'dotenv'
dotenv.config()
import { execa, execaNode } from 'execa';
import fs from 'node:fs';
import https from 'node:https'
import { oraPromise } from 'ora';
import { traverse } from 'object-traversal';
import { Octokit } from "@octokit/rest"

let clientDist = '../../Releases/Client/FCWindowsClient'
let basePath = 'space/'
const octokit = new Octokit({ auth: process.env.PAT })

// Get Release Assets IDs 
let latestReleaseData = await getClientReleaseAssets()
let releaseAssets = latestReleaseData.data.assets
let releaseId = latestReleaseData.data.id
console.log(releaseId)
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
    let names = []
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
            .filter(val => val !== 'FCWindowsClient')
            .join('@')

            let name = ancestors ? ancestors + '@' + value.name : value.name
            names.push(name)
            mapping[`${value.hash}`] = name
            hashes.push(value.hash)
        }
    }
    traverse(tree, getMapping, { traversalType: 'breadth-first' });
    return {mapping, hashes, names}
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

async function updateReleaseNotes(patchNotes) {
    return (await octokit.rest.repos.updateRelease({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        release_id: releaseId,
        body: patchNotes
    }))
}


async function uploadReleaseAsset(name, data) {
    console.log(
        'name',
        name,
        'data', 
        data
    )
    return (await octokit.rest.repos.uploadReleaseAsset({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        release_id: releaseId,
        name,
        data, 
    }))
}

async function deleteReleaseAsset(asset_id) {
    return (octokit.rest.repos.deleteReleaseAsset({
        owner: 'station0x',
        repo: 'FC-Client-Binaries',
        asset_id,
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
    oraPromise(writeMerkleTreeToStorage(merkleTree.stdout), { text: `[FC_SCRIPTS] Writing Merkle Tree to Storage...\n`, successText: '[FC_SCRIPTS] Done\n', failText: '[FC_SCRIPTS] Error!'});
    let localTree = JSON.parse(merkleTree.stdout)

    // Downloading Remote Merkle Tree  and Read to memory
    let remoteMerkleTreeURL = (await getRemoteMerkleTree()).data.browser_download_url
    await download(remoteMerkleTreeURL, `${basePath}remoteMerkle.json`)
    let remoteTree = JSON.parse(fs.readFileSync(`${basePath}remoteMerkle.json`, "utf8"))

    // Comparing Local with Remote master hashes
    let remoteMasterHash = remoteTree.hash
    let localMasterHash = localTree.hash

    if(remoteMasterHash === localMasterHash) {
        console.log('Client already synced with remote!')
        process.exit(1)
    }

    let { mapping: remoteMapping, hashes: remoteHashes, names: remoteNames } = traverseTree(localTree)
    let { mapping: localMapping, hashes: localHashes, names: localNames } = traverseTree(remoteTree)
    
    let localDiffs = remoteHashes
    .filter(val => !localHashes.includes(val))
    // let remoteDiffs = localHashes
    // .filter(val => !remoteHashes.includes(val))  
    // console.log(localDiffs, remoteDiffs)

    // flatten client build
    oraPromise(flattenBuild(), { text: `[FC_SCRIPTS] Flattening client build...\n`, successText: '[FC_SCRIPTS] Done\n', failText: '[FC_SCRIPTS] Could not flatten.'});

    // uploading changed assets
    for(let diff in localDiffs) {
        let diffPath = remoteMapping[localDiffs[diff]]
        let diffId = assetsMapping[diffPath]
        if(diffId) {
            console.log('found', diffId, diffPath)
            oraPromise(deleteReleaseAsset(diffId), { text: `[FC_DELETE] Deleting asset [${diffPath}] ...\n`, successText: `[FC_UPLOAD] ${diffPath} asset deleted successfully \n`, failText: `[FC_UPLOAD] ${diffPath}  did not delete asset, error occured. \n`});

            let file = fs.readFileSync(`client-flattened/${diffPath}`)
            oraPromise(uploadReleaseAsset(diffPath, file ), { text: `[FC_UPLOAD] Uploading [${diffPath}] ...\n`, successText: `[FC_UPLOAD] ${diffPath} asset uploaded successfully \n`, failText: `[FC_UPLOAD] ${diffPath}  did not upload, error occured. \n`});
        } else {
            let file = fs.readFileSync(`client-flattened/${diffPath}`)
            oraPromise(uploadReleaseAsset(diffPath, file ), { text: `[FC_UPLOAD] Uploading [${diffPath}] ...\n`, successText: `[FC_UPLOAD] ${diffPath} asset uploaded successfully \n`, failText: `[FC_UPLOAD] ${diffPath}  did not upload, error occured. \n`});
        }
    }

    // delete old remote files
    let remoteAssets = []
    for(let asset in assetsMapping) remoteAssets.push(asset)
    let oldRemoteAssets = remoteAssets.filter(val => !localNames.includes(val))
    for (let asset in oldRemoteAssets) {
        let assetId = assetsMapping[oldRemoteAssets[asset]]
        oraPromise(deleteReleaseAsset(assetId), { text: `[FC_DELETE] Deleting asset [${oldRemoteAssets[asset]}] ...\n`, successText: `[FC_UPLOAD] ${oldRemoteAssets[asset]} asset deleted successfully \n`, failText: `[FC_UPLOAD] ${oldRemoteAssets[asset]}  did not delete asset, error occured. \n`});
    }

    // upload new merkle tree
    let mtFile = fs.readFileSync(`${basePath}merkle.json`)
    oraPromise(uploadReleaseAsset('merkle.json', mtFile), { text: `[FC_UPLOAD] Uploading [merkle.json] ...\n`, successText: `[FC_UPLOAD] [merkle.json] asset uploaded successfully \n`, failText: `[FC_UPLOAD] [merkle.json] did not upload, error occured. \n`});

}
oraPromise(main(), { text: `[FC_SCRIPTS] Integrating Build...\n`, successText: '[FC_SCRIPTS] Done\n', failText: '[FC_SCRIPTS] Cannot build server'});
